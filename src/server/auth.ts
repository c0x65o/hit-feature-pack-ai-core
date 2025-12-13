import { NextRequest } from 'next/server';

export type UserContext = {
  userId: string;
  email: string;
  roles: string[];
};

function base64UrlDecode(input: string): string {
  // Convert base64url -> base64
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to 4
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  // Prefer NextRequest cookies API when available.
  const cookieToken = request.cookies.get('hit_token')?.value;
  if (cookieToken) return cookieToken;

  // Fallback: parse cookie header.
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const idx = cookie.indexOf('=');
      if (idx <= 0) continue;
      const name = cookie.slice(0, idx);
      const value = cookie.slice(idx + 1);
      if (name === 'hit_token' && value) return value;
    }
  }

  return null;
}

export function extractUserFromRequest(request: NextRequest): UserContext | null {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(base64UrlDecode(parts[1])) as any;
    if (payload?.exp && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return null;
    }

    const role = payload?.role;
    const roles = Array.isArray(payload?.roles) ? payload.roles : [];
    const normalizedRoles =
      role && !roles.includes(role) ? [role, ...roles] : roles.length ? roles : role ? [role] : [];

    const userId = payload?.sub || payload?.user_id || payload?.email;
    const email = payload?.email || payload?.sub;
    if (!userId || !email) return null;

    return { userId: String(userId), email: String(email), roles: normalizedRoles.map(String) };
  } catch {
    return null;
  }
}



