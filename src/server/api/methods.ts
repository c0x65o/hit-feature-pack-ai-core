import { NextRequest, NextResponse } from 'next/server';
import { extractUserFromRequest } from '../auth';
import { buildMethodCatalog, loadCapabilitiesFromDisk } from '../lib/ai-methods';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = extractUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectRoot = process.cwd();
  const caps = loadCapabilitiesFromDisk(projectRoot);
  const endpoints = Array.isArray(caps?.endpoints) ? caps?.endpoints : [];

  const methods = buildMethodCatalog({ endpoints });
  return NextResponse.json({
    generated: Boolean(caps?.generated),
    kind: 'hit-method-catalog',
    methods,
  });
}



