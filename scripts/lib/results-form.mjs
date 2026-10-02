// The Admin page's "Remove Results" (Test Results and Lighthouse Test Results tabs), "Run in CI" (Test Results tab) and
// "Run in Production" (Lighthouse tab): a local service that deletes recorded runs from the private results store
// (removeRuns in results.mjs), and starts a GitHub Actions workflow on the branch chosen in the tab's dialog with the
// owner's gh login and follows it until GitHub says it completed — ci.yml (every Cucumber test) for Run in CI,
// lighthouse.yml (the Lighthouse suite against the live site, publishing the run to R2) for Run in Production. The
// results API the tabs read from is read-only by design, so, like the photo and category services, this exists only in
// `astro dev`, uses the owner's wrangler and gh logins, answers only requests addressed to localhost and refuses a POST
// that doesn't come from the page itself. One request at a time.
//
//   GET  /__results/status    { ok: true }                       is the service here?
//   POST /__results/remove               JSON { runs: [<run id>, …] }   { removed, missing, failed }   test results
//   POST /__results/lighthouse/remove    JSON { runs: [<run id>, …] }   { removed, missing, failed }   Lighthouse results
//   GET  /__results/branches                                            { branches, current, currentOnGitHub }
//   GET  /__results/tests/branches                                      (the same)
//   POST /__results/tests/run            JSON { ref: <branch> }         { run, pollMs }   starts CI on that branch
//   GET  /__results/tests/run                                           { run, pollMs }   how that CI run is going
//   POST /__results/lighthouse/run       JSON { ref: <branch> }         { run, pollMs }   starts measuring production
//   GET  /__results/lighthouse/run                                      { run, pollMs }   how that measurement is going
//
// A workflow run is { ref, startedAt, id, url, status, conclusion, finishedAt, error }: `status` is GitHub's (queued,
// in_progress, completed), `conclusion` its verdict once completed (success, failure, cancelled…; 'not-found' when
// GitHub never listed the run). It ends (`finishedAt`) only when GitHub says it completed, and survives a dev server
// restart. One of each kind at a time: starting a second while one is going answers 409 with the one going.
//
// A Run in Production run also has `target` (the site it measures), and, once it has ended, `runId` (the run it
// published, read from the publisher's own "published <run id>:" line in the workflow's log; null if it never got that
// far) and `summary` (its "✓ every page within budget" / "✗ some pages over budget" line). The tab then waits for the
// results API to serve that run before saying it is done.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHTHOUSE_PREFIX } from './lighthouse-results.mjs';
import { RESULTS_PREFIX, removeRuns } from './results.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { SITE } = await import('../../src/config/site.ts');

/** What Run in Production measures: the live site (lighthouse.yml leaves LIGHTHOUSE_URL unset, so the suite measures SITE.url). */
export const PRODUCTION_URL = SITE.url.replace(/\/$/, '');
/** The workflow Run in Production starts: the Lighthouse suite against the live site, the run published to R2. */
export const LIGHTHOUSE_WORKFLOW = 'lighthouse.yml';
/** How often the tab asks how a Run in Production run is going (one `gh run view` each); it takes about 10 minutes. */
const LIGHTHOUSE_POLL_MS = 15_000;
/** The line the publisher prints once a run is stored (lighthouse-results-cli.mjs): "✓ published <run id>: 3/3 within budget → …". */
const PUBLISHED_LINE = /\bpublished (\S+): /;
/** The recording script's last line (scripts/run-lighthouse.mjs): how the pages did. */
const SUMMARY_LINE = /[✓✗] (?:every page within budget|some pages over budget).*$/;
/** How many times to read a completed Run in Production run's log (GitHub may need a moment to have it) before giving up. */
const LOG_TRIES = 3;

/** The workflow Run in CI starts (lint, type-check, every offline and browser Cucumber test, results to R2). */
export const CI_WORKFLOW = 'ci.yml';
/** A branch name as git allows it, as far as this service needs: no leading dash, no spaces or shell characters. */
const BRANCH_NAME = /^(?!-)[A-Za-z0-9._/-]{1,200}$/;
/** How often the tab asks how a CI run is going (each answer is one `gh run view`); it takes about 20 minutes. */
const CI_POLL_MS = 30_000;

/** Runs a command (gh, git) in this checkout and resolves to what it printed, or rejects with what it said. */
function run(command, args, { stderr: withStderr = true } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: ROOT, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(withStderr ? `${stdout}\n${stderr}` : `${stdout}`);
      const said = `${stderr}`.trim().split('\n').pop();
      reject(new Error(error.code === 'ENOENT' ? `${command === 'gh' ? 'The GitHub CLI (gh)' : command} is not installed.` : said || error.message));
    });
  });
}

const gh = (args) => run('gh', args);

/**
 * The branches Run in CI and Run in Production can choose from:
 *   list()      every branch on GitHub (`git ls-remote --heads origin`: what GitHub has now, nothing fetched or changed)
 *   current()   the branch this checkout is on ('HEAD' when detached)
 */
export const branchesWithGit = {
  async list() {
    const heads = await run('git', ['ls-remote', '--heads', 'origin'], { stderr: false });
    return heads.split('\n').map((line) => line.split('refs/heads/')[1]?.trim()).filter(Boolean).sort();
  },
  async current() {
    return (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stderr: false })).trim();
  },
};

/** How long to keep looking for a run GitHub didn't name when it was started, before saying it never appeared. */
const CI_FIND_MS = 10 * 60_000;
/** A run listed this long before the press still counts as the one started (the two clocks may differ a little). */
const CLOCK_SLACK_MS = 60_000;
/** Where the runs being followed are kept, so a dev server restart picks them up again (.astro/ is git-ignored). */
const CI_STATE_FILE = join(ROOT, '.astro', 'run-in-ci.json');
const LIGHTHOUSE_STATE_FILE = join(ROOT, '.astro', 'run-in-production.json');

/**
 * A workflow through the GitHub CLI and the owner's login:
 *   start(ref, inputs)  starts it on that branch, with those workflow inputs (`-f name=value`); resolves to the new run's
 *                       { id, url } when gh prints its address, else { id: null }. A branch whose workflow doesn't take
 *                       the inputs yet (GitHub: "Unexpected inputs provided") is started again without them.
 *   find(since, ref)  the newest run started by hand on that branch since that time, as { id, url }, or null if none yet
 *   status(id)        GitHub's { status, conclusion, url } for that run
 */
function workflowWithGh(workflow) {
  return {
    async start(ref, inputs = {}) {
      const fields = Object.entries(inputs).flatMap(([name, value]) => ['-f', `${name}=${value}`]);
      let printed;
      try {
        printed = await gh(['workflow', 'run', workflow, '--ref', ref, ...fields]);
      } catch (error) {
        if (!fields.length || !/unexpected inputs/i.test(error.message)) throw error;
        printed = await gh(['workflow', 'run', workflow, '--ref', ref]);
      }
      const url = /https:\/\/github\.com\/\S+\/actions\/runs\/(\d+)/.exec(printed);
      return url ? { id: url[1], url: url[0] } : { id: null, url: null };
    },
    async find(since, ref) {
      const runs = JSON.parse(await gh(['run', 'list', '--workflow', workflow, '--event', 'workflow_dispatch', '--branch', ref, '--limit', '5', '--json', 'databaseId,url,createdAt']));
      const recent = runs.filter((run) => Date.parse(run.createdAt) >= Date.parse(since) - CLOCK_SLACK_MS);
      return recent[0] ? { id: String(recent[0].databaseId), url: recent[0].url } : null;
    },
    async status(id) {
      return JSON.parse(await gh(['run', 'view', id, '--json', 'status,conclusion,url']));
    },
  };
}

/** The CI workflow (Run in CI). */
export const ciWithGh = workflowWithGh(CI_WORKFLOW);

/**
 * What a Lighthouse workflow run's log says it did: { runId, summary }, each null when the log doesn't say (it never got
 * as far as publishing, or ended before measuring). `gh run view --log` puts the job, step and time before each line.
 */
export function publishedFromLog(log) {
  let runId = null;
  let summary = null;
  for (const line of log.split('\n')) {
    const published = PUBLISHED_LINE.exec(line);
    if (published && RUN_ID.test(published[1])) runId = published[1];
    const said = SUMMARY_LINE.exec(line);
    if (said) summary = said[0].trim();
  }
  return { runId, summary };
}

/** The Lighthouse workflow (Run in Production), plus outcome(id): what that run's log says it published. */
export const lighthouseWithGh = {
  ...workflowWithGh(LIGHTHOUSE_WORKFLOW),
  async outcome(id) {
    return publishedFromLog(await run('gh', ['run', 'view', id, '--log'], { stderr: false }));
  },
};

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

/**
 * Follows one kind of workflow run started from here (`label` names it in the log): `start(ref)` starts one, `refresh()`
 * asks GitHub how it is going until GitHub says it completed, `current` is the last one (null before the first). A run
 * GitHub didn't name when it was started is looked for first (it is listed after a moment); one never listed within
 * `findMs` ends as 'not-found'. A failed check keeps what was known and is tried again on the next question. Once GitHub
 * says it completed, `onCompleted(run)` (if given) may add to it; it ends when that resolves true (or throws LOG_TRIES
 * times). Kept in `stateFile`, so a restarted dev server goes on following it.
 */
function createWorkflowFollower({ label, client, stateFile, findMs, log, onCompleted = async () => true, extra = {} }) {
  let current = null;
  try {
    if (stateFile) current = JSON.parse(readFileSync(stateFile, 'utf-8'));
  } catch {
    // none saved yet
  }
  const save = () => {
    if (!stateFile) return;
    try {
      mkdirSync(join(stateFile, '..'), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(current));
    } catch (error) {
      log(`${label}: could not save the run being followed (${error.message})`);
    }
  };
  const finish = () => {
    current.finishedAt = new Date().toISOString();
    log(`${label}: ${current.url ?? ''} ${current.conclusion}`.replace('  ', ' '));
  };

  async function refresh() {
    if (!current || current.finishedAt) return;
    try {
      if (current.status !== 'completed') {
        if (!current.id) {
          const found = await client.find(current.startedAt, current.ref);
          if (!found) {
            if (Date.now() - Date.parse(current.startedAt) > findMs) {
              Object.assign(current, { status: 'completed', conclusion: 'not-found' });
              log(`${label}: GitHub never listed the run`);
              finish();
            }
            save();
            return;
          }
          Object.assign(current, found);
          log(`${label}: found ${found.url}`);
        }
        const now = await client.status(current.id);
        Object.assign(current, { status: now.status, conclusion: now.conclusion || null, url: now.url || current.url, error: null });
      }
      if (current.status === 'completed') {
        try {
          if (await onCompleted(current)) finish();
        } catch (error) {
          current.tries = (current.tries ?? 0) + 1;
          current.error = error.message;
          if (current.tries >= LOG_TRIES) finish();
        }
      }
    } catch (error) {
      current.error = error.message;
    }
    save();
  }

  async function start(ref, { inputs = {}, about = {} } = {}) {
    const startedAt = new Date().toISOString();
    const { id, url } = await client.start(ref, inputs);
    log(`${label}: started ${url ?? 'a run'} on ${ref}`);
    // Done only when GitHub says so: a run it didn't name yet is looked for on the next question (refresh).
    current = { ref, ...extra, ...about, startedAt, id, url, status: 'queued', conclusion: null, finishedAt: null, error: null };
    save();
    return current;
  }

  return {
    get current() {
      return current;
    },
    get going() {
      return Boolean(current && !current.finishedAt);
    },
    refresh,
    start,
  };
}

/** The local test recorder Run in CI's "local checkout" runs (`npm run test:record`: every suite, then published). */
const RECORD_SCRIPT = 'scripts/run-tests.mjs';

/**
 * Runs every Cucumber test in this checkout and publishes the run (scripts/run-tests.mjs), in its own results folder so
 * it never mixes with a run started by hand; `from` and `target` become the run's source and target. Calls `onOutput`
 * with each line printed and `onExit` with the exit code (0: every test passed and the run was published) or the error
 * that kept it from starting.
 */
export function recordTestsLocally({ from, target: ranIn, onOutput, onExit }) {
  const child = spawn(process.execPath, [join(ROOT, RECORD_SCRIPT)], {
    cwd: ROOT,
    env: { ...process.env, RESULTS_FROM: from, RESULTS_TARGET: ranIn, TEST_RESULTS_DIR: join(ROOT, 'test-results', 'on-demand-tests') },
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

/** How many of the last lines a local run printed are kept, to say why one failed. */
const LOCAL_LOG_LINES = 20;
const LOCAL_STATE_FILE = join(ROOT, '.astro', 'run-locally.json');

/**
 * Follows Run in CI's "local checkout" runs, the same way createWorkflowFollower follows GitHub's: `start` runs every
 * test here, `current` is the last run, `going` while it runs. It ends when the recorder exits (conclusion success or
 * failure, its last lines in `log`). A run a dev server restart cut off can't be followed: it ends as 'interrupted'.
 */
function createLocalRunner({ record, stateFile, log }) {
  let current = null;
  try {
    if (stateFile) current = JSON.parse(readFileSync(stateFile, 'utf-8'));
  } catch {
    // none saved yet
  }
  const save = () => {
    if (!stateFile) return;
    try {
      mkdirSync(join(stateFile, '..'), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(current));
    } catch (error) {
      log(`Run locally: could not save the run (${error.message})`);
    }
  };
  if (current && !current.finishedAt) {
    Object.assign(current, { status: 'completed', conclusion: 'interrupted', finishedAt: new Date().toISOString() });
    save();
  }

  function start(ref, { about = {} } = {}) {
    const run = { ref, ...about, startedAt: new Date().toISOString(), id: null, url: null, status: 'in_progress', conclusion: null, finishedAt: null, error: null, log: [] };
    current = run;
    save();
    log(`Run locally: every test in ${ref}`);
    record({
      from: run.source,
      target: run.target,
      onOutput: (line) => {
        run.log.push(line);
        if (run.log.length > LOCAL_LOG_LINES) run.log.shift();
      },
      onExit: (code, error) => {
        if (run.finishedAt) return;
        Object.assign(run, { status: 'completed', conclusion: code === 0 ? 'success' : 'failure', finishedAt: new Date().toISOString(), error: error ? error.message : null });
        log(`Run locally: ${run.conclusion}`);
        save();
      },
    });
    return run;
  }

  return {
    get current() {
      return current;
    },
    get going() {
      return Boolean(current && !current.finishedAt);
    },
    refresh: async () => {},
    start,
  };
}

export function createResultsFormHandler({
  storage,
  ci = ciWithGh,
  lighthouse = lighthouseWithGh,
  branches = branchesWithGit,
  record = recordTestsLocally,
  localStateFile = LOCAL_STATE_FILE,
  target = PRODUCTION_URL,
  ciPollMs = CI_POLL_MS,
  ciFindMs = CI_FIND_MS,
  ciStateFile = CI_STATE_FILE,
  lighthousePollMs = LIGHTHOUSE_POLL_MS,
  lighthouseFindMs = CI_FIND_MS,
  lighthouseStateFile = LIGHTHOUSE_STATE_FILE,
  log = () => {},
}) {
  const ciRuns = createWorkflowFollower({ label: 'Run in CI', client: ci, stateFile: ciStateFile, findMs: ciFindMs, log });
  const localRuns = createLocalRunner({ record, stateFile: localStateFile, log });
  /** Run in CI's last run, wherever it ran: the one started last. */
  const lastTestRun = () => [ciRuns, localRuns].filter((r) => r.current).sort((a, b) => Date.parse(b.current.startedAt) - Date.parse(a.current.startedAt))[0] ?? ciRuns;
  // Run in Production: once GitHub says the run completed, its log says which run it published, and how the pages did.
  const lighthouseRuns = createWorkflowFollower({
    label: 'Run in Production',
    client: lighthouse,
    stateFile: lighthouseStateFile,
    findMs: lighthouseFindMs,
    log,
    extra: { target, runId: null, summary: null },
    onCompleted: async (run) => {
      if (!run.id) return true;
      Object.assign(run, await lighthouse.outcome(run.id), { error: null });
      return true;
    },
  });

  async function bodyOf(request) {
    try {
      return (await request.json()) ?? {};
    } catch {
      throw new FormError(400, 'bad-request', 'Send JSON: { "ref": "<branch>" }.');
    }
  }

  /** The branch a Run in CI / Run in Production request names, if it is one GitHub has (so it can run there); refused otherwise. */
  async function branchToRun({ ref }) {
    if (typeof ref !== 'string' || !BRANCH_NAME.test(ref)) throw new FormError(400, 'bad-request', 'Name the branch to run on.');
    let onGitHub;
    try {
      onGitHub = await branches.list();
    } catch (error) {
      throw new FormError(502, 'git-failed', `Could not list the branches on GitHub: ${error.message}`);
    }
    if (!onGitHub.includes(ref)) throw new FormError(400, 'not-on-github', `The branch ${ref} is not on GitHub; push it first.`);
    return ref;
  }

  /**
   * POST …/run: starts `runs` on the branch asked for, unless one of `alsoBusy` is still going (then answers 409 with
   * that one). `how` gives the workflow inputs and what the run records about itself.
   */
  async function startRun(body, runs, pollMs, busy, { how = {}, alsoBusy = [runs] } = {}) {
    const ref = body.where === 'local' ? await branches.current() : await branchToRun(body);
    return await inTurn(async () => {
      for (const other of alsoBusy) await other.refresh();
      const going = alsoBusy.find((other) => other.going);
      if (going) return json(409, { error: 'busy', message: busy, run: going.current, pollMs });
      try {
        return json(202, { run: await runs.start(ref, how), pollMs });
      } catch (error) {
        throw new FormError(502, 'ci-failed', error.message);
      }
    });
  }

  /** GET …/run: how the last one is going. */
  const followRun = (runs, pollMs) =>
    inTurn(async () => {
      await runs.refresh();
      return json(200, { run: runs.current, pollMs });
    });

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
          storage.warm?.(); // the tab asks this when Remove Results is pressed: the storage's login is ready by Delete
          return json(200, { ok: true });
        case 'POST remove':
        case 'POST lighthouse/remove': {
          const runs = await runsToRemove(request);
          const prefix = route === 'POST remove' ? RESULTS_PREFIX : LIGHTHOUSE_PREFIX;
          return await inTurn(async () => json(200, await removeRuns({ storage, runIds: runs, prefix, log })));
        }
        case 'GET branches':
        case 'GET tests/branches':
          try {
            const [onGitHub, current] = await Promise.all([branches.list(), branches.current()]);
            return json(200, { branches: onGitHub, current, currentOnGitHub: onGitHub.includes(current) });
          } catch (error) {
            throw new FormError(502, 'git-failed', `Could not list the branches on GitHub: ${error.message}`);
          }
        case 'POST tests/run': {
          // Where it is started from: this page's host (localhost:4321). On GitHub it ran in GitHub CI (the host is
          // passed as the workflow's `source` input); "local checkout" runs every test on this computer.
          const body = await bodyOf(request);
          const local = body.where === 'local';
          const about = { source: url.host, target: local ? 'local checkout' : 'GitHub CI' };
          const how = local ? { about } : { about, inputs: { source: url.host } };
          return await startRun(body, local ? localRuns : ciRuns, ciPollMs, 'A test run started from here is still going.', { how, alsoBusy: [ciRuns, localRuns] });
        }
        case 'GET tests/run':
          return await followRun(lastTestRun(), ciPollMs);
        case 'POST lighthouse/run':
          // Its source is this page's host, passed to GitHub as the workflow's `source` input.
          return await startRun(await bodyOf(request), lighthouseRuns, lighthousePollMs, 'A Lighthouse run is already measuring production.', {
            how: { inputs: { source: url.host }, about: { source: url.host } },
          });
        case 'GET lighthouse/run':
          return await followRun(lighthouseRuns, lighthousePollMs);
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
