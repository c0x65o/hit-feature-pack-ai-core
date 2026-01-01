'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Check if the given pathname is an auth-related page where the AI overlay should be hidden.
 * This prevents showing the AI button on login, signup, register, and other auth pages.
 */
function isAuthPage(pathname: string | undefined): boolean {
  if (!pathname) return false;
  const normalized = pathname.toLowerCase();
  
  // Common auth page patterns
  const authPatterns = [
    '/login',
    '/signin',
    '/sign-in',
    '/signup',
    '/sign-up',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/verify',
    '/auth/',
    '/oauth/',
    '/sso/',
    '/mfa',
    '/2fa',
    '/totp',
  ];
  
  return authPatterns.some(pattern => 
    normalized === pattern || 
    normalized.startsWith(pattern + '/') ||
    normalized.startsWith(pattern + '?')
  );
}

type Role = 'user' | 'assistant' | 'system';

type ChatMessage = {
  role: Role;
  content: string;
};

type AgentResponse = {
  reply?: string;
  correlationId?: string;
  pulses?: Array<{ actor?: string; kind?: string; message?: string }> | null;
};

type PendingApproval = {
  toolName: string;
  input: Record<string, any>;
};

function safeJsonStringify(value: unknown, maxLen: number = 4000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (typeof s !== 'string') return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}\n…(truncated)…` : s;
  } catch {
    return '';
  }
}

function truncateText(text: string, maxLen: number = 1200): string {
  const s = String(text ?? '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}\n…(truncated)…`;
}

async function readResponseBody(res: Response): Promise<{ text: string; json: any | null }> {
  const text = await res.text().catch(() => '');
  if (!text) return { text: '', json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

function summarizeHttpResult(input: Record<string, any>, data: any): string {
  const method = String(input?.method ?? data?.method ?? '').toUpperCase();
  const path = String(input?.path ?? '');
  const status = data?.status;
  const resp = data?.response ?? data;

  const safeStatus = typeof status === 'number' ? status : undefined;
  const isError = typeof safeStatus === 'number' && safeStatus >= 400;
  if (isError) {
    const errMsg =
      (typeof resp === 'object' && resp && (resp as any).error) ||
      (typeof resp === 'object' && resp && (resp as any).detail) ||
      undefined;
    if (safeStatus === 403 && path.includes('/api/crm/') && method === 'DELETE') {
      return `⛔ Permission denied (status: 403). This delete requires a higher role (e.g. Sales Manager).`;
    }
    return `⚠️ Request failed${safeStatus ? ` (status: ${safeStatus})` : ''}${errMsg ? `: ${String(errMsg)}` : ''}.`;
  }

  if (method === 'POST' && path.includes('/api/crm/companies') && status === 201) {
    const name = resp?.name || input?.body?.name;
    const id = resp?.id;
    return `✅ Created company${name ? ` **${name}**` : ''}.${id ? ` (id: ${id})` : ''}`;
  }

  return `✅ Request completed${safeStatus ? ` (status: ${safeStatus})` : ''}.`;
}

function asRecord(v: unknown): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : null;
}

function extractIdLike(obj: unknown): string | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  const candidates = ['id', 'uuid', 'contactId', 'companyId', 'dealId', 'key'];
  for (const k of candidates) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function updateAiStateFromApproval(
  aiState: Record<string, any>,
  toolName: string,
  toolInput: Record<string, any>,
  execResult: any,
): Record<string, any> {
  const next = { ...(aiState || {}) };

  // Always record what we approved/executed (helps follow-up reasoning).
  next.lastApproval = {
    at: new Date().toISOString(),
    toolName,
    input: toolInput,
    result: execResult,
  };

  if (toolName === 'http.request') {
    const method = String(toolInput?.method || execResult?.method || '').toUpperCase();
    const path = String(toolInput?.path || '');
    const status = execResult?.status;
    const resp = execResult?.response ?? execResult;

    next.lastHttp = { method, path, status, url: execResult?.url };

    if (typeof status === 'number' && status >= 200 && status < 300 && method && method !== 'GET') {
      const dataObj = asRecord(resp)?.data ?? resp;
      const idOrKey = extractIdLike(dataObj);
      if (idOrKey) next.lastWriteId = idOrKey;
      if (typeof (asRecord(dataObj)?.key) === 'string') next.lastWriteKey = String(asRecord(dataObj)?.key);
      // Keep a dashboard-specific alias for convenience.
      if (path.startsWith('/api/dashboard-definitions') && typeof (asRecord(dataObj)?.key) === 'string') {
        next.lastDashboardKey = String(asRecord(dataObj)?.key);
      }
      next.lastWriteMethod = method;
      next.lastWritePath = path;
    }
  }

  if (toolName === 'http.bulk') {
    const results = Array.isArray(execResult?.results) ? execResult.results : [];
    // Find the last successful non-GET in the batch.
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i];
      const method = String(r?.method || '').toUpperCase();
      const status = r?.status;
      if (method && method !== 'GET' && typeof status === 'number' && status >= 200 && status < 300) {
        const resp = r?.response ?? r;
        const dataObj = asRecord(resp)?.data ?? resp;
        const idOrKey = extractIdLike(dataObj);
        if (idOrKey) next.lastWriteId = idOrKey;
        if (typeof (asRecord(dataObj)?.key) === 'string') next.lastWriteKey = String(asRecord(dataObj)?.key);
        next.lastWriteMethod = method;
        break;
      }
    }
  }

  return next;
}

function getStoredToken(): string | null {
  if (typeof document !== 'undefined') {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'hit_token' && value) return value;
    }
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('hit_token');
  }
  return null;
}

function getChatStorageKey(opts: { pathname?: string; userEmail?: string | null }): string {
  const email = (opts.userEmail || 'anon').toLowerCase();
  const path = (opts.pathname || '/').split('?')[0].split('#')[0];
  return `hit_ai_assistant_chat_v2:${email}:${path}`;
}

function loadChatState(key: string): { messages?: ChatMessage[]; input?: string } | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as any;
  } catch {
    return null;
  }
}

function saveChatState(key: string, state: { messages: ChatMessage[]; input: string }) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function AiOverlay(props: {
  routeId?: string;
  packName?: string;
  pathname?: string;
  user?: { email?: string; roles?: string[] } | null;
  /** Hide the overlay on auth pages like /login, /signup, etc. Defaults to true. */
  hideOnAuthPages?: boolean;
}) {
  // The AI overlay is a shell-level component, but it should only appear for
  // authenticated users. We use the same token source we use for API calls.
  // Important: do NOT read cookies/localStorage during the initial render,
  // otherwise we can cause hydration mismatches (server renders "no token",
  // client renders "token" and inserts the button).
  const [hydrated, setHydrated] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentPathname, setCurrentPathname] = useState<string | undefined>(props.pathname);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastCorrelationId, setLastCorrelationId] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const aiStateRef = useRef<Record<string, any> | null>(null);

  // Track pathname changes (for client-side navigation)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Get current pathname from window.location if not provided via props
    const getPathname = () => props.pathname || window.location.pathname;
    setCurrentPathname(getPathname());
    
    // Listen for popstate (back/forward navigation)
    const handlePopstate = () => setCurrentPathname(getPathname());
    window.addEventListener('popstate', handlePopstate);
    
    // Poll for pathname changes (handles pushState/replaceState which don't trigger popstate)
    const interval = setInterval(() => {
      const newPath = getPathname();
      setCurrentPathname(prev => prev !== newPath ? newPath : prev);
    }, 500);
    
    return () => {
      window.removeEventListener('popstate', handlePopstate);
      clearInterval(interval);
    };
  }, [props.pathname]);

  // Determine if overlay should render:
  // 1. Must be hydrated (client-side)
  // 2. Must have auth token
  // 3. Must not be on an auth page (unless hideOnAuthPages is explicitly false)
  const hideOnAuth = props.hideOnAuthPages !== false;
  const onAuthPage = hideOnAuth && isAuthPage(currentPathname);
  const shouldRender = hydrated && Boolean(authToken) && !onAuthPage;

  // Keep token reasonably fresh in case it is set after initial render.
  useEffect(() => {
    setHydrated(true);
    const refresh = () => setAuthToken(getStoredToken());
    refresh();

    // Listen to cross-tab updates.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'hit_token') refresh();
    };
    window.addEventListener('storage', onStorage);

    // Poll lightly for same-tab cookie updates (login flows often write cookies without storage events).
    const t = window.setInterval(refresh, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(t);
    };
  }, []);

  const initialMessages: ChatMessage[] = useMemo(
    () => [
      {
        role: 'assistant',
        content: "Tell me what you want to do in HIT, and I'll route it to the right agent.",
      },
    ],
    []
  );

  const chatStorageKey = useMemo(
    () => getChatStorageKey({ pathname: currentPathname, userEmail: props.user?.email ?? null }),
    [currentPathname, props.user?.email]
  );

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadChatState(chatStorageKey);
    if (saved?.messages && Array.isArray(saved.messages) && saved.messages.length > 0) {
      return saved.messages as ChatMessage[];
    }
    return initialMessages;
  });

  useEffect(() => {
    if (!shouldRender) return;
    const saved = loadChatState(chatStorageKey);
    if (saved?.input && typeof saved.input === 'string') setInput(saved.input);
  }, [chatStorageKey, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    const trimmed = messages.slice(-50);
    const t = window.setTimeout(() => {
      saveChatState(chatStorageKey, { messages: trimmed, input });
    }, 150);
    return () => window.clearTimeout(t);
  }, [chatStorageKey, input, messages, shouldRender]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!shouldRender || !open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length, pendingApproval, shouldRender]);

  useEffect(() => {
    if (!shouldRender || !open) return;
    // Focus the input when the overlay opens
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, [open, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.key) return;
      const isK = e.key.toLowerCase() === 'k';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shouldRender]);

  const context = useMemo(
    () => ({
      pathname: currentPathname,
      // Include query params so the agent can do the right thing on pages like
      // /dashboards?pack=projects (dashboards are pack-scoped).
      search: typeof window !== 'undefined' ? window.location.search : null,
      path: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : currentPathname,
      href: typeof window !== 'undefined' ? window.location.href : null,
      routeId: props.routeId,
      packName: props.packName,
      user: props.user,
      hitConfig: typeof window !== 'undefined' ? (window as any).__HIT_CONFIG : null,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
    }),
    [props.packName, currentPathname, props.routeId, props.user]
  );

  const runApproval = useCallback(async () => {
    if (!pendingApproval) return;
    const toolName = pendingApproval.toolName;
    const token = authToken || getStoredToken();

    setLoading(true);
    try {
      const res = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          toolName,
          input: { ...pendingApproval.input, approved: true },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data as any)?.error || res.statusText);
      }

      // IMPORTANT: Approved writes execute *outside* the agent loop.
      // If we don't fold the execution result back into aiState, the next user turn
      // has no reliable anchor (IDs/keys) and follow-up "oops/update it" requests become flaky.
      aiStateRef.current = updateAiStateFromApproval(
        aiStateRef.current || {},
        toolName,
        pendingApproval.input,
        data,
      );

      setPendingApproval(null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: toolName === 'http.request' ? summarizeHttpResult(pendingApproval.input, data) : '✅ Done.',
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to run approval.';
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }, [pendingApproval]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setPendingApproval(null);

    try {
      const token = authToken || getStoredToken();

      // Nexus-first chat (single supported path)
      try {
        const endpoint = '/api/proxy/ai/hit/ai/chat';
        const agentRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message: text,
            context: { ...context, aiState: aiStateRef.current || {} },
            history: messages.slice(-16),
          }),
        });
        const body = await readResponseBody(agentRes);
        const agentData = (body.json as AgentResponse | null) ?? null;

        if (agentRes.ok && agentData?.reply) {
          if (agentData?.correlationId && typeof agentData.correlationId === 'string') {
            setLastCorrelationId(agentData.correlationId);
          }
          setPendingApproval(null);
          setMessages((prev) => [...prev, { role: 'assistant', content: agentData.reply || 'Done.' }]);
          if (Array.isArray(agentData.pulses) && agentData.pulses.length > 0) {
            const pulseText = agentData.pulses
              .map((p) => `- ${String(p.actor || 'unknown')}: ${String(p.kind || 'event')} — ${String(p.message || '')}`)
              .join('\n');
            setMessages((prev) => [...prev, { role: 'assistant', content: `Pulse:\n${pulseText}` }]);
          }
          return;
        }

        // Build a more actionable error message for debugging.
        const statusLine = `HTTP ${agentRes.status}${agentRes.statusText ? ` ${agentRes.statusText}` : ''}`;
        const correlationId = (agentData as any)?.correlationId ? String((agentData as any).correlationId) : null;
        const serverError = (agentData as any)?.error || (agentData as any)?.detail || (agentData as any)?.message || null;

        const details: string[] = [];
        details.push(`Endpoint: ${endpoint}`);
        details.push(`Status: ${statusLine}`);
        if (correlationId) details.push(`correlationId: ${correlationId}`);
        if (serverError) details.push(`error: ${String(serverError)}`);

        // Include a small body snippet (useful when proxy returns HTML or non-JSON).
        if (!agentData && body.text) {
          details.push(`response (text):\n${truncateText(body.text)}`);
        } else if ((agentData as any)?.debug) {
          details.push(`debug:\n${safeJsonStringify((agentData as any).debug)}`);
        }

        throw new Error(`AI request failed.\n${details.join('\n')}`);
      } catch (err) {
        // Preserve the *real* error (network error, non-JSON body, 401/403/500, etc.)
        // so the user sees actionable debug details instead of a generic message.
        if (err instanceof Error) throw err;
        const fallback =
          safeJsonStringify(err) ||
          (typeof err === 'string' ? err : '') ||
          String(err);
        throw new Error(
          `AI request failed.\nEndpoint: /api/proxy/ai/hit/ai/chat\nerror: ${fallback}`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send message.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I couldn't process that.\n\n${msg}`,
        },
      ]);
    } finally {
      setLoading(false);
      // Refocus the input after sending
      if (open && inputRef.current) {
        // Use setTimeout to ensure the DOM has updated
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      }
    }
  }, [context, input, loading, messages, open]);

  const fetchTrace = useCallback(async () => {
    const cid = lastCorrelationId;
    if (!cid) return;
    const token = authToken || getStoredToken();
    setTraceLoading(true);
    try {
      const res = await fetch(`/api/proxy/ai/hit/ai/traces/${encodeURIComponent(cid)}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const body = await readResponseBody(res);
      const obj = body.json ?? body.text ?? null;
      const pretty = safeJsonStringify(obj) || (typeof obj === 'string' ? obj : '');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Trace (${cid}):\n${pretty || '(empty)'}` },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load trace.';
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    } finally {
      setTraceLoading(false);
    }
  }, [authToken, lastCorrelationId]);

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 1000,
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  };

  const buttonStyle: React.CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: 999,
    border: '1px solid var(--hit-border, rgba(255,255,255,0.15))',
    background: 'var(--hit-surface, rgba(17,17,17,0.95))',
    color: 'var(--hit-foreground, #fff)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
    cursor: 'pointer',
    fontWeight: 700,
  };

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    right: 16,
    bottom: 72,
    width: 'min(420px, calc(100vw - 32px))',
    height: 'min(560px, calc(100vh - 120px))',
    borderRadius: 16,
    border: '1px solid var(--hit-border, rgba(255,255,255,0.15))',
    background: 'var(--hit-surface, rgba(17,17,17,0.98))',
    color: 'var(--hit-foreground, #fff)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const overlayCss = `\n    .hit-ai-input::placeholder { color: var(--hit-input-placeholder, var(--hit-muted-foreground, #9ca3af)); }\n    .hit-ai-input:disabled { opacity: 0.7; cursor: not-allowed; }\n    .hit-ai-send:disabled { opacity: 0.6; cursor: not-allowed; }\n  `;

  // If not authenticated, do not render anything (no button, no panel).
  if (!shouldRender) return null;

  return (
    <div style={containerStyle}>
      {open && (
        <div style={panelStyle}>
          <style>{overlayCss}</style>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 12px',
              borderBottom: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontWeight: 700 }}>AI Assistant</div>
              <div style={{ fontSize: 12, color: 'var(--hit-muted-foreground, rgba(255,255,255,0.65))' }}>
                {currentPathname || ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {lastCorrelationId && (
                <button
                  onClick={fetchTrace}
                  disabled={traceLoading}
                  style={{
                    borderRadius: 10,
                    border: '1px solid var(--hit-border, rgba(255,255,255,0.25))',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: traceLoading ? 'wait' : 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '6px 10px',
                    opacity: traceLoading ? 0.7 : 1,
                  }}
                  aria-label="Load trace"
                  title={`Load trace ${lastCorrelationId}`}
                >
                  {traceLoading ? 'Trace…' : 'Trace'}
                </button>
              )}
              <button
                onClick={() => {
                  try {
                    if (typeof window !== 'undefined') window.localStorage.removeItem(chatStorageKey);
                  } catch {}
                  setPendingApproval(null);
                  setInput('');
                  setMessages(initialMessages);
                  setLastCorrelationId(null);
                }}
                style={{
                  borderRadius: 10,
                  border: '1px solid var(--hit-border, rgba(255,255,255,0.25))',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '6px 10px',
                }}
                aria-label="New chat"
              >
                New
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: '18px',
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>

          <div style={{ flex: 1, padding: 12, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: '10px 10px',
                  borderRadius: 12,
                  whiteSpace: 'pre-wrap',
                  border: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                  background: m.role === 'user' ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>{m.content}</div>
              </div>
            ))}

            {loading && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '85%',
                  padding: '10px 10px',
                  borderRadius: 12,
                  whiteSpace: 'pre-wrap',
                  border: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ fontSize: 13, lineHeight: 1.4, opacity: 0.9 }}>Thinking…</div>
              </div>
            )}

            {pendingApproval && (
              <div
                style={{
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  borderRadius: 12,
                  padding: 10,
                  background: 'rgba(245, 158, 11, 0.06)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Approval required</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    lineHeight: 1.35,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
                    color: 'var(--hit-foreground, #0f172a)',
                    background: 'var(--hit-surface, #fff)',
                    border: '1px solid var(--hit-border, rgba(0,0,0,0.12))',
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  {JSON.stringify(pendingApproval, null, 2)}
                </pre>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setPendingApproval(null)}
                    style={{
                      borderRadius: 10,
                      border: '1px solid var(--hit-border, #e2e8f0)',
                      background: 'transparent',
                      color: 'var(--hit-foreground, #0f172a)',
                      padding: '0 12px',
                      height: 36,
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={runApproval}
                    disabled={loading}
                    style={{
                      borderRadius: 10,
                      border: '1px solid var(--hit-primary, #3b82f6)',
                      background: 'var(--hit-primary-light, rgba(59,130,246,0.12))',
                      color: 'var(--hit-foreground, #0f172a)',
                      padding: '0 12px',
                      height: 36,
                      cursor: loading ? 'wait' : 'pointer',
                      fontWeight: 700,
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    Approve & Run
                  </button>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div
            style={{
              padding: 12,
              borderTop: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
              display: 'flex',
              gap: 8,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask me to do something…"
              className="hit-ai-input"
              style={{
                flex: 1,
                borderRadius: 10,
                border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                padding: '0 12px',
                height: 44,
                background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                color: 'var(--hit-foreground, #0f172a)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="hit-ai-send"
              style={{
                borderRadius: 10,
                border: '1px solid var(--hit-primary, #3b82f6)',
                background: 'var(--hit-primary-light, rgba(59,130,246,0.12))',
                color: 'var(--hit-foreground, #0f172a)',
                padding: '0 14px',
                height: 44,
                cursor: loading ? 'wait' : 'pointer',
                fontWeight: 700,
              }}
            >
              {loading ? 'Sending…' : 'Send'}
            </button>
          </div>

          <div style={{ padding: '0 12px 12px', fontSize: 12, color: 'var(--hit-muted-foreground, rgba(255,255,255,0.65))' }}>
            Tip: Ctrl/Cmd+K to toggle. Esc to close.
          </div>
        </div>
      )}

      <button onClick={() => setOpen((v) => !v)} style={buttonStyle} aria-label="Toggle AI assistant">
        AI
      </button>
    </div>
  );
}
