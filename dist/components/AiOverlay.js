'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
/**
 * Check if the given pathname is an auth-related page where the AI overlay should be hidden.
 * This prevents showing the AI button on login, signup, register, and other auth pages.
 */
function isAuthPage(pathname) {
    if (!pathname)
        return false;
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
    return authPatterns.some(pattern => normalized === pattern ||
        normalized.startsWith(pattern + '/') ||
        normalized.startsWith(pattern + '?'));
}
function safeJsonStringify(value, maxLen = 4000) {
    try {
        const s = JSON.stringify(value, null, 2);
        if (typeof s !== 'string')
            return '';
        return s.length > maxLen ? `${s.slice(0, maxLen)}\n…(truncated)…` : s;
    }
    catch {
        return '';
    }
}
function truncateText(text, maxLen = 1200) {
    const s = String(text ?? '');
    if (s.length <= maxLen)
        return s;
    return `${s.slice(0, maxLen)}\n…(truncated)…`;
}
async function readResponseBody(res) {
    const text = await res.text().catch(() => '');
    if (!text)
        return { text: '', json: null };
    try {
        return { text, json: JSON.parse(text) };
    }
    catch {
        return { text, json: null };
    }
}
function summarizeHttpResult(input, data) {
    const method = String(input?.method ?? data?.method ?? '').toUpperCase();
    const path = String(input?.path ?? '');
    const status = data?.status;
    const resp = data?.response ?? data;
    const safeStatus = typeof status === 'number' ? status : undefined;
    const isError = typeof safeStatus === 'number' && safeStatus >= 400;
    if (isError) {
        const errMsg = (typeof resp === 'object' && resp && resp.error) ||
            (typeof resp === 'object' && resp && resp.detail) ||
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
function getStoredToken() {
    if (typeof document !== 'undefined') {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'hit_token' && value)
                return value;
        }
    }
    if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('hit_token');
    }
    return null;
}
function getChatStorageKey(opts) {
    const email = (opts.userEmail || 'anon').toLowerCase();
    const path = (opts.pathname || '/').split('?')[0].split('#')[0];
    return `hit_ai_assistant_chat_v2:${email}:${path}`;
}
function loadChatState(key) {
    try {
        if (typeof window === 'undefined')
            return null;
        const raw = window.localStorage.getItem(key);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function saveChatState(key, state) {
    try {
        if (typeof window === 'undefined')
            return;
        window.localStorage.setItem(key, JSON.stringify(state));
    }
    catch {
        // ignore
    }
}
export function AiOverlay(props) {
    // The AI overlay is a shell-level component, but it should only appear for
    // authenticated users. We use the same token source we use for API calls.
    // Important: do NOT read cookies/localStorage during the initial render,
    // otherwise we can cause hydration mismatches (server renders "no token",
    // client renders "token" and inserts the button).
    const [hydrated, setHydrated] = useState(false);
    const [authToken, setAuthToken] = useState(null);
    const [currentPathname, setCurrentPathname] = useState(props.pathname);
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [pendingApproval, setPendingApproval] = useState(null);
    const aiStateRef = useRef(null);
    // Track pathname changes (for client-side navigation)
    useEffect(() => {
        if (typeof window === 'undefined')
            return;
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
        const onStorage = (e) => {
            if (e.key === 'hit_token')
                refresh();
        };
        window.addEventListener('storage', onStorage);
        // Poll lightly for same-tab cookie updates (login flows often write cookies without storage events).
        const t = window.setInterval(refresh, 2000);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.clearInterval(t);
        };
    }, []);
    const initialMessages = useMemo(() => [
        {
            role: 'assistant',
            content: "Hi — I'm the HIT assistant. Tell me what you want to do and I'll do it.",
        },
    ], []);
    const chatStorageKey = useMemo(() => getChatStorageKey({ pathname: currentPathname, userEmail: props.user?.email ?? null }), [currentPathname, props.user?.email]);
    const [messages, setMessages] = useState(() => {
        const saved = loadChatState(chatStorageKey);
        if (saved?.messages && Array.isArray(saved.messages) && saved.messages.length > 0) {
            return saved.messages;
        }
        return initialMessages;
    });
    useEffect(() => {
        if (!shouldRender)
            return;
        const saved = loadChatState(chatStorageKey);
        if (saved?.input && typeof saved.input === 'string')
            setInput(saved.input);
    }, [chatStorageKey, shouldRender]);
    useEffect(() => {
        if (!shouldRender)
            return;
        const trimmed = messages.slice(-50);
        const t = window.setTimeout(() => {
            saveChatState(chatStorageKey, { messages: trimmed, input });
        }, 150);
        return () => window.clearTimeout(t);
    }, [chatStorageKey, input, messages, shouldRender]);
    const bottomRef = useRef(null);
    useEffect(() => {
        if (!shouldRender || !open)
            return;
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [open, messages.length, pendingApproval, shouldRender]);
    useEffect(() => {
        if (!shouldRender)
            return;
        const onKeyDown = (e) => {
            if (!e.key)
                return;
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
    const context = useMemo(() => ({
        pathname: currentPathname,
        // Include query params so the agent can do the right thing on pages like
        // /dashboards?pack=projects (dashboards are pack-scoped).
        search: typeof window !== 'undefined' ? window.location.search : null,
        path: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : currentPathname,
        href: typeof window !== 'undefined' ? window.location.href : null,
        routeId: props.routeId,
        packName: props.packName,
        user: props.user,
        hitConfig: typeof window !== 'undefined' ? window.__HIT_CONFIG : null,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
    }), [props.packName, currentPathname, props.routeId, props.user]);
    const runApproval = useCallback(async () => {
        if (!pendingApproval)
            return;
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
                throw new Error(data?.error || res.statusText);
            }
            setPendingApproval(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: toolName === 'http.request' ? summarizeHttpResult(pendingApproval.input, data) : '✅ Done.',
                },
            ]);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to run approval.';
            setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
        }
        finally {
            setLoading(false);
        }
    }, [pendingApproval]);
    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || loading)
            return;
        setInput('');
        setLoading(true);
        const nextMessages = [...messages, { role: 'user', content: text }];
        setMessages(nextMessages);
        setPendingApproval(null);
        try {
            const token = authToken || getStoredToken();
            // Agent only (single supported path)
            try {
                const endpoint = '/api/proxy/ai/hit/ai/agent';
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
                const agentData = body.json ?? null;
                if (agentRes.ok && agentData?.handled) {
                    if (agentData?.memory && typeof agentData.memory === 'object') {
                        aiStateRef.current = agentData.memory;
                    }
                    if (agentData?.pending_approval?.toolName && agentData?.pending_approval?.input) {
                        setPendingApproval({
                            toolName: agentData.pending_approval.toolName,
                            input: agentData.pending_approval.input,
                        });
                    }
                    setMessages((prev) => [...prev, { role: 'assistant', content: agentData?.final_message || 'Done.' }]);
                    if (agentData?.debug && typeof agentData.debug === 'object') {
                        setMessages((prev) => [
                            ...prev,
                            { role: 'assistant', content: `Debug (request):\n${JSON.stringify(agentData.debug, null, 2)}` },
                        ]);
                    }
                    return;
                }
                // Build a more actionable error message for debugging.
                const statusLine = `HTTP ${agentRes.status}${agentRes.statusText ? ` ${agentRes.statusText}` : ''}`;
                const requestId = agentData?.request_id ? String(agentData.request_id) : null;
                const handled = agentData?.handled;
                const serverError = agentData?.error ||
                    agentData?.detail ||
                    agentData?.message ||
                    agentData?.final_message ||
                    null;
                const details = [];
                details.push(`Endpoint: ${endpoint}`);
                details.push(`Status: ${statusLine}`);
                if (requestId)
                    details.push(`request_id: ${requestId}`);
                if (typeof handled !== 'undefined')
                    details.push(`handled: ${String(handled)}`);
                if (serverError)
                    details.push(`error: ${String(serverError)}`);
                // Include a small body snippet (useful when proxy returns HTML or non-JSON).
                if (!agentData && body.text) {
                    details.push(`response (text):\n${truncateText(body.text)}`);
                }
                else if (agentData?.debug) {
                    details.push(`debug:\n${safeJsonStringify(agentData.debug)}`);
                }
                throw new Error(`AI agent did not handle the request.\n${details.join('\n')}`);
            }
            catch {
                // handled below
            }
            throw new Error('AI agent did not handle the request.');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to send message.';
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: `I couldn't process that.\n\n${msg}`,
                },
            ]);
        }
        finally {
            setLoading(false);
        }
    }, [context, input, loading, messages]);
    const containerStyle = {
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1000,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    };
    const buttonStyle = {
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
    const panelStyle = {
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
    if (!shouldRender)
        return null;
    return (_jsxs("div", { style: containerStyle, children: [open && (_jsxs("div", { style: panelStyle, children: [_jsx("style", { children: overlayCss }), _jsxs("div", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 12px',
                            borderBottom: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                        }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsx("div", { style: { fontWeight: 700 }, children: "AI Assistant" }), _jsx("div", { style: { fontSize: 12, color: 'var(--hit-muted-foreground, rgba(255,255,255,0.65))' }, children: currentPathname || '' })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("button", { onClick: () => {
                                            try {
                                                if (typeof window !== 'undefined')
                                                    window.localStorage.removeItem(chatStorageKey);
                                            }
                                            catch { }
                                            setPendingApproval(null);
                                            setInput('');
                                            setMessages(initialMessages);
                                        }, style: {
                                            borderRadius: 10,
                                            border: '1px solid var(--hit-border, rgba(255,255,255,0.25))',
                                            background: 'transparent',
                                            color: 'inherit',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            padding: '6px 10px',
                                        }, "aria-label": "New chat", children: "New" }), _jsx("button", { onClick: () => setOpen(false), style: {
                                            border: 'none',
                                            background: 'transparent',
                                            color: 'inherit',
                                            cursor: 'pointer',
                                            fontSize: 18,
                                            lineHeight: '18px',
                                        }, "aria-label": "Close", children: "\u00D7" })] })] }), _jsxs("div", { style: { flex: 1, padding: 12, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }, children: [messages.map((m, idx) => (_jsx("div", { style: {
                                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    maxWidth: '85%',
                                    padding: '10px 10px',
                                    borderRadius: 12,
                                    whiteSpace: 'pre-wrap',
                                    border: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                                    background: m.role === 'user' ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)',
                                }, children: _jsx("div", { style: { fontSize: 13, lineHeight: 1.4 }, children: m.content }) }, idx))), loading && (_jsx("div", { style: {
                                    alignSelf: 'flex-start',
                                    maxWidth: '85%',
                                    padding: '10px 10px',
                                    borderRadius: 12,
                                    whiteSpace: 'pre-wrap',
                                    border: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                                    background: 'rgba(255,255,255,0.06)',
                                }, children: _jsx("div", { style: { fontSize: 13, lineHeight: 1.4, opacity: 0.9 }, children: "Thinking\u2026" }) })), pendingApproval && (_jsxs("div", { style: {
                                    border: '1px solid rgba(245, 158, 11, 0.5)',
                                    borderRadius: 12,
                                    padding: 10,
                                    background: 'rgba(245, 158, 11, 0.06)',
                                }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 6 }, children: "Approval required" }), _jsx("pre", { style: {
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
                                        }, children: JSON.stringify(pendingApproval, null, 2) }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }, children: [_jsx("button", { onClick: () => setPendingApproval(null), style: {
                                                    borderRadius: 10,
                                                    border: '1px solid var(--hit-border, #e2e8f0)',
                                                    background: 'transparent',
                                                    color: 'var(--hit-foreground, #0f172a)',
                                                    padding: '0 12px',
                                                    height: 36,
                                                    cursor: 'pointer',
                                                    fontWeight: 700,
                                                }, children: "Cancel" }), _jsx("button", { onClick: runApproval, disabled: loading, style: {
                                                    borderRadius: 10,
                                                    border: '1px solid var(--hit-primary, #3b82f6)',
                                                    background: 'var(--hit-primary-light, rgba(59,130,246,0.12))',
                                                    color: 'var(--hit-foreground, #0f172a)',
                                                    padding: '0 12px',
                                                    height: 36,
                                                    cursor: loading ? 'wait' : 'pointer',
                                                    fontWeight: 700,
                                                    opacity: loading ? 0.6 : 1,
                                                }, children: "Approve & Run" })] })] })), _jsx("div", { ref: bottomRef })] }), _jsxs("div", { style: {
                            padding: 12,
                            borderTop: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                            display: 'flex',
                            gap: 8,
                        }, children: [_jsx("input", { type: "text", value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send();
                                    }
                                }, placeholder: "Ask me to do something\u2026", className: "hit-ai-input", style: {
                                    flex: 1,
                                    borderRadius: 10,
                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                    padding: '0 12px',
                                    height: 44,
                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                    color: 'var(--hit-foreground, #0f172a)',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                }, disabled: loading }), _jsx("button", { onClick: send, disabled: loading || !input.trim(), className: "hit-ai-send", style: {
                                    borderRadius: 10,
                                    border: '1px solid var(--hit-primary, #3b82f6)',
                                    background: 'var(--hit-primary-light, rgba(59,130,246,0.12))',
                                    color: 'var(--hit-foreground, #0f172a)',
                                    padding: '0 14px',
                                    height: 44,
                                    cursor: loading ? 'wait' : 'pointer',
                                    fontWeight: 700,
                                }, children: loading ? 'Sending…' : 'Send' })] }), _jsx("div", { style: { padding: '0 12px 12px', fontSize: 12, color: 'var(--hit-muted-foreground, rgba(255,255,255,0.65))' }, children: "Tip: Ctrl/Cmd+K to toggle. Esc to close." })] })), _jsx("button", { onClick: () => setOpen((v) => !v), style: buttonStyle, "aria-label": "Toggle AI assistant", children: "AI" })] }));
}
