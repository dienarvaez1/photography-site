// Command line for the test-results store, as a function so tests can drive it with a fake bucket.
import { parseArgs } from 'node:util';
import { DEFAULT_RETENTION, RESULTS_BUCKET, RESULTS_PREFIX, directoryExists, listRuns, pruneResults, publishResults, showRun, trend } from './results.mjs';

export const HELP = `Test results in R2 — bucket ${RESULTS_BUCKET}, under ${RESULTS_PREFIX}

  npm run test:record [-- --suite offline|browser|all] [--no-publish]
      Runs the test suites with reporters, then publishes the results.

  npm run results:publish [-- --source local|ci]
      Uploads test-results/ (Cucumber JSON + HTML, smoke.json, failure screenshots and traces)
      as one run, with a summary, and adds it to the index.

  npm run results:list [-- --limit 20]     recent runs, newest first
  npm run results:show [-- <run id|latest>] one run's summary and failures
  npm run results:trend [-- --window 20]   scenarios that failed recently, and which look flaky
  npm run results:prune [-- --keep 100]    delete the oldest runs from the index and the bucket

  The bucket is private. Runs are kept until they fall out of the newest ${DEFAULT_RETENTION}.`;

const mark = (ok) => (ok ? '✓' : '✗');
const when = (iso) => iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, 'Z'); // 2026-09-21 04:54Z

/** Runs one command; returns the exit code (0 ok, 1 failure). Never throws. */
export async function run(args, { dir, storage, log = console.log, error = console.error, meta, now }) {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'publish': {
        const { values } = parseArgs({ args: rest, options: { source: { type: 'string' }, retain: { type: 'string' } } });
        if (!(await directoryExists(dir))) throw new Error(`No test results folder at ${dir}. Run \`npm run test:record\` first.`);
        const { runId, summary, pruned } = await publishResults({
          dir, storage, meta, now, source: values.source ?? (process.env.CI ? 'ci' : 'local'),
          retain: values.retain ? Number(values.retain) : DEFAULT_RETENTION, log,
        });
        log(`${mark(summary.ok)} published ${runId}: ${summary.totals.passed}/${summary.totals.scenarios} passed${summary.totals.failed ? `, ${summary.totals.failed} failed` : ''} → ${RESULTS_BUCKET}/${RESULTS_PREFIX}runs/${runId}/`);
        if (pruned.length) log(`  pruned ${pruned.length} old run(s)`);
        break;
      }
      case 'list': {
        const { values } = parseArgs({ args: rest, options: { limit: { type: 'string' } } });
        const runs = await listRuns({ storage, limit: values.limit ? Number(values.limit) : 20 });
        if (!runs.length) return log('No runs yet. Publish one with `npm run test:record`.'), 0;
        for (const r of runs) {
          log(`${mark(r.ok)} ${r.runId.padEnd(40)} ${String(r.totals.passed).padStart(4)}/${String(r.totals.scenarios).padEnd(4)} ${r.source.padEnd(5)} ${when(r.startedAt)}${r.failures.length ? `  failing: ${r.failures.length}` : ''}`);
        }
        break;
      }
      case 'show': {
        const summary = await showRun({ storage, runId: rest[0] ?? 'latest' });
        if (!summary) throw new Error(`No run "${rest[0] ?? 'latest'}" in ${RESULTS_BUCKET}. See \`npm run results:list\`.`);
        log(`${mark(summary.ok)} ${summary.runId}`);
        log(`  commit ${summary.commit}${summary.dirty ? ' (with uncommitted changes)' : ''} on ${summary.branch}, ${summary.source}, ${summary.startedAt}`);
        for (const [name, s] of Object.entries(summary.suites)) {
          log(name === 'smoke' ? `  smoke:   ${s.passed}/${s.checks} checks passed (${s.baseUrl})` : `  ${(`${name}:`).padEnd(8)} ${s.passed}/${s.scenarios} scenarios passed, ${s.failed} failed, ${s.skipped} skipped (${(s.durationMs / 1000).toFixed(1)}s)`);
          for (const f of s.failures) log(`    ✗ ${f.feature ? `${f.feature}: ` : ''}${f.scenario ?? f.name} — ${f.message ?? f.detail}`);
        }
        log(`  ${summary.files.length} files under ${RESULTS_PREFIX}runs/${summary.runId}/`);
        break;
      }
      case 'trend': {
        const { values } = parseArgs({ args: rest, options: { window: { type: 'string' } } });
        const result = await trend({ storage, window: values.window ? Number(values.window) : 20 });
        if (!result.runs) return log('No runs yet.'), 0;
        if (!result.scenarios.length) return log(`✓ nothing failed in the last ${result.runs} run(s)`), 0;
        log(`Failures in the last ${result.runs} run(s):`);
        for (const s of result.scenarios) log(`  ${s.failingNow ? '✗ failing now ' : '  passing now'}  ${String(s.failedRuns).padStart(3)}/${result.runs}  ${s.flaky ? 'flaky ' : 'always '} ${s.name}`);
        break;
      }
      case 'prune': {
        const { values } = parseArgs({ args: rest, options: { keep: { type: 'string' } } });
        const { pruned } = await pruneResults({ storage, keep: values.keep ? Number(values.keep) : DEFAULT_RETENTION, log });
        log(`✓ pruned ${pruned.length} run(s)`);
        break;
      }
      default:
        log(HELP);
        return command && command !== 'help' ? 1 : 0;
    }
    return 0;
  } catch (err) {
    error(`✗ ${err.message}`);
    return 1;
  }
}
