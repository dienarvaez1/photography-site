// Test results in R2.
//
// After a test run, the reports (Cucumber JSON + HTML for the offline and browser suites, the smoke
// check's JSON, and screenshots/traces of failed browser scenarios) are uploaded to the private
// `photography-site-test` bucket under `results/`, with a summary per run and an index of runs:
//
//   results/index.json                     newest-first list of runs (capped), the source of truth
//   results/latest.json                    the newest run's summary
//   results/runs/<run id>/summary.json     what happened in that run
//   results/runs/<run id>/offline.json|html, browser.json|html, smoke.json
//   results/runs/<run id>/artifacts/...    screenshots, traces and notes of failed browser scenarios
//
// Storage-agnostic like the photo workflow: every function takes a `storage` with
// put(key, file, contentType, cacheControl) / get(key) -> Buffer|null / delete(key), so tests use a
// fake. R2 can't be listed with wrangler, so index.json (written last, after everything it names is
// uploaded) is how runs are found.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';

export const RESULTS_BUCKET = 'photography-site-test';
export const RESULTS_PREFIX = 'results/';
export const DEFAULT_RETENTION = 100;

const NO_CACHE = 'no-store';
const CONTENT_TYPES = { '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const SUITES = { offline: 'offline.json', browser: 'browser.json', smoke: 'smoke.json' };

// --- Summarising -----------------------------------------------------------------------------

const NS_PER_MS = 1e6;
const firstLine = (text = '') => String(text).split('\n').find((l) => l.trim())?.trim().slice(0, 300) ?? '';

/** How a scenario ended: failed (any failed/undefined/ambiguous step), skipped/pending, or passed. */
function scenarioStatus(steps) {
  const statuses = steps.map((s) => s.result.status);
  if (statuses.some((s) => ['failed', 'undefined', 'ambiguous'].includes(s))) return 'failed';
  if (statuses.some((s) => ['skipped', 'pending'].includes(s))) return 'skipped';
  return 'passed';
}

/** Digest of a Cucumber JSON report: counts, per-feature results, failures with their step, slowest scenarios. */
export function summarizeCucumber(report) {
  const summary = { scenarios: 0, passed: 0, failed: 0, skipped: 0, steps: { total: 0, passed: 0, failed: 0, skipped: 0 }, durationMs: 0, features: [], failures: [], slowest: [] };
  const scenarios = [];
  for (const feature of report) {
    const name = basename(feature.uri ?? feature.name ?? 'feature');
    const entry = { name, scenarios: 0, passed: 0, failed: 0 };
    for (const element of feature.elements ?? []) {
      if (element.type !== 'scenario') continue;
      const steps = element.steps ?? [];
      const status = scenarioStatus(steps);
      const hooks = [...(element.before ?? []), ...(element.after ?? [])];
      const ms = [...steps, ...hooks].reduce((n, s) => n + (s.result?.duration ?? 0), 0) / NS_PER_MS;
      summary.scenarios += 1;
      summary[status] += 1;
      entry.scenarios += 1;
      if (status === 'passed') entry.passed += 1;
      if (status === 'failed') entry.failed += 1;
      for (const step of steps) {
        summary.steps.total += 1;
        const key = step.result.status === 'passed' ? 'passed' : ['failed', 'undefined', 'ambiguous'].includes(step.result.status) ? 'failed' : 'skipped';
        summary.steps[key] += 1;
      }
      summary.durationMs += ms;
      scenarios.push({ feature: name, scenario: element.name, ms });
      if (status === 'failed') {
        const step = steps.find((s) => ['failed', 'undefined', 'ambiguous'].includes(s.result.status));
        summary.failures.push({
          feature: name,
          scenario: element.name,
          step: `${step.keyword ?? ''}${step.name ?? ''}`.trim(),
          message: firstLine(step.result.error_message) || step.result.status,
        });
      }
    }
    summary.features.push(entry);
  }
  summary.durationMs = Math.round(summary.durationMs);
  summary.slowest = scenarios.sort((a, b) => b.ms - a.ms).slice(0, 5).map((s) => ({ ...s, ms: Math.round(s.ms) }));
  return summary;
}

/** Digest of the smoke check's JSON ({ baseUrl, checkedAt, checks: [{ name, ok, detail }] }). */
export function summarizeSmoke(report) {
  const failures = report.checks.filter((c) => !c.ok);
  return { baseUrl: report.baseUrl, checks: report.checks.length, passed: report.checks.length - failures.length, failed: failures.length, failures: failures.map((c) => ({ name: c.name, detail: c.detail })) };
}

// --- Identifying a run ----------------------------------------------------------------------------

/** Sortable, unique-per-second id like 2026-09-21T04-30-12Z-e786ff8-local. */
export function makeRunId({ now = new Date(), commit = 'unknown', dirty = false, source = 'local' } = {}) {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replaceAll(':', '-');
  return `${stamp}-${commit}${dirty ? '-dirty' : ''}-${source}`;
}

/** Commit, branch and whether the working tree has uncommitted changes (from GitHub's env in CI). */
export function gitInfo(cwd = process.cwd(), env = process.env) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  return {
    commit: env.GITHUB_SHA?.slice(0, 7) || git('rev-parse', '--short', 'HEAD') || 'unknown',
    branch: env.GITHUB_REF_NAME || git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown',
    dirty: env.GITHUB_SHA ? false : git('status', '--porcelain') !== '',
  };
}

// --- Files ---------------------------------------------------------------------------------------------

async function filesUnder(dir) {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(relative(dir, full).split('\\').join('/'));
    }
  };
  await walk(dir);
  return found.sort();
}

const contentType = (file) => CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

async function putJson(storage, key, value) {
  const dir = await mkdtemp(join(tmpdir(), 'results-'));
  try {
    const file = join(dir, 'object.json');
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
    await storage.put(key, file, 'application/json', NO_CACHE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function getJson(storage, key) {
  const body = await storage.get(key);
  return body ? JSON.parse(body.toString('utf-8')) : null;
}

const indexKey = `${RESULTS_PREFIX}index.json`;
const latestKey = `${RESULTS_PREFIX}latest.json`;
const runKey = (runId, file) => `${RESULTS_PREFIX}runs/${runId}/${file}`;

/** The index of runs, newest first. A missing index is an empty history. */
export async function readIndex(storage) {
  return (await getJson(storage, indexKey)) ?? { updatedAt: null, runs: [] };
}

// --- Publishing ------------------------------------------------------------------------------------------

/**
 * Uploads a results folder as one run. Order matters: every file first, then summary.json, then
 * latest.json, and the index last, so the index never names something that isn't there. Runs beyond
 * `retain` are then dropped from the index and their objects deleted.
 * Returns { runId, summary, pruned: [runId] }.
 */
export async function publishResults({ dir, storage, source = 'local', meta = gitInfo(), now = new Date(), retain = DEFAULT_RETENTION, log = () => {} }) {
  let names;
  try {
    names = await filesUnder(dir);
  } catch {
    names = [];
  }
  const suites = {};
  for (const [suite, file] of Object.entries(SUITES)) {
    if (!names.includes(file)) continue;
    let report;
    try {
      report = JSON.parse(await readFile(join(dir, file), 'utf-8'));
    } catch (error) {
      throw new Error(`${file} is not valid JSON (${error.message}) — was the test run interrupted?`);
    }
    suites[suite] = suite === 'smoke' ? summarizeSmoke(report) : summarizeCucumber(report);
  }
  if (!Object.keys(suites).length) {
    throw new Error(`No test results found in ${dir} (expected ${Object.values(SUITES).join(', ')}). Run \`npm run test:record\` first.`);
  }

  const index = await readIndex(storage);
  const base = makeRunId({ now, commit: meta.commit, dirty: meta.dirty, source });
  let runId = base;
  for (let n = 2; index.runs.some((r) => r.runId === runId); n++) runId = `${base}-${n}`;

  const keys = names.map((name) => runKey(runId, name));
  for (const name of names) {
    await storage.put(runKey(runId, name), join(dir, name), contentType(name), NO_CACHE);
    log(`  uploaded ${runKey(runId, name)}`);
  }

  const totals = Object.entries(suites).reduce(
    (t, [suite, s]) => (suite === 'smoke' ? { ...t, scenarios: t.scenarios + s.checks, passed: t.passed + s.passed, failed: t.failed + s.failed } : { ...t, scenarios: t.scenarios + s.scenarios, passed: t.passed + s.passed, failed: t.failed + s.failed, skipped: t.skipped + s.skipped }),
    { scenarios: 0, passed: 0, failed: 0, skipped: 0 }
  );
  const summary = {
    runId,
    startedAt: now.toISOString(),
    source,
    commit: meta.commit,
    branch: meta.branch,
    dirty: meta.dirty,
    node: process.version,
    ok: totals.failed === 0 && totals.skipped === 0,
    totals,
    suites,
    files: [...keys, runKey(runId, 'summary.json')],
  };
  await putJson(storage, runKey(runId, 'summary.json'), summary);
  await putJson(storage, latestKey, summary);

  const entry = {
    runId,
    startedAt: summary.startedAt,
    source,
    commit: meta.commit,
    branch: meta.branch,
    dirty: meta.dirty,
    ok: summary.ok,
    totals,
    suites: Object.fromEntries(Object.entries(suites).map(([suite, s]) => [suite, suite === 'smoke' ? { scenarios: s.checks, passed: s.passed, failed: s.failed } : { scenarios: s.scenarios, passed: s.passed, failed: s.failed }])),
    failures: Object.entries(suites).flatMap(([suite, s]) => s.failures.map((f) => ({ suite, name: f.scenario ?? f.name, feature: f.feature }))).slice(0, 25),
    files: summary.files,
  };
  const kept = [entry, ...index.runs].slice(0, retain);
  const dropped = [entry, ...index.runs].slice(retain);
  await putJson(storage, indexKey, { updatedAt: summary.startedAt, runs: kept });
  log(`  updated ${indexKey} (${kept.length} runs)`);

  for (const old of dropped) {
    for (const key of old.files ?? []) await storage.delete(key);
    log(`  pruned ${old.runId}`);
  }
  return { runId, summary, pruned: dropped.map((r) => r.runId) };
}

// --- Reading and maintaining -------------------------------------------------------------------------------

export async function listRuns({ storage, limit = 20 }) {
  return (await readIndex(storage)).runs.slice(0, limit);
}

/** One run's summary: by run id, or "latest". Null when there is no such run. */
export async function showRun({ storage, runId = 'latest' }) {
  return getJson(storage, runId === 'latest' ? latestKey : runKey(runId, 'summary.json'));
}

/**
 * Scenarios that failed within the last `window` runs, with how often. `flaky` means it failed in
 * some runs but not all of them (it has passed too); `failingNow` means the newest run failed it.
 */
export async function trend({ storage, window = 20 }) {
  const runs = (await readIndex(storage)).runs.slice(0, window);
  const seen = new Map();
  runs.forEach((run, position) => {
    for (const failure of new Set(run.failures.map((f) => `${f.suite}: ${f.name}`))) {
      const entry = seen.get(failure) ?? { name: failure, failedRuns: 0, newest: null };
      entry.failedRuns += 1;
      if (position === 0) entry.newest = true;
      seen.set(failure, entry);
    }
  });
  return {
    runs: runs.length,
    scenarios: [...seen.values()]
      .map((e) => ({ name: e.name, failedRuns: e.failedRuns, failingNow: Boolean(e.newest), flaky: e.failedRuns < runs.length }))
      .sort((a, b) => b.failedRuns - a.failedRuns || a.name.localeCompare(b.name)),
  };
}

/** Keeps the newest `keep` runs; deletes the rest from the index and the bucket. */
export async function pruneResults({ storage, keep = DEFAULT_RETENTION, log = () => {} }) {
  const index = await readIndex(storage);
  const kept = index.runs.slice(0, keep);
  const dropped = index.runs.slice(keep);
  if (!dropped.length) return { pruned: [] };
  await putJson(storage, indexKey, { updatedAt: index.updatedAt, runs: kept });
  for (const old of dropped) {
    for (const key of old.files ?? []) await storage.delete(key);
    log(`pruned ${old.runId}`);
  }
  return { pruned: dropped.map((r) => r.runId) };
}

export async function directoryExists(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
