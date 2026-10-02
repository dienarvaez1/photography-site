import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, AfterAll, Before, Status, setDefaultTimeout } from '@cucumber/cucumber';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.js';
import { ROOT } from './lib.js';
import { asR2Binding } from './r2-binding.js';
import { publishRuns } from './results-fixtures.js';
import { fakeOriginals } from './originals-fixtures.js';
import { noGitHub } from './github-fixtures.js';
import { fakeAccessBucket } from './access-fixtures.js';

// The category page's client-side category switcher (Phase 6) fetches /api/photos.json from the
// site's own origin (see src/pages/api/photos.json.ts) — a real route the snapshot build already
// generates from the same sample library every other offline scenario tests against, so it needs no
// mocking of its own: it's just another same-origin file the static server (below) serves as built.

// The results API is the real Worker code answering from a fake bucket of really-published runs, so the
// browser tests cover the actual contract between the publisher, the API and the Admin page.
const { handle: handleResultsRequest } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));
const { RESULTS_API_URL } = await import(join(ROOT, 'src/config/results.ts'));
const RESULTS_ORIGIN = new URL(RESULTS_API_URL).origin;
// What the dev server's middleware does to every page's headers (src/middleware.ts), for scenarios about `astro dev`.
const { withLocalApi } = await import(join(ROOT, 'src/lib/headers-file.ts'));
// The New Photo form's service is the real dev-server middleware too, over a temporary content folder and a fake R2.
const { photoFormMiddleware } = await import(join(ROOT, 'scripts/lib/photo-form-server.mjs'));
// Category Maintenance's service, the same way — see startCategoryService below.
// Remove Results' service (the Test Results tab), the same way, over the scenario's own fake results bucket.
const { resultsFormMiddleware } = await import(join(ROOT, 'scripts/lib/results-form-server.mjs'));
const { categoryFormMiddleware } = await import(join(ROOT, 'scripts/lib/category-form-server.mjs'));

// Real-browser scenarios are slower than the rest: page loads, axe scans, animations.
setDefaultTimeout(60_000);

let browser;
let server;
let imageBytes;
let currentWorld = null; // the scenario now running (the shared test server answers /__photos/ on its behalf)

/** One Chromium and one local copy of the built site, shared by every @browser scenario. */
async function shared() {
  if (!browser) browser = await chromium.launch();
  if (!server) {
    server = await startStaticServer();
    server.mount('/__photos/', servePhotoService);
    server.mount('/__categories/', serveCategoryService);
    server.mount('/__results/', serveResultsService);
  }
  if (!imageBytes) imageBytes = await sharp({ create: { width: 16, height: 11, channels: 3, background: '#557' } }).webp().toBuffer();
  return { browser, server, imageBytes };
}

AfterAll(async function () {
  await browser?.close();
  await server?.close();
});

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

Before({ tags: '@browser' }, function () {
  currentWorld = this;
  // Everything a scenario can configure before the first page is opened.
  this.b = {
    device: LAPTOP,
    locale: 'en-US',
    javaScriptEnabled: true,
    reducedMotion: 'no-preference',
    userAgent: undefined,
    trace: 'not-found', // what /cdn-cgi/trace answers: 'not-found', 'unreachable', 'timeout' or a body like "loc=MX"
    api: 'success', // what Web3Forms answers: 'success', 'failure', 'unreachable', 'slow'
    imageDelayMs: 0,
    clock: false, // true: the page's clock is Playwright's, so a scenario can let minutes pass at once
    remembered: null, // localStorage 'preferred-locale' to set before the first visit
    initScripts: [], // extra scripts to run in every page before its own (e.g. block localStorage)
    csp: [], // Content-Security-Policy violations, accumulated across navigations
    lastStatus: null, // status of the most recent page navigation
    viewportOverride: null,
    apiRequests: [],
    // What the results API is doing: 'ok' (answers), 'unreachable', or 'slow'; `env` is its Worker environment (no
    // admin token until a scenario sets one up), `requests` is everything the page asked it. `localOrigin`: it also
    // answers there, as `npm run results-api:dev` does on this computer (the Admin page's `?api=` override).
    // The results API has every bucket production has, empty until a scenario fills one: the access log (the Admin
    // page opens on Access Info, which reads it) and the originals (a quick visit to the Pics Viewer asks for them;
    // without the bucket the API answers 500, which a scenario about errors would catch, depending on timing).
    results: { mode: 'ok', env: { ACCESS: fakeAccessBucket([]), ORIGINALS: fakeOriginals([]).binding }, delayMs: 0, requests: [], localOrigin: null },
    // true: pages come with the headers the dev server sends (src/middleware.ts under `astro dev`), not the deployed site's.
    devHeaders: false,
    // The New Photo form's local service: null (as on the deployed site, which has none) or { middleware, requests }.
    photoService: null,
    // Category Maintenance's local service — same shape, same reasoning.
    categoryService: null,
    // Remove Results' local service — the same again — and the file where it saves the CI run it follows.
    resultsService: null,
    ciStateFile: null,
    localStateFile: null,
    branches: null,
    traceRequests: 0,
    // When each request for the visitor's location (/cdn-cgi/trace) arrived here, and requests that failed in the
    // browser: what a failed language-redirect scenario reports, to say why (issue #12).
    traceTimes: [],
    failedRequests: [],
    // What the pages reported to the access log (POST /api/access), in order, as sent: { page, event, photo? }.
    accessReports: [],
    photoRequests: [],
    manifestRequests: [],
    pageRequests: [],
    blocked: [],
    consoleErrors: [],
    context: null,
    page: null,
  };
});

const SHARP_LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };

export function useDevice(world, kind) {
  world.b.device = kind === 'phone' ? PHONE : kind === 'laptop with a sharp screen' ? SHARP_LAPTOP : LAPTOP;
}

/** Publishes runs (see results-fixtures.js) into a fake results bucket behind the API, which then knows this admin token. */
export async function setUpResultsApi(world, token, runs) {
  const { bucket, runIds } = await publishRuns(runs);
  Object.assign(world.b.results, { token, bucket, runIds, env: { ...world.b.results.env, ADMIN_TOKEN: token, RESULTS: asR2Binding(bucket) } });
}

/**
 * Adds Lighthouse runs (published by the real publisher, from made-up measurements) to the same fake test bucket the
 * results API reads, so the Lighthouse Test Results tab reads them through the real API code. `runs`: [{ time, commit,
 * phone, laptop }] (performance scores, 0–100), oldest first. Call after setUpResultsApi.
 */
export async function addLighthouseRuns(world, runs) {
  const [{ publishLighthouse }, { fakeResult, writeRunFolder }] = await Promise.all([import(join(ROOT, 'scripts/lib/lighthouse-results.mjs')), import('./lighthouse-fixtures.js')]);
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const lighthouseRunIds = [];
  for (const run of runs) {
    const dir = mkdtempSync(join(tmpdir(), 'lh-browser-'));
    try {
      writeRunFolder(dir, [
        fakeResult('/', 'mobile', { performance: run.phone / 100, lcp: 2400 }),
        fakeResult('/', 'desktop', { performance: run.laptop / 100, lcp: 900 }),
        fakeResult('/about/', 'mobile', { performance: 0.95, lcp: 1800 }),
      ]);
      const { runId } = await publishLighthouse({ dir, storage: world.b.results.bucket, now: new Date(run.time), meta: { commit: run.commit, branch: 'main', dirty: false } });
      lighthouseRunIds.unshift(runId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  world.b.results.lighthouseRunIds = lighthouseRunIds;
}

/**
 * Waits for the Admin page's token box to finish checking a token just submitted (GET /auth is a round trip): the tabs
 * appear, or the box shows why not. Every sign-in step ends with this, so the next step never races the check.
 */
export async function signInSettled(world) {
  const page = world.b.page;
  await page.waitForFunction(() => {
    const tabs = document.querySelector('[data-tabs]');
    const gate = document.querySelector('[data-admin-gate]');
    const button = gate?.querySelector('button[type="submit"]');
    return (tabs && !tabs.hidden) || (gate && !gate.hidden && gate.querySelector('.results-error')) || (button && !button.disabled);
  }, null, { timeout: 8000 });
}

/** Puts a stand-in for the access log bucket (see access-fixtures.js), holding these day files, behind the results API. */
export function setUpAccessLog(world, days) {
  world.b.results.env.ACCESS = fakeAccessBucket(days);
}

/** Puts a stand-in for GitHub (see github-fixtures.js), holding this repository's issues, behind the results API. */
export function setUpGitHub(world, github, repo) {
  world.b.results.github = github;
  world.b.results.env.GITHUB_REPO = repo;
}

/** Puts these original photos ([{ id, body }]) behind the API's ORIGINALS binding; `originals.calls` records every read. */
export function setUpOriginals(world, files, { objects } = {}) {
  const originals = fakeOriginals(files, { objects });
  Object.assign(world.b.results, { originals });
  world.b.results.env.ORIGINALS = originals.binding;
}

async function serveResults(b, siteOrigin, request, route) {
  const results = b.results;
  const url = new URL(request.url());
  // The page's sign-in (GET /auth, admin-gate.ts) is noted apart from what the tabs ask for, which scenarios check exactly.
  const log = url.pathname === '/auth' ? (results.authRequests ??= []) : results.requests;
  log.push({ method: request.method(), path: url.pathname, url: request.url(), authorization: request.headers()['authorization'] ?? '' });
  if (results.mode === 'unreachable') return route.abort('connectionrefused');
  // A results API deployed before GET /auth existed answers it like any unknown route.
  if (results.noAuthRoute && url.pathname === '/auth') return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': siteOrigin }, body: JSON.stringify({ error: 'not-found', message: 'Not found.' }) });
  if (results.delayMs) await new Promise((resolve) => setTimeout(resolve, results.delayMs));
  // Only the site's own origin may read the answers, exactly as in production.
  const env = { ...results.env, ALLOWED_ORIGINS: siteOrigin };
  // GitHub is a stand-in too (setUpGitHub); a scenario without one never reaches the real GitHub.
  const answer = await handleResultsRequest(new Request(request.url(), { method: request.method(), headers: request.headers() }), env, Date.now(), results.github?.fetcher ?? noGitHub);
  let body = Buffer.from(await answer.arrayBuffer());
  if (results.foreignLink && url.pathname.startsWith('/runs/') && answer.status === 200) {
    // A misbehaving API: one of the run's file links points at another site.
    const run = JSON.parse(body.toString('utf-8'));
    run.links[results.foreignLink] = `https://evil.example/files/x/${results.foreignLink}?exp=1&sig=1`;
    body = Buffer.from(JSON.stringify(run));
  }
  return route.fulfill({ status: answer.status, headers: Object.fromEntries(answer.headers), body });
}

/**
 * Starts the New Photo form's service over this scenario's photo library (see photo-helpers.js), as `astro dev`
 * would. The browser's file uploads never reach Playwright's request interception, so the service answers
 * from the local test server itself.
 */
export async function startPhotoService(world, { contentDir, storage, sync = false }) {
  await shared();
  world.b.photoService = { middleware: await photoFormMiddleware({ contentDir, storage, sync }), requests: [] };
}

/** Answers /__photos/ for the scenario that is running (none: the site as deployed, which has no such service). */
function servePhotoService(req, res, next) {
  const service = currentWorld?.b.photoService;
  if (!service) return next();
  service.requests.push({ method: req.method, path: new URL(req.url, 'http://localhost').pathname.replace('/__photos/', '') });
  // A slow service (as on a busy CI runner): scenarios that start one bulk action before the last one finished show up.
  if (service.delayMs) return void setTimeout(() => service.middleware(req, res, next), service.delayMs);
  return service.middleware(req, res, next);
}

/**
 * Remove Results' local service (scripts/lib/results-form.mjs), as `astro dev` adds it, deleting from the same fake
 * bucket the results API reads (setUpResultsApi). Off unless a scenario turns it on (startResultsService), as on the
 * deployed site, which has none.
 */
export async function startResultsService(world) {
  // Run in Production never reaches GitHub or measures anything: the Lighthouse workflow is stood in for. Each start is
  // recorded with its branch (`lighthouseRefs`) and names run 888; GitHub says it is in progress until `after` ms have
  // passed, then completed with `outcome` (a scenario may change it first): `ok` publishes a new run into the fake bucket
  // (as the real workflow does) and succeeds, `over budget` publishes one and fails, `never` stays in progress. Its log
  // then has the publisher's own "published <run id>:" line and the summary line. `confirm` is when the results API has
  // the new run's files: 'at once', after that many ms, or 'never' (they are held back from the bucket until then).
  const service = { requests: [], lighthouseRefs: [], outcome: 'ok', after: 500, confirm: 'at once', newRun: { time: '2026-09-30T10:00:00Z', commit: 'ddddddd', phone: 93, laptop: 99 } };
  const holdBack = (runId) => {
    const { objects } = world.b.results.bucket;
    const held = [...objects].filter(([key]) => key.startsWith(`lighthouse-results/runs/${runId}/`));
    for (const [key] of held) objects.delete(key);
    if (typeof service.confirm === 'number') setTimeout(() => held.forEach(([key, value]) => objects.set(key, value)), service.confirm);
  };
  const LIGHTHOUSE_RUN = { id: '888', url: 'https://github.com/dienarvaez1/photography-site/actions/runs/888' };
  let lighthouseNow = { done: false, log: '' };
  const lighthouse = {
    start: async (ref) => {
      service.lighthouseRefs.push(ref);
      lighthouseNow = { done: false, log: '' };
      const current = lighthouseNow;
      if (service.outcome !== 'never') {
        setTimeout(async () => {
          if (service.outcome === 'over budget') service.newRun = { ...service.newRun, phone: 40 };
          await addLighthouseRuns(world, [service.newRun]);
          const [runId] = world.b.results.lighthouseRunIds;
          if (service.confirm !== 'at once') holdBack(runId);
          const mark = service.outcome === 'ok' ? '✓' : '✗';
          const step = 'lighthouse\tMeasure the live site and store the run in R2\t2026-09-30T10:09:00.0000000Z ';
          current.log = [
            `${step}=== publishing to photography-site-test ===`,
            `${step}${mark} published ${runId}: 2/3 within budget → photography-site-test/lighthouse-results/runs/${runId}/`,
            `${step}${service.outcome === 'ok' ? '✓ every page within budget' : '✗ some pages over budget (see test-results/lighthouse/index.html)'}`,
          ].join('\n');
          current.done = true;
        }, service.after);
      }
      return LIGHTHOUSE_RUN;
    },
    find: async () => LIGHTHOUSE_RUN,
    status: async () => ({ status: lighthouseNow.done ? 'completed' : 'in_progress', conclusion: lighthouseNow.done ? (service.outcome === 'ok' ? 'success' : 'failure') : '', url: LIGHTHOUSE_RUN.url }),
    outcome: async () => publishedFromLog(lighthouseNow.log),
  };
  // Run in CI never reaches GitHub either: starting names run 777 (counted in `ciStarted`), and GitHub's answers about
  // it come from `ciAnswers`, one per question (the last repeats); `ciFailure` makes starting fail. Asked every 200 ms.
  // Branches: GitHub has QA-feature_optimization and main, and this checkout is on QA-feature_optimization, unless a
  // scenario says otherwise (`world.b.branches`, kept across a restart). `ciRefs` lists the branch of each start.
  world.b.branches ??= { onGitHub: ['QA-feature_optimization', 'main'], current: 'QA-feature_optimization' };
  const branches = { list: async () => world.b.branches.onGitHub, current: async () => world.b.branches.current };
  Object.assign(service, { ciRefs: [], ciStarted: 0, ciFailure: null, ciAnswers: [{ status: 'in_progress', conclusion: '' }, { status: 'completed', conclusion: 'success' }] });
  const ci = {
    start: async (ref) => {
      if (service.ciFailure) throw new Error(service.ciFailure);
      service.ciStarted++;
      service.ciRefs.push(ref);
      return { id: '777', url: 'https://github.com/dienarvaez1/photography-site/actions/runs/777' };
    },
    find: async () => ({ id: '777', url: 'https://github.com/dienarvaez1/photography-site/actions/runs/777' }),
    status: async () => ({ ...(service.ciAnswers.length > 1 ? service.ciAnswers.shift() : service.ciAnswers[0]), url: 'https://github.com/dienarvaez1/photography-site/actions/runs/777' }),
  };
  // The run being followed is saved in the scenario's own file (kept across a restart within the scenario), never in
  // the real .astro/run-in-ci.json.
  world.b.ciStateFile ??= join(mkdtempSync(join(tmpdir(), 'run-in-ci-')), 'run-in-ci.json');
  world.b.lighthouseStateFile ??= join(mkdtempSync(join(tmpdir(), 'run-in-production-')), 'run-in-production.json');
  world.b.localStateFile ??= join(mkdtempSync(join(tmpdir(), 'run-locally-')), 'run-locally.json');
  // Running every test in the local checkout is stood in for: each start is recorded (`localRuns`, with where it came
  // from and ran) and ends after 300 ms with `localOutcome` (exit code 0 unless a scenario says otherwise).
  Object.assign(service, { localRuns: [], localOutcome: { code: 0, line: '✓ all suites passed and published' } });
  const record = (run) => {
    service.localRuns.push({ from: run.from, target: run.target });
    setTimeout(() => {
      run.onOutput(service.localOutcome.line);
      run.onExit(service.localOutcome.code);
    }, 300);
  };
  const { publishedFromLog } = await import(join(ROOT, 'scripts/lib/results-form.mjs'));
  service.middleware = await resultsFormMiddleware({
    storage: world.b.results.bucket,
    ci,
    lighthouse,
    branches,
    record,
    localStateFile: world.b.localStateFile,
    ciPollMs: 200,
    ciStateFile: world.b.ciStateFile,
    lighthousePollMs: 200,
    lighthouseStateFile: world.b.lighthouseStateFile,
  });
  world.b.resultsService = service;
}

function serveResultsService(req, res, next) {
  const service = currentWorld?.b.resultsService;
  if (!service) return next();
  const path = new URL(req.url, 'http://localhost').pathname.replace('/__results/', '');
  service.requests.push({ method: req.method, path });
  // A dev server restarting: the next `missChecks` questions about the CI run get no service answer.
  if (req.method === 'GET' && path === 'tests/run' && service.missChecks > 0) {
    service.missChecks--;
    res.statusCode = 502;
    return void res.end('Bad gateway');
  }
  return service.middleware(req, res, next);
}

/**
 * Starts Category Maintenance's service over this scenario's own temporary configuration files (see
 * category-form.feature's own setup) and entries folder, as `astro dev` would.
 */
export async function startCategoryService(world, { contentDir, categoriesFile, localeFiles, storage, sync = false }) {
  await shared();
  world.b.categoryService = { middleware: await categoryFormMiddleware({ contentDir, categoriesFile, localeFiles, storage, sync }), requests: [] };
}

/** Answers /__categories/ for the scenario that is running (none: the site as deployed, which has no such service). */
function serveCategoryService(req, res, next) {
  const service = currentWorld?.b.categoryService;
  if (!service) return next();
  service.requests.push({ method: req.method, path: new URL(req.url, 'http://localhost').pathname.replace('/__categories/', '') });
  return service.middleware(req, res, next);
}

/** Creates the browser context (once per scenario) with the stubs described above. */
export async function open(world) {
  if (world.b.context) return world.b.page;
  const { browser: chromiumBrowser, server: site, imageBytes: image } = await shared();
  const b = world.b;
  const context = await chromiumBrowser.newContext({
    ...b.device,
    locale: b.locale,
    javaScriptEnabled: b.javaScriptEnabled,
    reducedMotion: b.reducedMotion,
    // Headless Chromium announces itself as "HeadlessChrome", which the site rightly treats as a
    // crawler and never redirects; use an ordinary browser's user agent unless a scenario says otherwise.
    userAgent: b.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  world.b.siteOrigin = site.url;
  // Scenarios about time (the idle sign-out) take over the page's clock: it runs normally until they advance it.
  if (b.clock) await context.clock.install({ time: new Date('2026-09-21T12:00:00Z') });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === site.url) {
      if (url.pathname === '/cdn-cgi/trace') {
        b.traceRequests += 1;
        b.traceTimes.push(Date.now());
        if (b.trace === 'unreachable') return route.abort('connectionrefused');
        if (b.trace === 'timeout') return; // never answers: the page's own timeout must handle it
        if (b.trace === 'not-found') return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: 'text/plain', body: `fl=1\n${b.trace}\ntls=TLSv1.3\n` });
      }
      if (b.imageDelayMs && /\.(png|webp|jpg)$/.test(url.pathname)) await new Promise((r) => setTimeout(r, b.imageDelayMs));
      // Every real page navigation on this origin — the category switcher (Phase 6) is supposed to
      // swap categories with fetch() + history.pushState, never a real navigation, so a scenario
      // can check this stayed at exactly one entry (the page's own initial load).
      if (request.isNavigationRequest()) b.pageRequests.push(url.pathname);
      // The category switcher's own manifest fetch (same-origin: see src/pages/api/photos.json.ts) —
      // no mocking needed, just noting it happened; route.continue() below serves the real built file.
      if (url.pathname === '/api/photos.json') b.manifestRequests.push(request.url());
      // The access log's endpoint is the Worker's (src/endpoints/access.ts), which the static test build doesn't run:
      // note what the page reported and answer the way the Worker does when it has recorded it.
      if (url.pathname === '/api/access' && request.method() === 'POST') {
        b.accessReports.push({ origin: request.headers()['origin'] ?? null, ...JSON.parse(request.postData() ?? 'null') });
        return route.fulfill({ status: 204, body: '' });
      }
      if (b.devHeaders && request.isNavigationRequest()) {
        const response = await route.fetch();
        const headers = response.headers();
        const csp = withLocalApi({ 'Content-Security-Policy': headers['content-security-policy'] ?? '' })['Content-Security-Policy'];
        return route.fulfill({ response, headers: { ...headers, 'content-security-policy': csp } });
      }
      return route.continue();
    }
    if (b.results.localOrigin && url.origin === b.results.localOrigin) return serveResults(b, site.url, request, route);
    if (/\.r2\.dev$/.test(url.hostname)) {
      b.photoRequests.push(request.url());
      if (b.imageDelayMs) await new Promise((r) => setTimeout(r, b.imageDelayMs));
      return route.fulfill({ status: 200, contentType: 'image/webp', body: image, headers: { 'cache-control': 'no-store' } });
    }
    if (url.hostname === 'api.web3forms.com') {
      b.apiRequests.push({ method: request.method(), url: request.url(), body: request.postData() ?? '', contentType: request.headers()['content-type'] ?? '' });
      if (b.api === 'unreachable') return route.abort('connectionrefused');
      if (b.api === 'slow') await new Promise((r) => setTimeout(r, 700));
      const ok = b.api !== 'failure';
      if (request.headers()['accept']?.includes('json')) {
        return route.fulfill({ status: ok ? 200 : 400, contentType: 'application/json', body: JSON.stringify({ success: ok, message: ok ? 'sent' : 'rejected' }) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Thanks</title><h1>Thank you</h1>' }); // the plain-form fallback page
    }
    if (url.origin === RESULTS_ORIGIN) return serveResults(b, site.url, request, route);
    b.blocked.push(request.url()); // nothing else may leave the machine
    return route.abort('blockedbyclient');
  });

  // Records Content-Security-Policy violations (across navigations) and layout shifts.
  await context.exposeFunction('__reportCsp', (message) => b.csp.push(message));
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => window.__reportCsp(`${e.violatedDirective}: ${e.blockedURI || 'inline'}`));
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // Not supported: the CLS scenario then fails loudly instead of passing vacuously.
      window.__cls = NaN;
    }
  });

  for (const script of b.initScripts) await context.addInitScript(script);

  // A trace of every scenario; kept (with a screenshot) only when the scenario fails.
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  if (b.viewportOverride) await page.setViewportSize(b.viewportOverride);
  const notFoundPages = new Set();
  page.on('console', (message) => {
    const url = message.location().url;
    // Expected, not errors: the local server has no /cdn-cgi/trace (Cloudflare provides it), and Chrome
    // logs a line whenever a page itself is a 404 - which is exactly what the 404 scenarios visit.
    // The same goes for the New Photo form's service, which the deployed site (and so this test server) does not have.
    if (message.type() === 'error' && !url.endsWith('/cdn-cgi/trace') && !url.includes('/__photos/') && !notFoundPages.has(url)) b.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    const request = response.request();
    // A real top-level navigation, or — since Astro's <ClientRouter/> (astro:transitions) swaps
    // pages in place with a fetch() rather than a real navigation — its own same-origin fetch of a
    // page's HTML, which is functionally equivalent from a visitor's point of view. Astro's own
    // fetchHTML() only ever accepts a text/html (or xhtml+xml) response for this, which is a
    // reliable enough signature to tell it apart from an ordinary JSON/asset request.
    const isPageFetch = request.resourceType() === 'fetch' && /^text\/html|^application\/xhtml\+xml/.test(response.headers()['content-type'] ?? '');
    if ((request.isNavigationRequest() && response.frame() === page.mainFrame()) || isPageFetch) {
      b.lastStatus = response.status();
      if (response.status() === 404) notFoundPages.add(response.url());
    }
  });
  page.on('pageerror', (error) => b.consoleErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => b.failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'failed'})`));
  world.b.context = context;
  world.b.page = page;

  if (b.remembered) {
    // localStorage is per origin, so visit the site once, set it, then let the scenario navigate.
    await page.goto(`${site.url}/robots.txt`);
    await page.evaluate((locale) => localStorage.setItem('preferred-locale', locale), b.remembered);
  }
  return page;
}

/** Where failed scenarios leave their evidence; `npm run results:publish` uploads it to R2. */
const artifactsDir = () => join(process.env.TEST_RESULTS_DIR ?? join(process.cwd(), 'test-results'), 'artifacts', 'browser');

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

After({ tags: '@browser' }, async function ({ result, pickle }) {
  const b = this.b;
  if (!b?.context) return;
  const failed = result?.status === Status.FAILED || result?.status === Status.AMBIGUOUS || result?.status === Status.UNDEFINED;
  if (failed) {
    const dir = artifactsDir();
    mkdirSync(dir, { recursive: true });
    const name = `${slug(pickle.name)}-${pickle.id.slice(-6)}`;
    await b.page?.screenshot({ path: join(dir, `${name}.png`), fullPage: true }).catch(() => {});
    await b.context.tracing.stop({ path: join(dir, `${name}.zip`) }).catch(() => {});
    writeFileSync(
      join(dir, `${name}.txt`),
      [
        `Scenario: ${pickle.name}`,
        `Feature file: ${pickle.uri}`,
        `Status: ${result.status}`,
        `Page: ${b.page?.url?.() ?? 'n/a'}`,
        `Failure: ${String(result.message ?? '').split('\n').slice(0, 6).join('\n')}`,
        `Console errors: ${JSON.stringify(b.consoleErrors)}`,
        `CSP violations: ${JSON.stringify(b.csp)}`,
        `Unexpected external requests: ${JSON.stringify(b.blocked)}`,
        `Web3Forms requests: ${b.apiRequests.length}`,
        `Photo requests: ${b.photoRequests.length}`,
        `Open the trace with: npx playwright show-trace ${name}.zip`,
        '',
      ].join('\n')
    );
  } else {
    await b.context.tracing.stop().catch(() => {});
  }
  await b.context.close();
});
