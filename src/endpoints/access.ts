// Records one visit to a page, or one photo opened in the lightbox, in the access log (src/config/access-log.ts) that
// the Admin page's Access Info tab shows. Every page reports itself here (src/lib/access-beacon.ts); the time and the
// visitor's address are the Worker's own, never the page's. Same origin, so the policy's `connect-src 'self'` covers it.
// Added as POST /api/access by astro.config.mjs (accessLogEndpoint) to the real build and `astro dev` only: the tests'
// snapshot build stays all static files, as before (site-render.feature tests this endpoint in the real build).
import type { APIRoute } from 'astro';
import { geoFrom, parseBeacon, recordAccess, type LogBucket } from '../config/access-log';

export const prerender = false;

const MAX_BODY_BYTES = 2048;

const answer = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Only the site's own pages report visits: a browser always says which page a POST comes from.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return answer(403);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return answer(413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return answer(400);
  }
  const beacon = parseBeacon(body);
  if (!beacon) return answer(400);

  const { env } = await import('cloudflare:workers');
  const bucket = (env as { ACCESS?: LogBucket }).ACCESS;
  if (!bucket) return answer(503);
  // Cloudflare's own header in production; under `astro dev`, the address of the connection.
  let ip = request.headers.get('CF-Connecting-IP') ?? '';
  if (!ip) {
    try {
      ip = clientAddress;
    } catch {
      ip = 'unknown';
    }
  }
  // Where Cloudflare places the visitor (request.cf): city, country, continent and time zone, by name.
  const geo = geoFrom((request as Request & { cf?: Parameters<typeof geoFrom>[0] }).cf);
  const result = await recordAccess(bucket, { time: new Date().toISOString(), ip, ...beacon, ...(geo ? { geo } : {}) });
  return answer(result === 'recorded' ? 204 : 503);
};
