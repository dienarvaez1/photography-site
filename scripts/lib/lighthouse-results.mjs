// Lighthouse results in R2 — the same private `photography-site-test` bucket as the test results (results.mjs), under
// its own folder, read by the Admin page's Lighthouse Test Results tab through the results API:
//
//   lighthouse-results/index.json                     newest-first list of runs (capped), the source of truth
//   lighthouse-results/latest.json                    the newest run's summary
//   lighthouse-results/runs/<run id>/summary.json     every page and device measured, with its scores and budget
//   lighthouse-results/runs/<run id>/index.html       the run's index page
//   lighthouse-results/runs/<run id>/<device>-<page>.html   each page's full Lighthouse report
//
// A run is the folder `npm run test:lighthouse` leaves in test-results/lighthouse/ (its summary.json is written by
// features/support/lighthouse-index.js). Same order as the test results, for the same reason: every file first, then
// summary.json, then latest.json, and the index last, so the index never names something that isn't there.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_RETENTION, NO_CACHE, RESULTS_BUCKET, contentType, filesUnder, getJson, gitInfo, makeRunId, putJson } from './results.mjs';

export { RESULTS_BUCKET, DEFAULT_RETENTION };
export const LIGHTHOUSE_PREFIX = 'lighthouse-results/';

const indexKey = `${LIGHTHOUSE_PREFIX}index.json`;
const latestKey = `${LIGHTHOUSE_PREFIX}latest.json`;
const runKey = (runId, file) => `${LIGHTHOUSE_PREFIX}runs/${runId}/${file}`;

/** The index of Lighthouse runs, newest first. A missing index is an empty history. */
export async function readLighthouseIndex(storage) {
  return (await getJson(storage, indexKey)) ?? { updatedAt: null, runs: [] };
}

/** The median performance score per device, for the list of runs: { mobile: 91, desktop: 98 }. */
function performanceByDevice(results) {
  const byDevice = {};
  for (const r of results) (byDevice[r.device] ??= []).push(r.scores.performance);
  return Object.fromEntries(Object.entries(byDevice).map(([device, scores]) => {
    const sorted = [...scores].sort((a, b) => a - b);
    return [device, sorted[Math.floor((sorted.length - 1) / 2)]];
  }));
}

/**
 * Uploads a Lighthouse results folder as one run. Returns { runId, summary, pruned: [runId] }. Runs beyond `retain` are
 * dropped from the index and their files deleted.
 */
export async function publishLighthouse({ dir, storage, source = 'local', meta = gitInfo(), now = new Date(), retain = DEFAULT_RETENTION, log = () => {} }) {
  let names;
  try {
    names = await filesUnder(dir);
  } catch {
    names = [];
  }
  if (!names.includes('summary.json')) {
    throw new Error(`No Lighthouse results in ${dir} (expected summary.json). Run \`npm run test:lighthouse\` first.`);
  }
  let measured;
  try {
    measured = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf-8'));
  } catch (error) {
    throw new Error(`summary.json is not valid JSON (${error.message}) — was the Lighthouse run interrupted?`, { cause: error });
  }
  if (!Array.isArray(measured?.results) || !measured.results.length) throw new Error('summary.json lists no measurements.');

  const index = await readLighthouseIndex(storage);
  const base = makeRunId({ now, commit: meta.commit, dirty: meta.dirty, source });
  let runId = base;
  for (let n = 2; index.runs.some((r) => r.runId === runId); n++) runId = `${base}-${n}`;

  // Every file but the folder's own summary.json, which is rewritten below with the run's details.
  const uploads = names.filter((name) => name !== 'summary.json');
  for (const name of uploads) {
    await storage.put(runKey(runId, name), join(dir, name), contentType(name), NO_CACHE);
    log(`  uploaded ${runKey(runId, name)}`);
  }

  const summary = {
    runId,
    startedAt: measured.measuredAt ?? now.toISOString(),
    source,
    commit: meta.commit,
    branch: meta.branch,
    dirty: meta.dirty,
    baseUrl: measured.baseUrl,
    runsPerPage: measured.runsPerPage,
    ok: measured.totals.overBudget === 0,
    totals: measured.totals,
    results: measured.results,
    files: [...uploads.map((name) => runKey(runId, name)), runKey(runId, 'summary.json')],
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
    baseUrl: summary.baseUrl,
    ok: summary.ok,
    totals: summary.totals,
    performance: performanceByDevice(summary.results),
    overBudget: summary.results.filter((r) => !r.ok).map((r) => ({ path: r.path, device: r.device })).slice(0, 25),
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

export async function listLighthouseRuns({ storage, limit = 20 }) {
  return (await readLighthouseIndex(storage)).runs.slice(0, limit);
}

/** One run's summary: by run id, or "latest". Null when there is no such run. */
export async function showLighthouseRun({ storage, runId = 'latest' }) {
  return getJson(storage, runId === 'latest' ? latestKey : runKey(runId, 'summary.json'));
}

/** Keeps the newest `keep` runs; deletes the rest from the index and the bucket. */
export async function pruneLighthouse({ storage, keep = DEFAULT_RETENTION, log = () => {} }) {
  const index = await readLighthouseIndex(storage);
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
