// Where the Admin page's Test Results tab gets its data. The results themselves live in a private R2
// bucket, which nothing public may name or reach; this is the small read-only Worker in
// workers/results-api that serves them to the page. Plain module (no imports) so tests can read it.

/** The results API Worker (workers.dev address of workers/results-api). */
export const RESULTS_API_URL = 'https://photography-site-results.diego-narvaez.workers.dev';

/** The Worker only answers requests coming from these pages (CORS). Keep in step with workers/results-api/wrangler.jsonc. */
export const RESULTS_API_ALLOWED_ORIGINS = ['https://photography-site.diego-narvaez.workers.dev', 'https://diego-narvaez-photography.org', 'http://localhost:4321'] as const;
