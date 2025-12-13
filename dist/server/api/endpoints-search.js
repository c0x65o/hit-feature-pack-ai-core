import { NextResponse } from 'next/server';
import { extractUserFromRequest } from '../auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function scoreEndpoint(q, ep) {
    const hay = normalize([ep.pathTemplate, ep.methods.join(' '), ep.summary ?? '', ep.methodDocs ? Object.values(ep.methodDocs).join(' ') : ''].join(' '));
    if (!hay)
        return 0;
    if (hay.includes(q))
        return 10;
    let score = 0;
    for (const term of q.split(' ')) {
        if (!term)
            continue;
        if (hay.includes(term))
            score += 2;
    }
    return score;
}
export async function GET(request) {
    const user = extractUserFromRequest(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const qRaw = (searchParams.get('q') || '').trim();
    const q = normalize(qRaw);
    const limitRaw = Number(searchParams.get('limit') || '10');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 10;
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/api/ai/endpoints`, {
        headers: { authorization: request.headers.get('authorization') || '' },
    });
    const data = await resp.json().catch(() => null);
    const endpoints = Array.isArray(data?.endpoints) ? data.endpoints : [];
    const candidates = endpoints
        .map((ep) => ({ ep, score: scoreEndpoint(q, ep) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.ep);
    return NextResponse.json({ query: qRaw, candidates });
}
