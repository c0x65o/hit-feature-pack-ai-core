import { NextRequest, NextResponse } from 'next/server';
export declare const dynamic = "force-dynamic";
export declare const runtime = "nodejs";
export declare function GET(request: NextRequest): Promise<NextResponse<{
    error: string;
}> | NextResponse<{
    deprecated: boolean;
    user: {
        userId: string;
        email: string;
        roles: string[];
    };
    tools: {
        name: string;
        description: string;
        readOnly: boolean;
        tags: string[];
    }[];
}>>;
//# sourceMappingURL=tools.d.ts.map