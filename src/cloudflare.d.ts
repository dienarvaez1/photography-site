// The bindings the Worker has (see wrangler.jsonc). Only what the site uses is described here.
declare module 'cloudflare:workers' {
  export const env: {
    /** The public web bucket: `photos/index.json` and the photos' pictures. */
    WEB?: { get(key: string): Promise<{ text(): Promise<string> } | null> };
    /** The static files of the site (dist/client). */
    ASSETS?: { fetch(request: Request): Promise<Response> };
    /** Seconds the Worker keeps the manifest between reads (default 10; the tests use 0). */
    MANIFEST_CACHE_SECONDS?: string;
  };
}
