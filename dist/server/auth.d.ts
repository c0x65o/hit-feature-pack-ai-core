import { NextRequest } from 'next/server';
export type UserContext = {
    userId: string;
    email: string;
    roles: string[];
};
export declare function extractUserFromRequest(request: NextRequest): UserContext | null;
//# sourceMappingURL=auth.d.ts.map