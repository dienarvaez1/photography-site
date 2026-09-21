// Read-only API over the private test-results bucket (results/ in photography-site-test).
//
//   GET /health                         is the API up, and is its secret set?   (public)
//   GET /index                          results/index.json: the list of runs    (token)
//   GET /latest                         results/latest.json: the newest run     (token)
//   GET /runs/<run id>                  that run's summary + signed file links  (token)
//   GET /files/<run id>/<path>?exp&sig  one stored file, for a short time       (signature)
//
// "token" = `Authorization: Bearer <ADMIN_TOKEN>`. Files are opened by links the run endpoint signs
// (HMAC of the path and an expiry, keyed by the token), so a link can be opened in a new tab or an <img>
// without ever putting the token in a URL. The API only ever reads under results/, never writes, and
// refuses everything until ADMIN_TOKEN is set (and long enough).
const PREFIX = 'results/';
const MIN_TOKEN_LENGTH = 16;
const LINK_TTL_SECONDS = 900;
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const FILE_TYPES = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  zip: 'application/zip',
};

const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** Constant-time comparison: hash both sides first so lengths and prefixes leak nothing. */
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

const allowedOrigins = (env) => String(env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  return origin && allowedOrigins(env).includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600' }
    : { Vary: 'Origin' };
}

const BASE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' } });
}

const fail = (request, env, status, error, message) => json(request, env, status, { error, message });

/** Is the request's bearer token the admin token? Distinguishes "not set up" (503) from "wrong" (401). */
async function authorize(request, env) {
  const secret = String(env.ADMIN_TOKEN ?? '');
  if (secret.length < MIN_TOKEN_LENGTH) return fail(request, env, 503, 'not-configured', `The API has no admin token yet (set ADMIN_TOKEN, ${MIN_TOKEN_LENGTH}+ characters).`);
  const given = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  return given && (await safeEqual(given, secret)) ? null : fail(request, env, 401, 'unauthorized', 'Missing or wrong admin token.');
}

const fileKey = (runId, path) => `${PREFIX}runs/${runId}/${path}`;

/** A time-limited link to one stored file, signed so it can be opened without the token. */
async function signedLink(request, secret, runId, path, now) {
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  const signature = await sign(secret, `${runId}/${path}|${exp}`);
  const base = new URL(request.url).origin;
  return `${base}/files/${runId}/${path.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${signature}`;
}

async function runRoute(request, env, runId, now) {
  const object = await env.RESULTS.get(fileKey(runId, 'summary.json'));
  if (!object) return fail(request, env, 404, 'not-found', `No run "${runId}".`);
  const summary = await object.json();
  const links = {};
  const prefix = `${PREFIX}runs/${runId}/`;
  for (const key of summary.files ?? []) {
    const path = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    if (path && path.split('/').every((segment) => SEGMENT.test(segment))) {
      links[path] = await signedLink(request, String(env.ADMIN_TOKEN), runId, path, now);
    }
  }
  return json(request, env, 200, { summary, links, linksExpireInSeconds: LINK_TTL_SECONDS });
}

async function fileRoute(request, env, runId, segments, now) {
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';
  const secret = String(env.ADMIN_TOKEN ?? '');
  const path = segments.join('/');
  if (secret.length < MIN_TOKEN_LENGTH) return fail(request, env, 503, 'not-configured', 'The API has no admin token yet.');
  if (!Number.isFinite(exp) || exp * 1000 < now) return fail(request, env, 403, 'expired', 'This link has expired. Reload the run to get a new one.');
  if (!signature || !(await safeEqual(signature, await sign(secret, `${runId}/${path}|${exp}`)))) return fail(request, env, 403, 'forbidden', 'Bad link signature.');

  const object = await env.RESULTS.get(fileKey(runId, path));
  if (!object) return fail(request, env, 404, 'not-found', 'No such file.');
  const extension = path.split('.').pop().toLowerCase();
  const headers = { ...BASE_HEADERS, 'Content-Type': FILE_TYPES[extension] ?? 'application/octet-stream', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  // A stored HTML report is rendered from this Worker's own origin, sandboxed: it can run its scripts
  // but can't reach anything of the site or the API.
  if (extension === 'html') headers['Content-Security-Policy'] = 'sandbox allow-scripts';
  if (extension === 'zip') headers['Content-Disposition'] = `attachment; filename="${segments.at(-1)}"`;
  return new Response(object.body, { status: 200, headers });
}

const decode = (part) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return '%'; // an undecodable segment can never match a valid id or path segment
  }
};

/** The whole API. `now` is injectable so tests can check link expiry. */
export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    const cors = corsHeaders(request, env);
    return cors['Access-Control-Allow-Origin'] ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
  }
  if (request.method !== 'GET') return fail(request, env, 405, 'method-not-allowed', 'Read-only API: use GET.');

  const parts = url.pathname.split('/').filter(Boolean).map(decode);
  const [route, runId, ...rest] = parts;

  if (route === 'health' && parts.length === 1) return json(request, env, 200, { ok: true, configured: String(env.ADMIN_TOKEN ?? '').length >= MIN_TOKEN_LENGTH });

  if (route === 'files') {
    if (!RUN_ID.test(runId ?? '') || !rest.length || !rest.every((s) => SEGMENT.test(s))) return fail(request, env, 400, 'bad-request', 'Bad file path.');
    return fileRoute(request, env, runId, rest, now);
  }

  if (route === 'index' || route === 'latest' || route === 'runs') {
    const denied = await authorize(request, env);
    if (denied) return denied;
    if (route === 'runs') {
      if (!RUN_ID.test(runId ?? '') || rest.length) return fail(request, env, 400, 'bad-request', 'Bad run id.');
      return runRoute(request, env, runId, now);
    }
    if (parts.length !== 1) return fail(request, env, 404, 'not-found', 'Not found.');
    const object = await env.RESULTS.get(`${PREFIX}${route}.json`);
    if (!object) return route === 'index' ? json(request, env, 200, { updatedAt: null, runs: [] }) : fail(request, env, 404, 'not-found', 'No results yet.');
    return new Response(object.body, { status: 200, headers: { ...BASE_HEADERS, ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' } });
  }

  return fail(request, env, 404, 'not-found', 'Not found.');
}

export default { fetch: (request, env) => handle(request, env) };
