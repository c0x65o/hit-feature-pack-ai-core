import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Role = 'user' | 'assistant' | 'system';

type ChatMessage = {
  role: Role;
  content: string;
};

type AgentResponse = {
  handled?: boolean;
  final_message?: string;
  pending_approval?: { toolName?: string; input?: Record<string, any> } | null;
};

type PendingApproval = {
  toolName: string;
  input: Record<string, any>;
};

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
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const initialMessages: ChatMessage[] = useMemo(
    () => [
      {
        role: 'assistant',
        content: "Hi — I'm the HIT assistant. Tell me what you want to do and I'll do it.",
      },
    ],
    []
  );

  const chatStorageKey = useMemo(
    () => getChatStorageKey({ pathname: props.pathname, userEmail: props.user?.email ?? null }),
    [props.pathname, props.user?.email]
  );

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadChatState(chatStorageKey);
    if (saved?.messages && Array.isArray(saved.messages) && saved.messages.length > 0) {
      return saved.messages as ChatMessage[];
    }
    return initialMessages;
  });

  useEffect(() => {
    const saved = loadChatState(chatStorageKey);
    if (saved?.input && typeof saved.input === 'string') setInput(saved.input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatStorageKey]);

  useEffect(() => {
    const trimmed = messages.slice(-50);
    const t = window.setTimeout(() => {
      saveChatState(chatStorageKey, { messages: trimmed, input });
    }, 150);
    return () => window.clearTimeout(t);
  }, [chatStorageKey, input, messages]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length, pendingApproval]);

  useEffect(() => {
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
  }, []);

  const context = useMemo(
    () => ({
      pathname: props.pathname,
      routeId: props.routeId,
      packName: props.packName,
      user: props.user,
      hitConfig: typeof window !== 'undefined' ? (window as any).__HIT_CONFIG : null,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
    }),
    [props.packName, props.pathname, props.routeId, props.user]
  );

  const runApproval = useCallback(async () => {
    if (!pendingApproval) return;
    const toolName = pendingApproval.toolName;
    const token = getStoredToken();

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
      const token = getStoredToken();

      // Agent only (single supported path)
      try {
        const agentRes = await fetch('/api/proxy/ai/hit/ai/agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: text, context, history: messages.slice(-16) }),
        });
        const agentData = (await agentRes.json().catch(() => null)) as AgentResponse | null;

        if (agentRes.ok && agentData?.handled) {
          if (agentData?.pending_approval?.toolName && agentData?.pending_approval?.input) {
            setPendingApproval({
              toolName: agentData.pending_approval.toolName,
              input: agentData.pending_approval.input,
            });
          }
          setMessages((prev) => [...prev, { role: 'assistant', content: agentData?.final_message || 'Done.' }]);
          return;
        }
      } catch {
        // handled below
      }
      throw new Error('AI agent did not handle the request.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send message.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I couldn't process that (${msg}).`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [context, input, loading, messages]);

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
                {props.pathname || ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => {
                  try {
                    if (typeof window !== 'undefined') window.localStorage.removeItem(chatStorageKey);
                  } catch {}
                  setPendingApproval(null);
                  setInput('');
                  setMessages(initialMessages);
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
              Send
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
