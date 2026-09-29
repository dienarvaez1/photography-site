// Runs Google Lighthouse for the @lighthouse scenarios (`npm run test:lighthouse`), against the live site by default.
//
// The live site, not the tests' snapshot build: the snapshot's sample photos point at the real R2 bucket (where not all
// of them exist), and Lighthouse drives Chrome directly, so the browser suite's stand-in images can't apply. What is
// worth measuring is what visitors get — real photos, Cloudflare's CDN and headers. Point it elsewhere with
// LIGHTHOUSE_URL (a preview deploy, `npm run preview`'s http://localhost:8787, …).
//
// Lab measurements vary from run to run (the network, the CDN, this machine), so each page is measured
// LIGHTHOUSE_RUNS times (3 by default) and judged on the median run, the way Lighthouse itself recommends. A page is
// measured once per device however many scenarios ask about it. The median run's HTML report is saved under
// test-results/lighthouse/ (git-ignored), and at the end of the run an index of every page measured
// (test-results/lighthouse/index.html) and the same results as data (summary.json) — see lighthouse-index.js.
// `npm run test:lighthouse:record` runs the suite and publishes that folder to R2 (scripts/lib/lighthouse-results.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AfterAll } from '@cucumber/cucumber';
import { ROOT } from './lib.js';
import { renderIndex, summarizeRun } from './lighthouse-index.js';

const { SITE } = await import(join(ROOT, 'src/config/site.ts'));

export const BASE_URL = (process.env.LIGHTHOUSE_URL || SITE.url).replace(/\/$/, '');
export const RUNS = Math.max(1, Number(process.env.LIGHTHOUSE_RUNS) || 3);
const REPORT_DIR = join(process.env.TEST_RESULTS_DIR ?? join(ROOT, 'test-results'), 'lighthouse');

/**
 * What each device must reach. Mobile is Lighthouse's default: a mid-range phone on a slow 4G connection with a 4x
 * slower CPU; desktop is its desktop preset. Scores are 0–1 (Lighthouse shows them as 0–100); times are milliseconds.
 *
 * The limits sit at or just past Google's "good" thresholds where the site already meets them, and just past today's
 * measurements where it doesn't yet: on a phone the home page and the Nature gallery paint their largest photo at
 * 4.2–4.6 s, against Google's 2.5 s "good", so the phone LCP limit is 5 s. A regression fails, and the gap stays
 * visible here. A page that can't meet even that has its own entry in PAGE_EXCEPTIONS. Tighten them as the site gets
 * faster.
 */
export const BUDGETS = {
  mobile: {
    scores: { performance: 0.75, accessibility: 0.95, 'best-practices': 0.9, seo: 0.95 },
    metrics: { 'first-contentful-paint': 3000, 'largest-contentful-paint': 5000, 'total-blocking-time': 200, 'cumulative-layout-shift': 0.1 },
    bytes: 1.5 * 1024 * 1024,
  },
  desktop: {
    // 0.85, not 0.9: the laptop scores measured 97–100 on most runs, but the same page has come in at 89 on another,
    // from the network alone; 0.85 still catches a real slowdown.
    scores: { performance: 0.85, accessibility: 0.95, 'best-practices': 0.9, seo: 0.95 },
    metrics: { 'first-contentful-paint': 1500, 'largest-contentful-paint': 2000, 'total-blocking-time': 100, 'cumulative-layout-shift': 0.1 },
    bytes: 1.5 * 1024 * 1024,
  },
};

/**
 * Known gaps: pages that need a looser limit than their device's, and why. Each is a target to bring back under the
 * device budget, not a permanent allowance.
 */
export const PAGE_EXCEPTIONS = {
  '/work/all/': {
    // Every photo of the site on one page. On a phone its largest photo has painted at 4.3–6.0 s (median 5.8 s on
    // 29 Sep 2026); Lighthouse's own advice is to send smaller images (about 300 KB could be saved).
    mobile: { scores: { performance: 0.7 }, metrics: { 'largest-contentful-paint': 6500 } },
  },
};

/** The budget for one page on one device: the device's, with any exception for that page on top. */
export function budgetFor(path, device) {
  const base = BUDGETS[device];
  const exception = PAGE_EXCEPTIONS[path]?.[device] ?? {};
  return {
    scores: { ...base.scores, ...exception.scores },
    metrics: { ...base.metrics, ...exception.metrics },
    bytes: exception.bytes ?? base.bytes,
  };
}

/** `text`, cut at a word to at most `max` characters, with "…" when it was cut. */
function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

/**
 * How a measured page does against its budget, as sentences for people, by kind; every list empty means it passed.
 * The scenarios and the index page both use this, so they can never disagree about what passed.
 */
export function checkBudget(lhr, path, device) {
  const budget = budgetFor(path, device);
  const { categories, audits } = lhr;
  const shown = (id, value) => (id === 'cumulative-layout-shift' ? value.toFixed(3) : `${Math.round(value)} ms`);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const bytes = audits['total-byte-weight'].numericValue;
  return {
    scores: Object.entries(budget.scores)
      .filter(([id, min]) => !(categories[id].score >= min))
      .map(([id, min]) => `${categories[id].title} ${Math.round(categories[id].score * 100)} (needs ${Math.round(min * 100)})`),
    metrics: Object.entries(budget.metrics)
      .filter(([id, max]) => !(audits[id].numericValue <= max))
      .map(([id, max]) => `${METRIC_NAMES[id]} ${shown(id, audits[id].numericValue)} (budget ${shown(id, max)})`),
    bytes: bytes <= budget.bytes ? [] : [`Downloads ${kb(bytes)} (budget ${kb(budget.bytes)})`],
    console: (audits['errors-in-console'].details?.items ?? []).map((item) => `${item.source}: ${shorten(String(item.description ?? '').split('\n')[0], 200)}`),
  };
}

export const METRIC_NAMES = {
  'first-contentful-paint': 'First Contentful Paint',
  'largest-contentful-paint': 'Largest Contentful Paint',
  'total-blocking-time': 'Total Blocking Time',
  'cumulative-layout-shift': 'Cumulative Layout Shift',
};

let chrome = null;
const measured = new Map(); // "<device> <path>" -> Promise<lhr>

async function startChrome() {
  if (!chrome) {
    const [{ launch }, { chromium }] = await Promise.all([import('chrome-launcher'), import('playwright')]);
    // Playwright's own Chrome for Testing: the browser suite already installs it, so nothing else to set up.
    chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
  }
  return chrome;
}

async function runOnce(url, device) {
  const [{ default: lighthouse }, { default: desktopConfig }] = await Promise.all([import('lighthouse'), import('lighthouse/core/config/desktop-config.js')]);
  const { port } = await startChrome();
  const result = await lighthouse(url, { port, output: 'html', logLevel: 'error' }, device === 'desktop' ? desktopConfig : undefined);
  if (!result?.lhr) throw new Error(`Lighthouse returned nothing for ${url}`);
  if (result.lhr.runtimeError) throw new Error(`Lighthouse could not measure ${url}: ${result.lhr.runtimeError.message}`);
  return result;
}

const results = []; // every page measured this run, for the index page

const slug = (path) => path.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';

/** The median of RUNS Lighthouse runs of `path` on `device` ("mobile" or "desktop"), measured at most once. */
export function measure(path, device) {
  const key = `${device} ${path}`;
  if (!measured.has(key)) {
    measured.set(key, (async () => {
      const { computeMedianRun } = await import('lighthouse/core/lib/median-run.js');
      const runs = [];
      for (let i = 0; i < RUNS; i++) runs.push(await runOnce(`${BASE_URL}${path}`, device));
      const median = computeMedianRun(runs.map((r) => r.lhr));
      const chosen = runs.find((r) => r.lhr === median) ?? runs[0];
      const report = `${device}-${slug(path)}.html`;
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(join(REPORT_DIR, report), chosen.report);
      results.push({ path, device, report, lhr: median, misses: checkBudget(median, path, device), budget: budgetFor(path, device) });
      return median;
    })());
  }
  return measured.get(key);
}

AfterAll(async function () {
  await chrome?.kill();
  chrome = null;
  if (results.length) {
    const run = { baseUrl: BASE_URL, runs: RUNS, generatedAt: new Date(), results };
    writeFileSync(join(REPORT_DIR, 'index.html'), renderIndex(run));
    // The same results as data, for publishing (npm run lighthouse-results:publish) and the Admin page's Lighthouse tab.
    writeFileSync(join(REPORT_DIR, 'summary.json'), `${JSON.stringify(summarizeRun(run), null, 2)}\n`);
  }
});
