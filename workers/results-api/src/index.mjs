// Read-only API over the private test-results bucket (results/ in photography-site-test).
//
//   GET /health                         is the API up, and is its secret set?   (public)
//   GET /index                          results/index.json: the list of runs    (token)
//   GET /latest                         results/latest.json: the newest run     (token)
//   GET /runs/<run id>                  that run's summary + signed file links  (token)
//   GET /files/<run id>/<path>?exp&sig  one stored file, for a short time       (signature)
//   GET /pics                           the originals in photography-site-originals (token)
//   GET /pics/<photo id>                one original's size, camera and copyright (token)
//   GET /lighthouse/index               lighthouse-results/index.json: the Lighthouse runs  (token)
//   GET /lighthouse/latest              lighthouse-results/latest.json: the newest run      (token)
//   GET /lighthouse/runs/<run id>       that run's summary + signed report links            (token)
//   GET /lighthouse/files/<run id>/<path>?exp&sig   one stored report, for a short time     (signature)
//   GET /github/issues?state=open|closed|all       the site's GitHub issues, newest-updated first (token)
//
// "token" = `Authorization: Bearer <ADMIN_TOKEN>`. Files are opened by links the run endpoint signs
// (HMAC of the path and an expiry, keyed by the token), so a link can be opened in a new tab or an <img>
// without ever putting the token in a URL. The API only ever reads under results/ and lighthouse-results/ of the test
// bucket, never writes, and refuses everything until ADMIN_TOKEN is set (and long enough). GitHub is only ever read too.
import { GitHubError, ISSUE_STATES, listIssues } from './issues.mjs';
import { PHOTO_ID, describeOriginal, listOriginals } from './pics.mjs';

/**
 * The two run stores in the test bucket, read the same way: an index, a latest summary, runs with files. A signature is
 * bound to its store (`sign` below), so a link to one store's file can never open the other's.
 */
const STORES = {
  results: { prefix: 'results/', files: '/files', signing: '' },
  lighthouse: { prefix: 'lighthouse-results/', files: '/lighthouse/files', signing: 'lighthouse:' },
};
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

const fileKey = (store, runId, path) => `${store.prefix}runs/${runId}/${path}`;
const signingMessage = (store, runId, path, exp) => `${store.signing}${runId}/${path}|${exp}`;

/** A time-limited link to one stored file, signed so it can be opened without the token. */
async function signedLink(origin, store, secret, runId, path, exp) {
  const signature = await sign(secret, signingMessage(store, runId, path, exp));
  return `${origin}${store.files}/${runId}/${path.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${signature}`;
}

async function runRoute(request, env, store, runId, now) {
  const object = await env.RESULTS.get(fileKey(store, runId, 'summary.json'));
  if (!object) return fail(request, env, 404, 'not-found', `No run "${runId}".`);
  const summary = await object.json();
  const links = {};
  const prefix = `${store.prefix}runs/${runId}/`;
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  for (const key of summary.files ?? []) {
    const path = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    if (path && path.split('/').every((segment) => SEGMENT.test(segment))) {
      links[path] = await signedLink(new URL(request.url).origin, store, String(env.ADMIN_TOKEN), runId, path, exp);
    }
  }
  return json(request, env, 200, { summary, links, linksExpireInSeconds: LINK_TTL_SECONDS });
}

/**
 * A Lighthouse run's index page links to each report by its bare file name (mobile-home.html), which would reach this
 * API without a signature. Served from here, those links are signed with the same expiry as the page's own link, so the
 * page works exactly as it does on disk. Only bare file names of this run are touched; anything else is left alone.
 */
async function signReportLinks(html, origin, store, secret, runId, exp) {
  const names = new Set([...html.matchAll(/href="([A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html)"/g)].map((m) => m[1]));
  let signed = html;
  for (const name of names) signed = signed.replaceAll(`href="${name}"`, `href="${await signedLink(origin, store, secret, runId, name, exp)}"`);
  return signed;
}

async function fileRoute(request, env, store, runId, segments, now) {
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';
  const secret = String(env.ADMIN_TOKEN ?? '');
  const path = segments.join('/');
  if (secret.length < MIN_TOKEN_LENGTH) return fail(request, env, 503, 'not-configured', 'The API has no admin token yet.');
  if (!Number.isFinite(exp) || exp * 1000 < now) return fail(request, env, 403, 'expired', 'This link has expired. Reload the run to get a new one.');
  if (!signature || !(await safeEqual(signature, await sign(secret, signingMessage(store, runId, path, exp))))) return fail(request, env, 403, 'forbidden', 'Bad link signature.');

  const object = await env.RESULTS.get(fileKey(store, runId, path));
  if (!object) return fail(request, env, 404, 'not-found', 'No such file.');
  const extension = path.split('.').pop().toLowerCase();
  const headers = { ...BASE_HEADERS, 'Content-Type': FILE_TYPES[extension] ?? 'application/octet-stream', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  // A stored HTML report is rendered from this Worker's own origin, sandboxed: it can run its scripts
  // but can't reach anything of the site or the API.
  if (extension === 'html') headers['Content-Security-Policy'] = 'sandbox allow-scripts';
  if (extension === 'zip') headers['Content-Disposition'] = `attachment; filename="${segments.at(-1)}"`;
  if (store === STORES.lighthouse && path === 'index.html') {
    return new Response(await signReportLinks(await object.text(), url.origin, store, secret, runId, exp), { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

/** GET /index, /latest, /runs/<id> of one store (the caller has checked the token). */
async function storeRoute(request, env, store, parts, now) {
  const [route, runId, ...rest] = parts;
  if (route === 'runs') {
    if (!RUN_ID.test(runId ?? '') || rest.length) return fail(request, env, 400, 'bad-request', 'Bad run id.');
    return runRoute(request, env, store, runId, now);
  }
  if (!['index', 'latest'].includes(route) || parts.length !== 1) return fail(request, env, 404, 'not-found', 'Not found.');
  const object = await env.RESULTS.get(`${store.prefix}${route}.json`);
  if (!object) return route === 'index' ? json(request, env, 200, { updatedAt: null, runs: [] }) : fail(request, env, 404, 'not-found', 'No results yet.');
  return new Response(object.body, { status: 200, headers: { ...BASE_HEADERS, ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' } });
}

const decode = (part) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return '%'; // an undecodable segment can never match a valid id or path segment
  }
};

/** GET /github/issues (the caller has checked the token). */
async function issuesRoute(request, env, fetcher) {
  const state = new URL(request.url).searchParams.get('state') ?? 'open';
  if (!ISSUE_STATES.includes(state)) return fail(request, env, 400, 'bad-request', `Bad state: use ${ISSUE_STATES.join(', ')}.`);
  try {
    return json(request, env, 200, await listIssues(env, state, fetcher));
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    const message = { misconfigured: 'GITHUB_REPO is not set to owner/name on this Worker.', 'rate-limited': "GitHub's rate limit was reached. Try again later, or set GITHUB_TOKEN." }[error.kind];
    return fail(request, env, error.status, error.kind, message ?? 'GitHub did not answer as expected.');
  }
}

/** The whole API. `now` is injectable so tests can check link expiry, and `fetcher` so they can stand in for GitHub. */
export async function handle(request, env, now = Date.now(), fetcher = fetch) {
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
    return fileRoute(request, env, STORES.results, runId, rest, now);
  }

  if (route === 'lighthouse') {
    const [, sub, id, ...more] = parts;
    if (sub === 'files') {
      if (!RUN_ID.test(id ?? '') || !more.length || !more.every((s) => SEGMENT.test(s))) return fail(request, env, 400, 'bad-request', 'Bad file path.');
      return fileRoute(request, env, STORES.lighthouse, id, more, now);
    }
    const denied = await authorize(request, env);
    if (denied) return denied;
    return storeRoute(request, env, STORES.lighthouse, parts.slice(1), now);
  }

  if (route === 'pics') {
    const denied = await authorize(request, env);
    if (denied) return denied;
    if (!env.ORIGINALS) return fail(request, env, 500, 'misconfigured', 'The originals bucket is not bound to this Worker.');
    if (!runId) return json(request, env, 200, await listOriginals(env.ORIGINALS));
    if (!PHOTO_ID.test(runId) || rest.length) return fail(request, env, 400, 'bad-request', 'Bad photo id.');
    const photo = await describeOriginal(env.ORIGINALS, runId);
    return photo ? json(request, env, 200, photo) : fail(request, env, 404, 'not-found', `No original "${runId}".`);
  }

  if (route === 'github') {
    const denied = await authorize(request, env);
    if (denied) return denied;
    if (runId !== 'issues' || rest.length) return fail(request, env, 404, 'not-found', 'Not found.');
    return issuesRoute(request, env, fetcher);
  }

  if (route === 'index' || route === 'latest' || route === 'runs') {
    const denied = await authorize(request, env);
    if (denied) return denied;
    return storeRoute(request, env, STORES.results, parts, now);
  }

  return fail(request, env, 404, 'not-found', 'Not found.');
}

export default { fetch: (request, env) => handle(request, env) };
