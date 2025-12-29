import { z } from "zod";
// Schema-only module for:
// - POST /api/ai/execute
const httpRequestInputSchema = z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().default("GET"),
    path: z.string().min(1),
    query: z.record(z.string(), z.unknown()).nullable().optional(),
    body: z.record(z.string(), z.unknown()).nullable().optional(),
    approved: z.boolean().optional(),
});
const httpBulkInputSchema = z.object({
    requests: z.array(z.object({
        method: z.string().min(1),
        path: z.string().min(1),
        query: z.record(z.string(), z.unknown()).nullable().optional(),
        body: z.record(z.string(), z.unknown()).nullable().optional(),
    })).min(1),
    approved: z.boolean().optional(),
});
export const postBodySchema = z.object({
    toolName: z.enum(["http.request", "http.bulk"]),
    input: z.union([httpRequestInputSchema, httpBulkInputSchema]),
});
