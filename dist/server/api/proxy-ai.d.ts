/**
 * AI Module Proxy Route (with authentication)
 *
 * Overrides the generic module proxy for the AI module to require auth.
 */
import { NextRequest, NextResponse } from 'next/server';
export declare const dynamic = "force-dynamic";
export declare const runtime = "nodejs";
type RouteParams = {
    params: {
        path: string[];
    };
};
export declare function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse<unknown>>;
export declare function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse<unknown>>;
export declare function PUT(req: NextRequest, { params }: RouteParams): Promise<NextResponse<unknown>>;
export declare function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse<unknown>>;
export declare function DELETE(req: NextRequest, { params }: RouteParams): Promise<NextResponse<unknown>>;
export declare function OPTIONS(): Promise<NextResponse<unknown>>;
export {};
//# sourceMappingURL=proxy-ai.d.ts.map