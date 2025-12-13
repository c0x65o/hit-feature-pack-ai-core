import fs from 'node:fs';
import path from 'node:path';

export type DiscoveredEndpoint = {
  pathTemplate: string;
  methods: string[];
  summary?: string;
  methodDocs?: Record<string, string>;
};

let cached: { at: number; endpoints: DiscoveredEndpoint[] } | null = null;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.isFile() && entry.name === 'route.ts') acc.push(p);
  }
  return acc;
}

function extractMethods(fileText: string): string[] {
  const methods = new Set<string>();
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const re = new RegExp(`export\\s+async\\s+function\\s+${m}\\b`, 'm');
    if (re.test(fileText)) methods.add(m);
  }
  return Array.from(methods);
}

function extractDocs(fileText: string): { summary?: string; methodDocs?: Record<string, string> } {
  const blocks = fileText.match(/\/\*\*[\s\S]*?\*\//g) || [];
  const methodDocs: Record<string, string> = {};
  let summary: string | undefined;

  for (const b of blocks) {
    const lines = b
      .split('\n')
      .map((l) => l.replace(/^\s*\/\*\*?/, '').replace(/^\s*\*\s?/, '').replace(/\*\/\s*$/, '').trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s]+)/i);
      if (!m) continue;
      const method = m[1].toUpperCase();
      const descLines: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const candidate = lines[j];
        if (/^(GET|POST|PUT|PATCH|DELETE)\s+\/api\//i.test(candidate)) break;
        if (/^List |^Create |^Update |^Delete |^Query |^Import /i.test(candidate) || candidate.length > 3) {
          descLines.push(candidate);
        }
      }
      const desc = descLines.join(' ').trim();
      if (desc) methodDocs[method] = desc;
    }

    if (!summary) {
      const first = lines.find((l) => !/^(GET|POST|PUT|PATCH|DELETE)\s+\/api\//i.test(l));
      if (first) summary = first;
    }
  }

  return {
    summary,
    methodDocs: Object.keys(methodDocs).length ? methodDocs : undefined,
  };
}

export function discoverAppApiEndpoints(projectRoot: string): DiscoveredEndpoint[] {
  const now = Date.now();
  if (cached && now - cached.at < 30_000) return cached.endpoints;

  const apiRoot = path.join(projectRoot, 'app', 'api');
  if (!fs.existsSync(apiRoot)) {
    cached = { at: now, endpoints: [] };
    return [];
  }

  const files = walk(apiRoot);
  const endpoints: DiscoveredEndpoint[] = [];

  for (const f of files) {
    const rel = path.relative(apiRoot, path.dirname(f));
    const routePath = '/api/' + (rel === '' ? '' : rel.split(path.sep).join('/'));
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const methods = extractMethods(text);
    if (methods.length === 0) continue;
    const docs = extractDocs(text);
    endpoints.push({ pathTemplate: routePath, methods, ...docs });
  }

  endpoints.sort((a, b) => a.pathTemplate.localeCompare(b.pathTemplate));
  cached = { at: now, endpoints };
  return endpoints;
}



