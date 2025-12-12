import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
function summarizeHttpResult(input, data) {
    const method = String(input?.method ?? data?.method ?? '').toUpperCase();
    const path = String(input?.path ?? '');
    const status = data?.status;
    const resp = data?.response ?? data;
    if (method === 'POST' && path.includes('/api/crm/companies') && status === 201) {
        const name = resp?.name || input?.body?.name;
        const id = resp?.id;
        return `✅ Created company${name ? ` **${name}**` : ''}.${id ? ` (id: ${id})` : ''}`;
    }
    if (method === 'GET' && (path.includes('/api/crm/companies') || path.includes('/api/crm/contacts'))) {
        const items = resp?.items;
        if (Array.isArray(items)) {
            const kind = path.includes('/api/crm/contacts') ? 'contact' : 'company';
            const topNames = items
                .slice(0, 5)
                .map((it) => it?.name)
                .filter(Boolean)
                .join(', ');
            return `✅ Found **${items.length}** ${kind}${items.length === 1 ? '' : 's'}${topNames ? `: ${topNames}` : ''}`;
        }
    }
    const safeStatus = typeof status === 'number' ? status : undefined;
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
    // Keep it stable across refresh; scope per app user + pathname.
    const path = (opts.pathname || '/').split('?')[0].split('#')[0];
    return `hit_ai_assistant_chat_v1:${email}:${path}`;
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
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [tools, setTools] = useState(null);
    const [suggested, setSuggested] = useState(null);
    const [selectedTool, setSelectedTool] = useState(null);
    const [toolInputs, setToolInputs] = useState({});
    const [runningTool, setRunningTool] = useState(null);
    const [lastUserQuery, setLastUserQuery] = useState('');
    const [pendingApproval, setPendingApproval] = useState(null);
    const initialMessages = useMemo(() => [
        {
            role: 'assistant',
            content: "Hi — I'm the HIT assistant. Ask me what this page does, where to find something, or describe what you want to do and I'll guide you.",
        },
    ], []);
    const chatStorageKey = useMemo(() => getChatStorageKey({ pathname: props.pathname, userEmail: props.user?.email ?? null }), [props.pathname, props.user?.email]);
    const [messages, setMessages] = useState(() => {
        const saved = loadChatState(chatStorageKey);
        if (saved?.messages && Array.isArray(saved.messages) && saved.messages.length > 0) {
            return saved.messages;
        }
        return initialMessages;
    });
    // Load saved input on mount/key change
    useEffect(() => {
        const saved = loadChatState(chatStorageKey);
        if (saved?.input && typeof saved.input === 'string') {
            setInput(saved.input);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatStorageKey]);
    // Persist messages + draft input (survives refresh) until user clicks "New"
    useEffect(() => {
        // Avoid writing gigantic payloads endlessly; keep last ~50 messages.
        const trimmed = messages.slice(-50);
        const t = window.setTimeout(() => {
            saveChatState(chatStorageKey, { messages: trimmed, input });
        }, 150);
        return () => window.clearTimeout(t);
    }, [chatStorageKey, input, messages]);
    const bottomRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [open, messages.length]);
    // When opened, try to fetch dynamic tool catalog from the host app (optional).
    useEffect(() => {
        if (!open)
            return;
        let cancelled = false;
        (async () => {
            try {
                const token = getStoredToken();
                const res = await fetch('/api/ai/tools', {
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                });
                if (!res.ok)
                    return;
                const data = (await res.json().catch(() => null));
                if (!cancelled)
                    setTools(data?.tools ?? null);
            }
            catch {
                // Optional: ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open]);
    // Cmd/Ctrl+K to open
    useEffect(() => {
        const onKeyDown = (e) => {
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
    const context = useMemo(() => ({
        pathname: props.pathname,
        routeId: props.routeId,
        packName: props.packName,
        user: props.user,
        hitConfig: typeof window !== 'undefined' ? window.__HIT_CONFIG : null,
        tools: tools ? tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly })) : null,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
    }), [props.packName, props.pathname, props.routeId, props.user, tools]);
    const defaultToolInput = useCallback((toolName) => {
        if (toolInputs[toolName])
            return toolInputs[toolName];
        // Small convenience: if on /marketing/projects/[id], infer projectId.
        const pathname = props.pathname || '';
        const m = pathname.match(/^\/marketing\/projects\/([^/?#]+)/);
        if (toolName === 'marketing.get_wishlist_changes' && m?.[1]) {
            return { projectId: m[1], days: 12 };
        }
        if (toolName === 'crm.search_companies' || toolName === 'crm.search_contacts') {
            return { query: lastUserQuery, pageSize: 25 };
        }
        if (toolName === 'http.request') {
            return { method: 'GET', path: '/api/health', query: {}, body: {} };
        }
        return {};
    }, [lastUserQuery, props.pathname, toolInputs]);
    const setToolInputValue = useCallback((toolName, key, value) => {
        setToolInputs((prev) => ({
            ...prev,
            [toolName]: {
                ...(prev[toolName] ?? {}),
                [key]: value,
            },
        }));
    }, []);
    const runTool = useCallback(async (toolName, overrideInput) => {
        try {
            setRunningTool(toolName);
            const token = getStoredToken();
            const input = overrideInput ?? defaultToolInput(toolName);
            const res = await fetch('/api/ai/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ toolName, input }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                // If the host app doesn't implement execution, surface a friendly message.
                if (res.status === 501) {
                    throw new Error(data?.error || 'Tool execution not available in this app.');
                }
                throw new Error(data?.error || res.statusText);
            }
            // Approval draft support (used by http.request for write methods).
            if (data?.requiresApproval && data?.draft?.toolName) {
                setPendingApproval({
                    toolName: data.draft.toolName,
                    input: data.draft.input ?? {},
                });
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: `📝 Draft created and requires approval.\n\nReview the approval card below, then click Approve to execute.`,
                    },
                ]);
                return;
            }
            setPendingApproval(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: toolName === 'http.request' ? summarizeHttpResult(input, data) : `✅ Done.`,
                },
            ]);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Tool execution failed.';
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `⚠️ Tool failed: ${toolName}\n\n${msg}` },
            ]);
        }
        finally {
            setRunningTool(null);
        }
    }, [defaultToolInput]);
    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || loading)
            return;
        setInput('');
        setLoading(true);
        setLastUserQuery(text);
        setPendingApproval(null);
        const nextMessages = [...messages, { role: 'user', content: text }];
        setMessages(nextMessages);
        try {
            // Try agent loop first (Codex-style multi-step). If it doesn't handle, fall back to chat.
            try {
                const token = getStoredToken();
                const agentRes = await fetch('/api/proxy/ai/hit/ai/agent', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        message: text,
                        context,
                    }),
                });
                const agentData = await agentRes.json().catch(() => null);
                if (agentRes.ok && agentData?.handled) {
                    if (agentData?.pending_approval?.toolName && agentData?.pending_approval?.input) {
                        setPendingApproval({
                            toolName: agentData.pending_approval.toolName,
                            input: agentData.pending_approval.input,
                        });
                    }
                    const finalMsg = agentData?.final_message || 'Done.';
                    setMessages((prev) => [...prev, { role: 'assistant', content: finalMsg }]);
                    setLoading(false);
                    return;
                }
            }
            catch {
                // ignore and fall back to chat
            }
            // Tiny heuristic: "add a company named X" -> prefill dynamic http.request draft.
            // This is just to prove the approval UX; later the planner model will do this.
            const addCompanyMatch = text.match(/\badd\s+(?:a\s+)?company\s+(?:named\s+)?(.+?)\s*$/i) ||
                text.match(/\bcreate\s+(?:a\s+)?company\s+(?:named\s+)?(.+?)\s*$/i);
            if (addCompanyMatch?.[1]) {
                const name = addCompanyMatch[1].trim().replace(/^"|"$/g, '');
                setToolInputs((prev) => ({
                    ...prev,
                    'http.request': {
                        method: 'POST',
                        path: '/api/crm/companies',
                        query: {},
                        body: { name },
                        approved: false,
                    },
                }));
                // Ensure we select http.request if available.
                setSelectedTool('http.request');
                // End-user friendly: auto-run the action and skip generic chat response.
                await runTool('http.request', {
                    method: 'POST',
                    path: '/api/crm/companies',
                    query: {},
                    body: { name },
                    approved: true,
                });
                setSuggested(null);
                setLoading(false);
                return;
            }
            // Step 1: dynamic tool search (small candidates list) for staging UI.
            try {
                const token = getStoredToken();
                const qs = new URLSearchParams({ q: text, limit: '6' });
                const sr = await fetch(`/api/ai/tool-search?${qs.toString()}`, {
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                });
                if (sr.ok) {
                    const sd = (await sr.json().catch(() => null));
                    const cands = sd?.candidates ?? null;
                    // If we heuristically set a preferred tool (e.g. http.request), keep it selected.
                    const preferred = addCompanyMatch ? 'http.request' : null;
                    const ordered = preferred && cands
                        ? [
                            ...(cands.some((c) => c.name === preferred)
                                ? cands.filter((c) => c.name === preferred)
                                : tools?.filter((t) => t.name === preferred) ?? []),
                            ...cands.filter((c) => c.name !== preferred),
                        ]
                        : cands;
                    setSuggested(ordered ?? null);
                    if (ordered && ordered.length > 0) {
                        setSelectedTool((prev) => prev || preferred || ordered[0].name);
                    }
                }
            }
            catch {
                // optional
            }
            const token = getStoredToken();
            const res = await fetch('/api/proxy/ai/hit/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    messages: nextMessages,
                    context,
                }),
            });
            const data = (await res.json().catch(() => null));
            if (!res.ok) {
                const errMsg = data?.detail || data?.error || res.statusText;
                throw new Error(errMsg);
            }
            const answer = data?.message || 'No response.';
            setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to send message.';
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: `I couldn\'t reach the AI service yet (${msg}).\n\nIf you\'re running locally: start the ai module on port 8000 and set OPENAI_API_KEY (optional).`,
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
    // Inline CSS to avoid fighting global input/button styles.
    const overlayCss = `
    .hit-ai-input::placeholder { color: var(--hit-input-placeholder, var(--hit-muted-foreground, #9ca3af)); }
    .hit-ai-input:disabled { opacity: 0.7; cursor: not-allowed; }
    .hit-ai-send:disabled { opacity: 0.6; cursor: not-allowed; }
  `;
    return (_jsxs("div", { style: containerStyle, children: [open && (_jsxs("div", { style: panelStyle, children: [_jsx("style", { children: overlayCss }), _jsxs("div", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 12px',
                            borderBottom: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                        }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsx("div", { style: { fontWeight: 700 }, children: "AI Assistant" }), _jsx("div", { style: { fontSize: 12, color: 'var(--hit-muted-foreground, rgba(255,255,255,0.65))' }, children: props.pathname || '' })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("button", { onClick: () => {
                                            try {
                                                if (typeof window !== 'undefined')
                                                    window.localStorage.removeItem(chatStorageKey);
                                            }
                                            catch { }
                                            setPendingApproval(null);
                                            setSuggested(null);
                                            setSelectedTool(null);
                                            setToolInputs({});
                                            setLastUserQuery('');
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
                                        }, "aria-label": "New chat", title: "Clear chat (keeps until you click this)", children: "New" }), _jsx("button", { onClick: () => setOpen(false), style: {
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
                                    background: m.role === 'user'
                                        ? 'rgba(59,130,246,0.25)'
                                        : 'rgba(255,255,255,0.06)',
                                }, children: _jsx("div", { style: { fontSize: 13, lineHeight: 1.4 }, children: m.content }) }, idx))), suggested && suggested.length > 0 && (_jsxs("div", { style: {
                                    border: '1px dashed var(--hit-border, rgba(0,0,0,0.15))',
                                    borderRadius: 12,
                                    padding: 10,
                                    background: 'rgba(0,0,0,0.02)',
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }, children: [_jsx("div", { style: { fontWeight: 700 }, children: "Suggested action (approve to run)" }), suggested.length > 1 && (_jsx("select", { value: selectedTool ?? suggested[0].name, onChange: (e) => setSelectedTool(e.target.value), style: {
                                                    height: 32,
                                                    borderRadius: 10,
                                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                    padding: '0 10px',
                                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                    color: 'var(--hit-foreground, #0f172a)',
                                                }, "aria-label": "Select suggested action", children: suggested.map((t) => (_jsx("option", { value: t.name, children: t.name }, t.name))) }))] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: suggested
                                            .filter((t) => t.name === (selectedTool ?? suggested[0].name))
                                            .map((t) => {
                                            const toolName = t.name;
                                            const inputVals = defaultToolInput(toolName);
                                            const needsProjectId = toolName === 'marketing.get_wishlist_changes' && !inputVals.projectId;
                                            const needsQuery = (toolName === 'crm.search_companies' || toolName === 'crm.search_contacts') &&
                                                !String(inputVals.query ?? '').trim();
                                            const isHttp = toolName === 'http.request';
                                            const httpMethod = String(inputVals.method ?? 'GET').toUpperCase();
                                            const httpNeedsPath = isHttp && !String(inputVals.path ?? '').startsWith('/api/');
                                            const isWriteHttp = isHttp && httpMethod !== 'GET';
                                            // Even in "rogue mode", DELETE may still require approval unless explicitly enabled.
                                            const httpNeedsApproval = isWriteHttp && (httpMethod === 'DELETE' || t.requiresConfirmation !== false);
                                            const disableRun = runningTool === toolName ||
                                                (!isHttp && t.readOnly === false) ||
                                                needsProjectId ||
                                                needsQuery ||
                                                httpNeedsPath ||
                                                false;
                                            return (_jsxs("div", { style: {
                                                    border: '1px solid var(--hit-border, rgba(0,0,0,0.12))',
                                                    borderRadius: 10,
                                                    padding: 10,
                                                    background: 'var(--hit-surface, #fff)',
                                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 13 }, children: toolName }), _jsx("div", { style: { fontSize: 12, color: 'var(--hit-muted-foreground, #64748b)' }, children: t.description })] }), _jsx("button", { onClick: () => runTool(toolName), disabled: disableRun, style: {
                                                                    borderRadius: 10,
                                                                    border: '1px solid var(--hit-primary, #3b82f6)',
                                                                    background: 'var(--hit-primary-light, rgba(59,130,246,0.12))',
                                                                    color: 'var(--hit-foreground, #0f172a)',
                                                                    padding: '0 12px',
                                                                    height: 36,
                                                                    cursor: runningTool === toolName ? 'wait' : 'pointer',
                                                                    fontWeight: 700,
                                                                    opacity: disableRun
                                                                        ? 0.6
                                                                        : 1,
                                                                }, title: !isHttp && t.readOnly === false ? 'Write actions are staged next (draft → approve → apply).' : undefined, children: isHttp && httpNeedsApproval
                                                                    ? 'Draft'
                                                                    : !isHttp && t.readOnly === false
                                                                        ? 'Draft'
                                                                        : 'Run' })] }), toolName === 'marketing.get_wishlist_changes' && (_jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 8 }, children: [_jsx("input", { value: inputVals.projectId ?? '', onChange: (e) => setToolInputValue(toolName, 'projectId', e.target.value), placeholder: "projectId", className: "hit-ai-input", style: {
                                                                    flex: 1,
                                                                    borderRadius: 10,
                                                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                    padding: '0 10px',
                                                                    height: 36,
                                                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                    color: 'var(--hit-foreground, #0f172a)',
                                                                    outline: 'none',
                                                                    boxSizing: 'border-box',
                                                                } }), _jsx("input", { value: String(inputVals.days ?? 12), onChange: (e) => setToolInputValue(toolName, 'days', e.target.value), placeholder: "days", className: "hit-ai-input", style: {
                                                                    width: 84,
                                                                    borderRadius: 10,
                                                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                    padding: '0 10px',
                                                                    height: 36,
                                                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                    color: 'var(--hit-foreground, #0f172a)',
                                                                    outline: 'none',
                                                                    boxSizing: 'border-box',
                                                                } })] })), (toolName === 'crm.search_companies' || toolName === 'crm.search_contacts') && (_jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 8 }, children: [_jsx("input", { value: inputVals.query ?? '', onChange: (e) => setToolInputValue(toolName, 'query', e.target.value), placeholder: "search query (e.g. Hitcents, GM, John Smith)", className: "hit-ai-input", style: {
                                                                    flex: 1,
                                                                    borderRadius: 10,
                                                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                    padding: '0 10px',
                                                                    height: 36,
                                                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                    color: 'var(--hit-foreground, #0f172a)',
                                                                    outline: 'none',
                                                                    boxSizing: 'border-box',
                                                                } }), _jsx("input", { value: String(inputVals.pageSize ?? 25), onChange: (e) => setToolInputValue(toolName, 'pageSize', e.target.value), placeholder: "pageSize", className: "hit-ai-input", style: {
                                                                    width: 92,
                                                                    borderRadius: 10,
                                                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                    padding: '0 10px',
                                                                    height: 36,
                                                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                    color: 'var(--hit-foreground, #0f172a)',
                                                                    outline: 'none',
                                                                    boxSizing: 'border-box',
                                                                } })] })), toolName === 'http.request' && (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }, children: [_jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsxs("select", { value: String(inputVals.method ?? 'GET'), onChange: (e) => setToolInputValue(toolName, 'method', e.target.value), style: {
                                                                            width: 110,
                                                                            height: 36,
                                                                            borderRadius: 10,
                                                                            border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                            padding: '0 10px',
                                                                            background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                            color: 'var(--hit-foreground, #0f172a)',
                                                                        }, children: [_jsx("option", { value: "GET", children: "GET" }), _jsx("option", { value: "POST", children: "POST" }), _jsx("option", { value: "PATCH", children: "PATCH" }), _jsx("option", { value: "PUT", children: "PUT" }), _jsx("option", { value: "DELETE", children: "DELETE" })] }), _jsx("input", { value: inputVals.path ?? '', onChange: (e) => setToolInputValue(toolName, 'path', e.target.value), placeholder: "/api/...", className: "hit-ai-input", style: {
                                                                            flex: 1,
                                                                            borderRadius: 10,
                                                                            border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                            padding: '0 10px',
                                                                            height: 36,
                                                                            background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                            color: 'var(--hit-foreground, #0f172a)',
                                                                            outline: 'none',
                                                                            boxSizing: 'border-box',
                                                                        } })] }), _jsx("textarea", { value: JSON.stringify(inputVals.body ?? {}, null, 2), onChange: (e) => {
                                                                    try {
                                                                        setToolInputValue(toolName, 'body', JSON.parse(e.target.value || '{}'));
                                                                    }
                                                                    catch {
                                                                        // ignore invalid JSON until corrected
                                                                    }
                                                                }, placeholder: "JSON body (for write methods)", style: {
                                                                    width: '100%',
                                                                    borderRadius: 10,
                                                                    border: '1px solid var(--hit-input-border, var(--hit-border, #e2e8f0))',
                                                                    padding: '10px 10px',
                                                                    minHeight: 84,
                                                                    background: 'var(--hit-input-bg, var(--hit-surface, #fff))',
                                                                    color: 'var(--hit-foreground, #0f172a)',
                                                                    outline: 'none',
                                                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                                                    fontSize: 12,
                                                                    boxSizing: 'border-box',
                                                                } }), isWriteHttp && (_jsx("div", { style: { fontSize: 12, color: 'var(--hit-muted-foreground, #64748b)' }, children: "Write methods will create an approval draft before executing." }))] }))] }, toolName));
                                        }) }), _jsx("div", { style: { fontSize: 12, marginTop: 8, color: 'var(--hit-muted-foreground, #64748b)' }, children: "Tip: ask naturally \u2014 I\u2019ll run safe actions automatically." })] })), pendingApproval && (_jsxs("div", { style: {
                                    border: '1px solid rgba(245, 158, 11, 0.5)',
                                    borderRadius: 12,
                                    padding: 10,
                                    background: 'rgba(245, 158, 11, 0.06)',
                                }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 6 }, children: "Approval required" }), _jsx("div", { style: { fontSize: 12, color: 'var(--hit-muted-foreground, #64748b)', marginBottom: 8 }, children: "Review the draft below. Clicking approve will execute the write request." }), _jsxs("div", { style: {
                                            border: '1px solid var(--hit-border, rgba(0,0,0,0.12))',
                                            borderRadius: 10,
                                            padding: 10,
                                            background: 'var(--hit-surface, #fff)',
                                        }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 6 }, children: pendingApproval.toolName }), _jsx("pre", { style: {
                                                    margin: 0,
                                                    whiteSpace: 'pre-wrap',
                                                    fontSize: 12,
                                                    lineHeight: 1.35,
                                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                                    color: 'var(--hit-foreground, #0f172a)',
                                                }, children: JSON.stringify(pendingApproval.input, null, 2) }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }, children: [_jsx("button", { onClick: () => setPendingApproval(null), style: {
                                                            borderRadius: 10,
                                                            border: '1px solid var(--hit-border, #e2e8f0)',
                                                            background: 'transparent',
                                                            color: 'var(--hit-foreground, #0f172a)',
                                                            padding: '0 12px',
                                                            height: 36,
                                                            cursor: 'pointer',
                                                            fontWeight: 700,
                                                        }, children: "Cancel" }), _jsx("button", { onClick: () => runTool(pendingApproval.toolName, { ...pendingApproval.input, approved: true }), disabled: runningTool === pendingApproval.toolName, style: {
                                                            borderRadius: 10,
                                                            border: '1px solid var(--hit-primary, #3b82f6)',
                                                            background: 'var(--hit-primary-light, rgba(59,130,246,0.12))',
                                                            color: 'var(--hit-foreground, #0f172a)',
                                                            padding: '0 12px',
                                                            height: 36,
                                                            cursor: runningTool === pendingApproval.toolName ? 'wait' : 'pointer',
                                                            fontWeight: 700,
                                                            opacity: runningTool === pendingApproval.toolName ? 0.6 : 1,
                                                        }, children: "Approve & Run" })] })] })] })), _jsx("div", { ref: bottomRef })] }), _jsxs("div", { style: {
                            padding: 12,
                            borderTop: '1px solid var(--hit-border, rgba(255,255,255,0.12))',
                            display: 'flex',
                            gap: 8,
                        }, children: [_jsx("input", { type: "text", value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send();
                                    }
                                }, placeholder: "Ask me to summarize this page, or describe what you want to do\u2026", className: "hit-ai-input", style: {
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
                                    boxSizing: 'border-box',
                                }, children: "Send" })] }), _jsxs("div", { style: { padding: '0 12px 12px', fontSize: 12, color: 'var(--hit-muted-foreground, rgba(255,255,255,0.65))' }, children: ["Tip: ", _jsx("strong", { children: "Ctrl/Cmd + K" }), " to toggle. ", _jsx("strong", { children: "Esc" }), " to close."] })] })), _jsx("button", { onClick: () => setOpen((v) => !v), style: buttonStyle, "aria-label": "Open AI assistant", children: "AI" })] }));
}
