// Command line for the Lighthouse results store, as a function so tests can drive it with a fake bucket.
import { parseArgs } from 'node:util';
import { directoryExists, startedFrom, targetFromEnv } from './results.mjs';
import { DEFAULT_RETENTION, LIGHTHOUSE_PREFIX, RESULTS_BUCKET, listLighthouseRuns, publishLighthouse, pruneLighthouse, showLighthouseRun } from './lighthouse-results.mjs';

export const HELP = `Lighthouse results in R2 — bucket ${RESULTS_BUCKET}, under ${LIGHTHOUSE_PREFIX}

  npm run test:lighthouse:record [-- --no-publish]
      Measures the live site (npm run test:lighthouse), then publishes the run.

  npm run lighthouse-results:publish [-- --source local|ci] [--from <where started>] [--target <host measured>]
      Uploads test-results/lighthouse/ (the index page, every page's report and summary.json) as one run,
      and adds it to the index the Admin page's Lighthouse Test Results tab reads.

  npm run lighthouse-results:list [-- --limit 20]      recent runs, newest first
  npm run lighthouse-results:show [-- <run id|latest>] one run: every page and device, and what was over budget
  npm run lighthouse-results:prune [-- --keep 100]     delete the oldest runs from the index and the bucket

  The bucket is private. Runs are kept until they fall out of the newest ${DEFAULT_RETENTION}.`;

const mark = (ok) => (ok ? '✓' : '✗');
const when = (iso) => iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, 'Z');
const DEVICE = { mobile: 'phone', desktop: 'laptop' };

/** Runs one command; returns the exit code (0 ok, 1 failure). Never throws. */
export async function run(args, { dir, storage, log = console.log, error = console.error, meta, now }) {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'publish': {
        const { values } = parseArgs({ args: rest, options: { source: { type: 'string' }, from: { type: 'string' }, target: { type: 'string' }, retain: { type: 'string' } } });
        if (!(await directoryExists(dir))) throw new Error(`No Lighthouse results folder at ${dir}. Run \`npm run test:lighthouse\` first.`);
        const { runId, summary, pruned } = await publishLighthouse({
          dir, storage, meta, now, source: values.source ?? (process.env.CI ? 'ci' : 'local'),
          // Where it was started from (as for test runs: RESULTS_FROM, the GitHub event, or this computer) and what it
          // measured (--target / RESULTS_TARGET, else the measured site's host).
          from: values.from ?? startedFrom(), target: values.target ?? targetFromEnv(),
          retain: values.retain ? Number(values.retain) : DEFAULT_RETENTION, log,
        });
        log(`${mark(summary.ok)} published ${runId}: ${summary.totals.withinBudget}/${summary.totals.measurements} within budget → ${RESULTS_BUCKET}/${LIGHTHOUSE_PREFIX}runs/${runId}/`);
        if (pruned.length) log(`  pruned ${pruned.length} old run(s)`);
        break;
      }
      case 'list': {
        const { values } = parseArgs({ args: rest, options: { limit: { type: 'string' } } });
        const runs = await listLighthouseRuns({ storage, limit: values.limit ? Number(values.limit) : 20 });
        if (!runs.length) return log('No Lighthouse runs yet. Publish one with `npm run test:lighthouse:record`.'), 0;
        for (const r of runs) {
          const perf = Object.entries(r.performance ?? {}).map(([device, score]) => `${DEVICE[device] ?? device} ${score}`).join(', ');
          log(`${mark(r.ok)} ${r.runId.padEnd(40)} ${String(r.totals.withinBudget).padStart(3)}/${String(r.totals.measurements).padEnd(3)} ${r.source.padEnd(5)} ${when(r.startedAt)}  performance: ${perf}`);
        }
        break;
      }
      case 'show': {
        const summary = await showLighthouseRun({ storage, runId: rest[0] ?? 'latest' });
        if (!summary) throw new Error(`No Lighthouse run "${rest[0] ?? 'latest'}" in ${RESULTS_BUCKET}. See \`npm run lighthouse-results:list\`.`);
        log(`${mark(summary.ok)} ${summary.runId}: ${summary.totals.withinBudget}/${summary.totals.measurements} within budget`);
        log(`  ${summary.baseUrl}, ${summary.runsPerPage} run(s) per page; commit ${summary.commit}${summary.dirty ? ' (with uncommitted changes)' : ''} on ${summary.branch}, ${summary.source}, ${summary.startedAt}`);
        for (const r of summary.results) {
          log(`  ${mark(r.ok)} ${r.path.padEnd(14)} ${(DEVICE[r.device] ?? r.device).padEnd(6)} perf ${r.scores.performance}  LCP ${(r.metrics['largest-contentful-paint'] / 1000).toFixed(1)} s  ${Math.round(r.bytes / 1024)} KB${r.errors ? `  ${r.errors} error(s)` : ''}`);
          for (const miss of r.misses) log(`      ✗ ${miss}`);
        }
        break;
      }
      case 'prune': {
        const { values } = parseArgs({ args: rest, options: { keep: { type: 'string' } } });
        const { pruned } = await pruneLighthouse({ storage, keep: values.keep ? Number(values.keep) : DEFAULT_RETENTION, log });
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
