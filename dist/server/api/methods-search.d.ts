import { NextRequest, NextResponse } from 'next/server';
export declare const dynamic = "force-dynamic";
export declare const runtime = "nodejs";
type MethodSpec = {
    name: string;
    method: string;
    pathTemplate: string;
    description: string;
    pathParams: string[];
    readOnly: boolean;
    requiredBodyFields?: string[];
};
export declare function GET(request: NextRequest): Promise<NextResponse<{
    error: string;
}> | NextResponse<{
    query: string;
    candidates: MethodSpec[];
}>>;
export {};
//# sourceMappingURL=methods-search.d.ts.map