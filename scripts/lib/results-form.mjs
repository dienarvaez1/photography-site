// The Admin page's "Remove Results" (Test Results and Lighthouse Test Results tabs) and "Run in Production" (Lighthouse
// tab): a local service that deletes recorded runs from the private results store (removeRuns in results.mjs) and, on
// demand, measures the production site with the Lighthouse suite on this computer and publishes the run
// (scripts/run-lighthouse.mjs, the same as `npm run test:lighthouse:record`); and "Run in CI" (Test Results tab), which
// starts the CI workflow (every Cucumber test) on GitHub with the owner's gh login and follows it. The results API the tab reads from is read-only by design, so,
// like the photo and category services, this exists only in `astro dev`, uses the owner's wrangler login, answers only
// requests addressed to localhost and refuses a POST that doesn't come from the page itself. One request at a time.
//
//   GET  /__results/status    { ok: true }                       is the service here?
//   POST /__results/remove               JSON { runs: [<run id>, …] }   { removed, missing, failed }   test results
//   POST /__results/lighthouse/remove    JSON { runs: [<run id>, …] }   { removed, missing, failed }   Lighthouse results
//   POST /__results/lighthouse/run       (no body)                      { run }   starts measuring production
//   GET  /__results/lighthouse/run                                      { run }   how that measurement is going
//   POST /__results/tests/run            (no body)                      { run, pollMs }   starts CI on main
//   GET  /__results/tests/run                                           { run, pollMs }   how that CI run is going
//
// A measurement is { target, startedAt, finishedAt, ok, exitCode, error, log }: `finishedAt` null while it runs, `ok` true
// when every page met its budget and the run was published, `log` the last lines it printed. One at a time: starting a
// second while one runs answers 409 with the one running.
//
// A CI run is { ref, startedAt, id, url, status, conclusion, finishedAt, error }: `status` is GitHub's (queued,
// in_progress, completed), `conclusion` its verdict once completed (success, failure, cancelled…). Also one at a time.
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHTHOUSE_PREFIX } from './lighthouse-results.mjs';
import { RESULTS_PREFIX, removeRuns } from './results.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { SITE } = await import('../../src/config/site.ts');

/** What Run in Production measures: the live site, never this computer's dev server. */
export const PRODUCTION_URL = SITE.url.replace(/\/$/, '');
/** How many of the last lines a measurement printed are kept, to say why one failed. */
const LOG_LINES = 20;

/** The workflow Run in CI starts (lint, type-check, every offline and browser Cucumber test, results to R2), on which branch. */
export const CI_WORKFLOW = 'ci.yml';
export const CI_REF = 'main';
/** How often the tab asks how a CI run is going (each answer is one `gh run view`); it takes about 20 minutes. */
const CI_POLL_MS = 30_000;

/** Runs gh in this checkout (its repository) and resolves to what it printed, or rejects with what it said. */
function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd: ROOT, timeout: 60_000 }, (error, stdout, stderr) => {
      if (!error) return resolve(`${stdout}\n${stderr}`);
      const said = `${stderr}`.trim().split('\n').pop();
      reject(new Error(error.code === 'ENOENT' ? 'The GitHub CLI (gh) is not installed.' : said || error.message));
    });
  });
}

/**
 * The CI workflow through the GitHub CLI and the owner's login. `start` resolves to the new run's { id, url }: gh prints
 * its address; failing that, the newest run started by hand. `status` resolves to { status, conclusion, url }.
 */
export const ciWithGh = {
  async start() {
    const printed = await gh(['workflow', 'run', CI_WORKFLOW, '--ref', CI_REF]);
    const url = /https:\/\/github\.com\/\S+\/actions\/runs\/(\d+)/.exec(printed);
    if (url) return { id: url[1], url: url[0] };
    await new Promise((resolve) => setTimeout(resolve, 3000)); // GitHub lists a new run after a moment
    const [newest] = JSON.parse(await gh(['run', 'list', '--workflow', CI_WORKFLOW, '--event', 'workflow_dispatch', '--branch', CI_REF, '--limit', '1', '--json', 'databaseId,url']));
    return newest ? { id: String(newest.databaseId), url: newest.url } : { id: null, url: null };
  },
  async status(id) {
    return JSON.parse(await gh(['run', 'view', id, '--json', 'status,conclusion,url']));
  },
};

/**
 * Measures `target` with the Lighthouse suite and publishes the run to R2 (scripts/run-lighthouse.mjs), in its own
 * results folder so it never mixes with `npm run test:lighthouse` run by hand. Calls `onOutput` with each line printed
 * and `onExit` with the exit code (0: every page within budget and published) or the error that kept it from starting.
 */
export function measureWithLighthouse({ target, onOutput, onExit }) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts/run-lighthouse.mjs')], {
    cwd: ROOT,
    env: { ...process.env, LIGHTHOUSE_URL: target, TEST_RESULTS_DIR: join(ROOT, 'test-results', 'on-demand') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf-8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) onOutput(line);
    });
  }
  child.on('error', (error) => onExit(null, error));
  child.on('exit', (code) => onExit(code));
}

export const RESULTS_FORM_PREFIX = '/__results/';
/** The most runs one removal may name (the index keeps at most 100). */
export const MAX_RUN_REMOVALS = 100;
/** A run id as the publisher makes them: `2026-10-01T01-51-55Z-61208b3-local` (the results API checks the same). */
export const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

class FormError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Refuses anything but the owner's own page on localhost. */
function assertOwnPage(request, url) {
  if (!LOCAL_HOSTS.has(url.hostname)) throw new FormError(403, 'not-local', 'The local results service only works on localhost.');
  const origin = request.headers.get('Origin');
  if (request.method === 'POST' ? origin !== url.origin : origin !== null && origin !== url.origin) {
    throw new FormError(403, 'not-local', 'The local results service only takes requests from its own page.');
  }
}

async function runsToRemove(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new FormError(400, 'bad-request', 'Send JSON: { "runs": ["<run id>", …] }.');
  }
  const runs = body?.runs;
  if (!Array.isArray(runs) || !runs.length) throw new FormError(400, 'bad-request', 'Name at least one run.');
  if (runs.length > MAX_RUN_REMOVALS) throw new FormError(400, 'bad-request', `At most ${MAX_RUN_REMOVALS} runs can be removed at once.`);
  if (!runs.every((id) => typeof id === 'string' && RUN_ID.test(id))) throw new FormError(400, 'bad-request', 'That is not a run id.');
  return [...new Set(runs)];
}

export function createResultsFormHandler({ storage, measure = measureWithLighthouse, target = PRODUCTION_URL, ci = ciWithGh, ciPollMs = CI_POLL_MS, log = () => {} }) {
  /** The last Run in CI run (null before the first). */
  let ciRun = null;

  /** Asks GitHub how the CI run is going (once it is known and not yet completed). A failed check keeps what was known. */
  async function refreshCiRun() {
    if (!ciRun?.id || ciRun.status === 'completed') return;
    try {
      const now = await ci.status(ciRun.id);
      Object.assign(ciRun, { status: now.status, conclusion: now.conclusion || null, url: now.url || ciRun.url, error: null });
      if (now.status === 'completed' && !ciRun.finishedAt) {
        ciRun.finishedAt = new Date().toISOString();
        log(`Run in CI: ${ciRun.url} ${ciRun.conclusion}`);
      }
    } catch (error) {
      ciRun.error = error.message;
    }
  }

  async function startCiRun() {
    const startedAt = new Date().toISOString();
    const { id, url } = await ci.start();
    log(`Run in CI: started ${url ?? CI_WORKFLOW}`);
    // A run GitHub didn't name can't be followed: it is reported as started, and done as far as this service knows.
    ciRun = { ref: CI_REF, startedAt, id, url, status: id ? 'queued' : 'completed', conclusion: id ? null : 'unknown', finishedAt: id ? null : startedAt, error: null };
    return ciRun;
  }

  /** The last Run in Production measurement (null before the first). */
  let measurement = null;

  function startMeasuring() {
    const run = { target, startedAt: new Date().toISOString(), finishedAt: null, ok: null, exitCode: null, error: null, log: [] };
    measurement = run;
    log(`Run in Production: measuring ${target}`);
    measure({
      target,
      onOutput: (line) => {
        run.log.push(line);
        if (run.log.length > LOG_LINES) run.log.shift();
      },
      onExit: (code, error) => {
        if (run.finishedAt) return;
        Object.assign(run, { finishedAt: new Date().toISOString(), exitCode: code ?? null, ok: code === 0, error: error ? error.message : null });
        log(`Run in Production: ${run.ok ? 'done' : `ended with ${error ? error.message : `exit code ${code}`}`}`);
      },
    });
    return run;
  }

  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work, work);
    queue = turn.catch(() => {});
    return turn;
  };

  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(RESULTS_FORM_PREFIX)) return null;
    const route = `${request.method} ${url.pathname.slice(RESULTS_FORM_PREFIX.length)}`;
    try {
      assertOwnPage(request, url);
      switch (route) {
        case 'GET status':
          return json(200, { ok: true });
        case 'POST remove':
        case 'POST lighthouse/remove': {
          const runs = await runsToRemove(request);
          const prefix = route === 'POST remove' ? RESULTS_PREFIX : LIGHTHOUSE_PREFIX;
          return await inTurn(async () => json(200, await removeRuns({ storage, runIds: runs, prefix, log })));
        }
        case 'POST lighthouse/run':
          if (measurement && !measurement.finishedAt) return json(409, { error: 'busy', message: 'A Lighthouse run is already measuring production.', run: measurement });
          return json(202, { run: startMeasuring() });
        case 'GET lighthouse/run':
          return json(200, { run: measurement });
        case 'POST tests/run':
          return await inTurn(async () => {
            await refreshCiRun();
            if (ciRun && ciRun.status !== 'completed') return json(409, { error: 'busy', message: 'A CI run started from here is still going.', run: ciRun, pollMs: ciPollMs });
            try {
              return json(202, { run: await startCiRun(), pollMs: ciPollMs });
            } catch (error) {
              throw new FormError(502, 'ci-failed', error.message);
            }
          });
        case 'GET tests/run':
          return await inTurn(async () => {
            await refreshCiRun();
            return json(200, { run: ciRun, pollMs: ciPollMs });
          });
        default:
          throw new FormError(404, 'not-found', 'Not found.');
      }
    } catch (error) {
      if (error instanceof FormError) return json(error.status, { error: error.code, message: error.message });
      log(`Remove Results: ${error.message}`);
      return json(500, { error: 'failed', message: error.message });
    }
  };
}
