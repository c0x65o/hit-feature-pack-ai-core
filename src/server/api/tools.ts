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

  // Deprecated endpoint (legacy): return method catalog under `tools` for backward compatibility.
  const projectRoot = process.cwd();
  const caps = loadCapabilitiesFromDisk(projectRoot);
  const endpoints = Array.isArray(caps?.endpoints) ? caps?.endpoints : [];
  const methods = buildMethodCatalog({ endpoints });

  return NextResponse.json({
    deprecated: true,
    user: { userId: user.userId, email: user.email, roles: user.roles },
    tools: methods.map((m) => ({
      name: m.name,
      description: m.description,
      readOnly: m.readOnly,
      tags: ['method'],
    })),
  });
}



