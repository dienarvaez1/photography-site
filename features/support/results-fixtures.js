import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib.js';
import { createMemoryBucket } from './memory-storage.js';

const lib = await import(join(ROOT, 'scripts/lib/results.mjs'));

/** A Cucumber JSON report with the given scenarios: [{ feature, name, status: 'passed'|'failed'|'skipped', message?, ms? }]. */
export function cucumberReport(scenarios) {
  const byFeature = new Map();
  for (const s of scenarios) byFeature.set(s.feature, [...(byFeature.get(s.feature) ?? []), s]);
  return [...byFeature].map(([feature, list]) => ({
    uri: `features/${feature}`,
    name: feature,
    elements: list.map((s) => ({
      type: 'scenario',
      name: s.name,
      steps: [
        {
          keyword: 'Then ',
          name: s.step ?? 'something happens',
          result: { status: s.status, duration: (s.ms ?? 5) * 1e6, ...(s.status === 'failed' ? { error_message: s.message ?? 'AssertionError: expected true to be false' } : {}) },
        },
      ],
    })),
  }));
}

// A real (1x1) PNG, so a browser can draw it, and just enough of a zip for the tests to tell them apart.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x66, 0x61, 0x6b, 0x65]);

/**
 * Publishes runs with the REAL publisher into a fake bucket, oldest first:
 * runs = [{ time, commit, source?, offline: [scenarios], browser?: [scenarios], smoke?: [checks], artifacts?: [names] }].
 * Returns { bucket, runIds } (newest first, like the index).
 */
export async function publishRuns(runs) {
  const bucket = createMemoryBucket();
  const runIds = [];
  for (const run of runs) {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-run-'));
    try {
      const put = (name, body) => {
        mkdirSync(join(dir, name, '..'), { recursive: true });
        writeFileSync(join(dir, name), body);
      };
      put('offline.json', JSON.stringify(cucumberReport(run.offline)));
      put('offline.html', `<!doctype html><title>report</title><h1>Offline report ${run.commit}</h1>`);
      if (run.browser) {
        put('browser.json', JSON.stringify(cucumberReport(run.browser)));
        put('browser.html', '<!doctype html><h1>Browser report</h1>');
      }
      if (run.smoke) put('smoke.json', JSON.stringify({ baseUrl: 'https://example.test', checks: run.smoke }));
      for (const name of run.artifacts ?? []) {
        put(`artifacts/browser/${name}.png`, PNG);
        put(`artifacts/browser/${name}.zip`, ZIP);
        put(`artifacts/browser/${name}.txt`, `Scenario: ${name}\nStatus: FAILED\n`);
      }
      const { runId } = await lib.publishResults({ dir, storage: bucket, source: run.source ?? 'local', meta: { commit: run.commit, branch: 'main', dirty: false }, now: new Date(run.time) });
      runIds.unshift(runId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { bucket, runIds };
}

/** "2 passed, 1 failed" -> the scenarios of a fixture report. */
function scenariosFrom(text, feature) {
  const list = [];
  for (const [, count, status] of text.matchAll(/(\d+) (passed|failed|skipped)/g)) {
    for (let i = 1; i <= Number(count); i++) list.push({ feature, name: `${status} scenario ${i}`, status });
  }
  return list;
}

/**
 * Rows of a Gherkin table (time, commit, "offline results", "browser results", smoke, artifacts) -> runs for
 * publishRuns. A failed scenario named in `failure` (optional column) carries that message.
 */
export function runsFromRows(rows) {
  return rows.map((row) => {
    const offline = scenariosFrom(row['offline results'], 'site.feature');
    if (row.failure) for (const s of offline.filter((x) => x.status === 'failed')) s.message = row.failure;
    return {
      time: row.time,
      commit: row.commit,
      offline,
      browser: row['browser results'] ? scenariosFrom(row['browser results'], 'browser.feature') : undefined,
      smoke: row.smoke === 'yes' ? [{ name: 'home page loads', ok: true, detail: '' }, { name: 'contact form is present', ok: true, detail: '' }] : undefined,
      artifacts: row.artifacts ? [row.artifacts] : [],
    };
  });
}
