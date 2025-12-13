import { NextResponse } from 'next/server';
import { extractUserFromRequest } from '../auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'can',
    'could',
    'did',
    'do',
    'does',
    'for',
    'from',
    'get',
    'give',
    'have',
    'how',
    'i',
    'in',
    'is',
    'it',
    'just',
    'list',
    'me',
    'my',
    'of',
    'on',
    'or',
    'please',
    'show',
    'tell',
    'that',
    'the',
    'there',
    'this',
    'to',
    'up',
    'what',
    'when',
    'where',
    'who',
    'with',
    'would',
    'you',
    'your',
]);
function entityBoost(q, m) {
    const qt = ` ${q} `;
    const p = (m.pathTemplate || '').toLowerCase();
    let b = 0;
    if (qt.includes(' contact ') || qt.includes(' contacts ')) {
        if (p.includes('/contacts'))
            b += 8;
    }
    if (qt.includes(' company ') || qt.includes(' companies ') || qt.includes(' customer ') || qt.includes(' customers ')) {
        if (p.includes('/companies'))
            b += 8;
    }
    if (qt.includes(' activity ') || qt.includes(' activities ') || qt.includes(' call ') || qt.includes(' meeting ')) {
        if (p.includes('/activities'))
            b += 8;
    }
    if (qt.includes(' task ') || qt.includes(' tasks ')) {
        if (p.includes('/tasks'))
            b += 8;
    }
    if (qt.includes(' location ') || qt.includes(' locations ')) {
        if (p.includes('/locations'))
            b += 8;
    }
    return b;
}
function score(q, m) {
    const hay = normalize([m.name, m.method, m.pathTemplate, m.description, m.pathParams.join(' ')].join(' '));
    if (!hay)
        return 0;
    if (q && hay.includes(q))
        return 30;
    let score = 0;
    for (const term of q.split(' ')) {
        if (!term)
            continue;
        if (term.length < 3)
            continue;
        if (STOPWORDS.has(term))
            continue;
        if (hay.includes(term))
            score += 3;
    }
    score += entityBoost(q, m);
    const qt = ` ${q} `;
    const mm = (m.method || '').toUpperCase();
    const isCreate = qt.includes(' add ') || qt.includes(' create ') || qt.includes(' new ') || qt.includes(' make ') || qt.includes(' log ') || qt.includes(' record ');
    const isUpdate = qt.includes(' update ') || qt.includes(' edit ') || qt.includes(' change ') || qt.includes(' correct ') || qt.includes(' fix ');
    const isDelete = qt.includes(' delete ') || qt.includes(' remove ');
    const isList = qt.includes(' list ') || qt.includes(' show ') || qt.includes(' view ') || qt.includes(' current view ') || qt.includes(' on this page ') || qt.includes(' on this screen ');
    if (isDelete && mm === 'DELETE')
        score += 10;
    if ((isUpdate || isCreate) && (mm === 'PUT' || mm === 'PATCH'))
        score += 6;
    if (isCreate && mm === 'POST')
        score += 8;
    if ((isCreate || isUpdate || isDelete) && mm === 'GET')
        score = Math.max(0, score - 2);
    if (isList && mm === 'GET')
        score += 3;
    if ((m.pathTemplate || '').startsWith('/api/ai/'))
        score = Math.max(0, score - 3);
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
    const limitRaw = Number(searchParams.get('limit') || '12');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 12;
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/api/ai/methods`, {
        headers: { authorization: request.headers.get('authorization') || '' },
    });
    const data = await resp.json().catch(() => null);
    const methods = Array.isArray(data?.methods) ? data.methods : [];
    const candidates = methods
        .map((m) => ({ m, score: score(q, m) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.m);
    return NextResponse.json({ query: qRaw, candidates });
}
