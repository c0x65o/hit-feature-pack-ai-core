import { NextRequest, NextResponse } from 'next/server';
import { extractUserFromRequest } from '../auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type MethodSpec = {
  name: string;
  method: string;
  pathTemplate: string;
  description: string;
  pathParams: string[];
  readOnly: boolean;
  requiredBodyFields?: string[];
  featurePack?: string;
};

function normalize(s: string): string {
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

function entityBoost(q: string, m: MethodSpec): number {
  const qt = ` ${q} `;
  const p = (m.pathTemplate || '').toLowerCase();
  let b = 0;
  // Strong entity type matching - user's explicit entity mention should override page context
  if (qt.includes(' contact ') || qt.includes(' contacts ')) {
    if (p.includes('/contacts')) b += 12; // Increased boost
    if (p.includes('/companies')) b -= 6; // Penalty for wrong entity
  }
  if (qt.includes(' company ') || qt.includes(' companies ') || qt.includes(' customer ') || qt.includes(' customers ')) {
    if (p.includes('/companies')) b += 12; // Increased boost
    if (p.includes('/contacts')) b -= 6; // Penalty for wrong entity
  }
  if (qt.includes(' deal ') || qt.includes(' deals ') || qt.includes(' opportunity ') || qt.includes(' opportunities ')) {
    if (p.includes('/deals')) b += 12; // Added deal boosting
    if (p.includes('/companies')) b -= 6; // Penalty for wrong entity
  }
  if (qt.includes(' activity ') || qt.includes(' activities ') || qt.includes(' call ') || qt.includes(' meeting ')) {
    if (p.includes('/activities')) b += 8;
  }
  if (qt.includes(' task ') || qt.includes(' tasks ')) {
    if (p.includes('/tasks')) b += 8;
  }
  if (qt.includes(' location ') || qt.includes(' locations ')) {
    if (p.includes('/locations')) b += 8;
  }
  // Metrics-related boosts (generic only; no metric-specific keyword heuristics)
  if (qt.includes(' metric ') || qt.includes(' metrics ') || qt.includes(' catalog ')) {
    if (p.includes('/metrics')) b += 8;
  }
  if (qt.includes(' query ') || qt.includes(' aggregate ') || qt.includes(' sum ') || qt.includes(' total ') || qt.includes(' average ')) {
    if (p.includes('/metrics/query')) b += 10;
  }
  if (qt.includes(' compare ') || qt.includes(' comparison ') || qt.includes(' trend ') || qt.includes(' change ')) {
    if (p.includes('/metrics/query')) b += 8;
  }
  // Prefer explicit catalog endpoints when the user says "catalog".
  if (qt.includes(' catalog ')) {
    if (p.includes('/catalog')) b += 12;
    if (p.includes('/definitions')) b = Math.max(0, b - 6);
  }
  return b;
}

function mismatchPenalty(q: string, m: MethodSpec): number {
  const qt = ` ${q} `;
  const p = (m.pathTemplate || '').toLowerCase();
  let pen = 0;

  // If the user clearly named an entity type, strongly prefer that entity's endpoints.
  // This keeps selection stable when multiple entity words appear in the same prompt.
  if ((qt.includes(' contact ') || qt.includes(' contacts ')) && !p.includes('/contacts')) pen += 15; // Increased penalty
  if ((qt.includes(' company ') || qt.includes(' companies ') || qt.includes(' customer ') || qt.includes(' customers ')) && !p.includes('/companies')) pen += 15; // Increased penalty
  if ((qt.includes(' deal ') || qt.includes(' deals ') || qt.includes(' opportunity ') || qt.includes(' opportunities ')) && !p.includes('/deals')) pen += 15; // Added deal penalty
  if ((qt.includes(' activity ') || qt.includes(' activities ')) && !p.includes('/activities')) pen += 8;
  if (qt.includes(' pipeline ') && !p.includes('/pipeline')) pen += 6;

  // Metrics: "catalog" should not route to definitions/links endpoints.
  if (qt.includes(' catalog ') && !p.includes('/catalog')) pen += 10;
  return pen;
}

function score(q: string, m: MethodSpec): number {
  const hay = normalize([m.name, m.method, m.pathTemplate, m.description, m.pathParams.join(' ')].join(' '));
  if (!hay) return 0;
  if (q && hay.includes(q)) return 30;
  let score = 0;
  for (const term of q.split(' ')) {
    if (!term) continue;
    if (term.length < 3) continue;
    if (STOPWORDS.has(term)) continue;
    if (hay.includes(term)) score += 3;
  }
  score += entityBoost(q, m);
  score -= mismatchPenalty(q, m);

  const qt = ` ${q} `;
  const mm = (m.method || '').toUpperCase();
  const isCreate = qt.includes(' add ') || qt.includes(' create ') || qt.includes(' new ') || qt.includes(' make ') || qt.includes(' log ') || qt.includes(' record ');
  const isUpdate = qt.includes(' update ') || qt.includes(' edit ') || qt.includes(' change ') || qt.includes(' correct ') || qt.includes(' fix ');
  const isDelete = qt.includes(' delete ') || qt.includes(' remove ');
  const isList = qt.includes(' list ') || qt.includes(' show ') || qt.includes(' view ') || qt.includes(' current view ') || qt.includes(' on this page ') || qt.includes(' on this screen ');

  if (isDelete && mm === 'DELETE') score += 10;
  if ((isUpdate || isCreate) && (mm === 'PUT' || mm === 'PATCH')) score += 6;
  if (isCreate && mm === 'POST') score += 8;
  if ((isCreate || isUpdate || isDelete) && mm === 'GET') score = Math.max(0, score - 2);
  if (isList && mm === 'GET') score += 3;
  if ((m.pathTemplate || '').startsWith('/api/ai/')) score = Math.max(0, score - 3);
  return score;
}

export async function GET(request: NextRequest) {
  const user = extractUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const qRaw = (searchParams.get('q') || '').trim();
  const q = normalize(qRaw);
  const packRaw = (searchParams.get('pack') || '').trim();
  const limitRaw = Number(searchParams.get('limit') || '12');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 12;

  const origin = new URL(request.url).origin;
  const resp = await fetch(`${origin}/api/ai/methods`, {
    headers: { authorization: request.headers.get('authorization') || '' },
  });
  const data = await resp.json().catch(() => null);
  const methods: MethodSpec[] = Array.isArray((data as any)?.methods) ? (data as any).methods : [];

  const filtered =
    packRaw && packRaw.toLowerCase() !== 'all'
      ? methods.filter((m) => String((m as any).featurePack || '').toLowerCase() === packRaw.toLowerCase())
      : methods;

  const candidates = filtered
    .map((m) => ({ m, score: score(q, m) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);

  return NextResponse.json({ query: qRaw, pack: packRaw || null, candidates });
}



