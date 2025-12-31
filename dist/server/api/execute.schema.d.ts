import { z } from "zod";
export declare const postBodySchema: z.ZodObject<{
    toolName: z.ZodEnum<{
        "http.request": "http.request";
        "http.bulk": "http.bulk";
    }>;
    input: z.ZodUnion<readonly [z.ZodObject<{
        method: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            DELETE: "DELETE";
            POST: "POST";
            GET: "GET";
            PUT: "PUT";
            PATCH: "PATCH";
        }>>>;
        path: z.ZodString;
        query: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        body: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        approved: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>, z.ZodObject<{
        requests: z.ZodArray<z.ZodObject<{
            method: z.ZodString;
            path: z.ZodString;
            query: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
            body: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        }, z.core.$strip>>;
        approved: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>;
}, z.core.$strip>;
//# sourceMappingURL=execute.schema.d.ts.map