export type DiscoveredEndpoint = {
    pathTemplate: string;
    methods: string[];
    summary?: string;
    methodDocs?: Record<string, string>;
};
export declare function discoverAppApiEndpoints(projectRoot: string): DiscoveredEndpoint[];
//# sourceMappingURL=ai-endpoints.d.ts.map