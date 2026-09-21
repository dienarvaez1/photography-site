import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { After, AfterAll, Before, Status, setDefaultTimeout } from '@cucumber/cucumber';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.js';
import { ROOT } from './lib.js';
import { asR2Binding } from './r2-binding.js';
import { publishRuns } from './results-fixtures.js';
import { fakeOriginals } from './originals-fixtures.js';

// The results API is the real Worker code answering from a fake bucket of really-published runs, so the
// browser tests cover the actual contract between the publisher, the API and the Admin page.
const { handle: handleResultsRequest } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));
const { RESULTS_API_URL } = await import(join(ROOT, 'src/config/results.ts'));
const RESULTS_ORIGIN = new URL(RESULTS_API_URL).origin;

// Real-browser scenarios are slower than the rest: page loads, axe scans, animations.
setDefaultTimeout(60_000);

let browser;
let server;
let imageBytes;

/** One Chromium and one local copy of the built site, shared by every @browser scenario. */
async function shared() {
  if (!browser) browser = await chromium.launch();
  if (!server) server = await startStaticServer();
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
    remembered: null, // localStorage 'preferred-locale' to set before the first visit
    initScripts: [], // extra scripts to run in every page before its own (e.g. block localStorage)
    csp: [], // Content-Security-Policy violations, accumulated across navigations
    lastStatus: null, // status of the most recent page navigation
    viewportOverride: null,
    apiRequests: [],
    // What the results API is doing: 'ok' (answers), 'unreachable', or 'slow'; `env` is its Worker environment (no
    // admin token until a scenario sets one up), `requests` is everything the page asked it.
    results: { mode: 'ok', env: {}, delayMs: 0, requests: [] },
    traceRequests: 0,
    photoRequests: [],
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

/** Puts these original photos ([{ id, body }]) behind the API's ORIGINALS binding; `originals.calls` records every read. */
export function setUpOriginals(world, files) {
  const originals = fakeOriginals(files);
  Object.assign(world.b.results, { originals });
  world.b.results.env.ORIGINALS = originals.binding;
}

async function serveResults(b, siteOrigin, request, route) {
  const results = b.results;
  const url = new URL(request.url());
  results.requests.push({ method: request.method(), path: url.pathname, url: request.url(), authorization: request.headers()['authorization'] ?? '' });
  if (results.mode === 'unreachable') return route.abort('connectionrefused');
  if (results.delayMs) await new Promise((resolve) => setTimeout(resolve, results.delayMs));
  // Only the site's own origin may read the answers, exactly as in production.
  const env = { ...results.env, ALLOWED_ORIGINS: siteOrigin };
  const answer = await handleResultsRequest(new Request(request.url(), { method: request.method(), headers: request.headers() }), env);
  let body = Buffer.from(await answer.arrayBuffer());
  if (results.foreignLink && url.pathname.startsWith('/runs/') && answer.status === 200) {
    // A misbehaving API: one of the run's file links points at another site.
    const run = JSON.parse(body.toString('utf-8'));
    run.links[results.foreignLink] = `https://evil.example/files/x/${results.foreignLink}?exp=1&sig=1`;
    body = Buffer.from(JSON.stringify(run));
  }
  return route.fulfill({ status: answer.status, headers: Object.fromEntries(answer.headers), body });
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

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === site.url) {
      if (url.pathname === '/cdn-cgi/trace') {
        b.traceRequests += 1;
        if (b.trace === 'unreachable') return route.abort('connectionrefused');
        if (b.trace === 'timeout') return; // never answers: the page's own timeout must handle it
        if (b.trace === 'not-found') return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: 'text/plain', body: `fl=1\n${b.trace}\ntls=TLSv1.3\n` });
      }
      if (b.imageDelayMs && /\.(png|webp|jpg)$/.test(url.pathname)) await new Promise((r) => setTimeout(r, b.imageDelayMs));
      return route.continue();
    }
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
    if (message.type() === 'error' && !url.endsWith('/cdn-cgi/trace') && !notFoundPages.has(url)) b.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      b.lastStatus = response.status();
      if (response.status() === 404) notFoundPages.add(response.url());
    }
  });
  page.on('pageerror', (error) => b.consoleErrors.push(`pageerror: ${error.message}`));
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
