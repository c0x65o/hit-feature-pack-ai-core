/**
 * AI Module Proxy Route (with authentication)
 *
 * Overrides the generic module proxy for the AI module to require auth.
 */
import { NextResponse } from 'next/server';
import { extractUserFromRequest } from '../auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function getAiModuleUrl() {
    const url = process.env.HIT_AI_URL;
    if (url)
        return url;
    if (process.env.NODE_ENV === 'development') {
        return 'http://localhost:8000';
    }
    return null;
}
function getClientIP(req) {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
        const ip = forwardedFor.split(',')[0]?.trim();
        if (ip)
            return ip;
    }
    const realIP = req.headers.get('x-real-ip');
    if (realIP)
        return realIP.trim();
    return null;
}
async function proxyRequest(req, pathSegments, method) {
    const user = extractUserFromRequest(req);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized - authentication required for AI features' }, { status: 401 });
    }
    const moduleUrl = getAiModuleUrl();
    if (!moduleUrl) {
        return NextResponse.json({ error: 'AI module not configured' }, { status: 503 });
    }
    const path = pathSegments.join('/');
    const url = new URL(req.url);
    const fullUrl = `${moduleUrl}/${path}${url.search}`;
    const headers = {
        'Content-Type': 'application/json',
    };
    // Forward auth header (or synthesize from cookie)
    let authHeader = req.headers.get('authorization');
    if (!authHeader) {
        const cookie = req.cookies.get('hit_token')?.value;
        if (cookie)
            authHeader = `Bearer ${cookie}`;
    }
    if (authHeader)
        headers['Authorization'] = authHeader;
    const clientIP = getClientIP(req);
    if (clientIP) {
        headers['X-Forwarded-For'] = clientIP;
        headers['X-Real-IP'] = clientIP;
    }
    const userAgent = req.headers.get('user-agent');
    if (userAgent) {
        headers['X-Forwarded-User-Agent'] = userAgent;
        headers['User-Agent'] = userAgent;
    }
    const serviceToken = process.env.HIT_SERVICE_TOKEN;
    if (serviceToken) {
        headers['X-HIT-Service-Token'] = serviceToken;
    }
    try {
        const fetchOptions = { method, headers, redirect: 'manual' };
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            const body = await req.text().catch(() => '');
            if (body)
                fetchOptions.body = body;
        }
        const response = await fetch(fullUrl, fetchOptions);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (location) {
                return NextResponse.redirect(location, { status: response.status, headers: { 'X-Proxied-From': 'ai' } });
            }
        }
        const responseText = await response.text();
        let responseBody;
        try {
            responseBody = JSON.parse(responseText);
        }
        catch {
            responseBody = responseText;
        }
        return NextResponse.json(responseBody, { status: response.status, headers: { 'X-Proxied-From': 'ai' } });
    }
    catch {
        return NextResponse.json({ error: 'Failed to proxy request to AI module', path }, { status: 502 });
    }
}
export async function GET(req, { params }) {
    return proxyRequest(req, params.path, 'GET');
}
export async function POST(req, { params }) {
    return proxyRequest(req, params.path, 'POST');
}
export async function PUT(req, { params }) {
    return proxyRequest(req, params.path, 'PUT');
}
export async function PATCH(req, { params }) {
    return proxyRequest(req, params.path, 'PATCH');
}
export async function DELETE(req, { params }) {
    return proxyRequest(req, params.path, 'DELETE');
}
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
