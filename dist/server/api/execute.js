import { NextResponse } from 'next/server';
import { extractUserFromRequest } from '../auth';
import { autoApproveDeleteEnabled, autoApproveWritesEnabled } from '../lib/ai-policy';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function httpRequest(request, input) {
    const methodRaw = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodRaw) ? methodRaw : 'GET';
    const pathRaw = typeof input.path === 'string' ? input.path : '';
    const approved = Boolean(input.approved);
    if (!pathRaw.startsWith('/api/')) {
        return { status: 400, body: { error: "path must start with '/api/'" } };
    }
    // Prevent recursive/self calls into AI control plane.
    if (pathRaw.startsWith('/api/ai/')) {
        return { status: 400, body: { error: 'Refusing to call /api/ai/* endpoints' } };
    }
    const requiresApproval = method !== 'GET';
    const autoApprove = autoApproveWritesEnabled();
    const forceApprove = method === 'DELETE' && !autoApproveDeleteEnabled();
    if (requiresApproval && !approved && (forceApprove || !autoApprove)) {
        return {
            status: 200,
            body: {
                requiresApproval: true,
                draft: {
                    toolName: 'http.request',
                    input: {
                        method,
                        path: pathRaw,
                        query: (input.query ?? null),
                        body: (input.body ?? null),
                        approved: false,
                    },
                },
            },
        };
    }
    const origin = new URL(request.url).origin;
    const url = new URL(pathRaw, origin);
    const query = input.query && typeof input.query === 'object' ? input.query : null;
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v == null)
                continue;
            url.searchParams.set(k, String(v));
        }
    }
    const headers = {};
    const auth = request.headers.get('authorization');
    if (auth)
        headers['authorization'] = auth;
    const cookie = request.headers.get('cookie');
    if (cookie)
        headers['cookie'] = cookie;
    headers['content-type'] = 'application/json';
    const init = { method, headers };
    if (method !== 'GET') {
        init.body = JSON.stringify(input.body ?? {});
    }
    const resp = await fetch(url.toString(), init);
    const text = await resp.text();
    let parsed = text;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        // keep as text
    }
    return {
        status: 200,
        body: {
            status: resp.status,
            url: url.toString(),
            method,
            response: parsed,
        },
    };
}
async function httpBulk(request, input) {
    const approved = Boolean(input.approved);
    const reqs = input.requests;
    if (!Array.isArray(reqs) || reqs.length === 0) {
        return { status: 400, body: { error: 'requests[] is required' } };
    }
    if (reqs.length > 50) {
        return { status: 400, body: { error: 'Too many requests (max 50)' } };
    }
    const autoApprove = autoApproveWritesEnabled();
    const anyWrite = reqs.some((r) => String(r?.method || '').toUpperCase() !== 'GET');
    const anyDelete = reqs.some((r) => String(r?.method || '').toUpperCase() === 'DELETE');
    const forceApprove = anyDelete && !autoApproveDeleteEnabled();
    if (anyWrite && !approved && (forceApprove || !autoApprove)) {
        return {
            status: 200,
            body: {
                requiresApproval: true,
                draft: {
                    toolName: 'http.bulk',
                    input: {
                        requests: reqs,
                        approved: false,
                    },
                },
            },
        };
    }
    const results = [];
    let ok = 0;
    let failed = 0;
    for (const r of reqs) {
        const res = await httpRequest(request, {
            method: r.method,
            path: r.path,
            query: r.query ?? null,
            body: r.body ?? null,
            approved: true,
        });
        results.push(res.body);
        const st = res.body?.status;
        if (typeof st === 'number' && st >= 200 && st < 300)
            ok += 1;
        else
            failed += 1;
    }
    return {
        status: 200,
        body: {
            status: failed === 0 ? 200 : 207,
            ok,
            failed,
            results,
        },
    };
}
export async function POST(request) {
    const user = extractUserFromRequest(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const toolName = body.toolName;
    const input = (body.input ?? {});
    if (toolName === 'http.request') {
        const result = await httpRequest(request, input);
        return NextResponse.json(result.body, { status: result.status });
    }
    if (toolName === 'http.bulk') {
        const result = await httpBulk(request, input);
        return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({ error: `Unknown or not executable tool: ${toolName}` }, { status: 404 });
}
