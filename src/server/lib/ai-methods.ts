import fs from 'node:fs';
import path from 'node:path';

export type CapabilityEndpoint = {
  pathTemplate: string;
  methods: string[];
  summary?: string;
  methodDocs?: Record<string, string>;
  requiredBodyFields?: Record<string, string[]>;
};

export type CapabilitiesFile = {
  generated?: boolean;
  kind?: string;
  endpoints?: CapabilityEndpoint[];
};

export type MethodSpec = {
  name: string;
  method: string;
  pathTemplate: string;
  description: string;
  pathParams: string[];
  requiredBodyFields?: string[];
  readOnly: boolean;
};

function extractPathParams(pathTemplate: string): string[] {
  const params: string[] = [];
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(pathTemplate))) {
    if (m[1]) params.push(m[1]);
  }
  return params;
}

export function methodNameFor(pathTemplate: string, method: string): string {
  const cleaned = pathTemplate
    .replace(/^\//, '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const m = method.toUpperCase();
  return `route_${cleaned}__${m}`;
}

export function loadCapabilitiesFromDisk(projectRoot: string): CapabilitiesFile | null {
  const capsPath = path.join(projectRoot, '.hit', 'generated', 'capabilities.json');
  if (!fs.existsSync(capsPath)) return null;
  try {
    const raw = fs.readFileSync(capsPath, 'utf8');
    return JSON.parse(raw) as CapabilitiesFile;
  } catch {
    return null;
  }
}

export function buildMethodCatalog(caps: CapabilitiesFile): MethodSpec[] {
  const endpoints = Array.isArray(caps.endpoints) ? caps.endpoints : [];
  const out: MethodSpec[] = [];

  for (const ep of endpoints) {
    const methods = Array.isArray(ep.methods) ? ep.methods : [];
    for (const method of methods) {
      const m = String(method || '').toUpperCase();
      if (!m) continue;
      const doc = ep.methodDocs?.[m] || ep.summary || '';
      const desc = `${m} ${ep.pathTemplate}${doc ? ` — ${doc}` : ''}`.trim();
      const requiredBodyFields = Array.isArray(ep.requiredBodyFields?.[m]) ? ep.requiredBodyFields?.[m] : undefined;
      out.push({
        name: methodNameFor(ep.pathTemplate, m),
        method: m,
        pathTemplate: ep.pathTemplate,
        description: desc,
        pathParams: extractPathParams(ep.pathTemplate),
        requiredBodyFields,
        readOnly: m === 'GET',
      });
    }
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}



