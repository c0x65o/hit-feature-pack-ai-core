import fs from 'node:fs';
import path from 'node:path';
function extractPathParams(pathTemplate) {
    const params = [];
    const re = /\[([^\]]+)\]/g;
    let m = null;
    while ((m = re.exec(pathTemplate))) {
        if (m[1])
            params.push(m[1]);
    }
    return params;
}
export function methodNameFor(pathTemplate, method) {
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
export function loadCapabilitiesFromDisk(projectRoot) {
    const capsPath = path.join(projectRoot, '.hit', 'generated', 'capabilities.json');
    if (!fs.existsSync(capsPath))
        return null;
    try {
        const raw = fs.readFileSync(capsPath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function buildMethodCatalog(caps) {
    const endpoints = Array.isArray(caps.endpoints) ? caps.endpoints : [];
    const out = [];
    for (const ep of endpoints) {
        const methods = Array.isArray(ep.methods) ? ep.methods : [];
        for (const method of methods) {
            const m = String(method || '').toUpperCase();
            if (!m)
                continue;
            const doc = ep.methodDocs?.[m] || ep.summary || '';
            const desc = `${m} ${ep.pathTemplate}${doc ? ` — ${doc}` : ''}`.trim();
            const requiredBodyFields = Array.isArray(ep.requiredBodyFields?.[m]) ? ep.requiredBodyFields?.[m] : undefined;
            const bodyFields = Array.isArray(ep.bodyFields?.[m]) ? ep.bodyFields?.[m] : undefined;
            const queryParams = Array.isArray(ep.queryParams) ? ep.queryParams : undefined;
            out.push({
                name: methodNameFor(ep.pathTemplate, m),
                method: m,
                pathTemplate: ep.pathTemplate,
                description: desc,
                pathParams: extractPathParams(ep.pathTemplate),
                requiredBodyFields,
                bodyFields,
                queryParams,
                readOnly: m === 'GET',
            });
        }
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
}
