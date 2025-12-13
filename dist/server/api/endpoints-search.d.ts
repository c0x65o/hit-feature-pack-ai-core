import { NextRequest, NextResponse } from 'next/server';
export declare const dynamic = "force-dynamic";
export declare const runtime = "nodejs";
type Endpoint = {
    pathTemplate: string;
    methods: string[];
    summary?: string;
    methodDocs?: Record<string, string>;
};
export declare function GET(request: NextRequest): Promise<NextResponse<{
    error: string;
}> | NextResponse<{
    query: string;
    candidates: Endpoint[];
}>>;
export {};
//# sourceMappingURL=endpoints-search.d.ts.map