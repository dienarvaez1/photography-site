import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ROOT } from '../support/lib.js';
import { fakeResult, writeRunFolder } from '../support/lighthouse-fixtures.js';

const lib = await import(join(ROOT, 'scripts/lib/lighthouse-results.mjs'));
const cli = await import(join(ROOT, 'scripts/lib/lighthouse-results-cli.mjs'));
const results = await import(join(ROOT, 'scripts/lib/results.mjs'));

// The fake bucket and folder come from test-results.steps.js ("a fake test-results bucket"); the Lighthouse run is its
// lighthouse/ subfolder, where `npm run test:lighthouse` puts it.
const state = (world) => world.data.results;
const lhDir = (world) => join(state(world).dir, 'lighthouse');
const bucket = (world) => state(world).bucket;
const keys = (world) => [...bucket(world).objects.keys()].sort();
const stored = (world, key) => JSON.parse(bucket(world).objects.get(key).body.toString('utf-8'));
const DEVICES = { phone: 'mobile', laptop: 'desktop' };

Given(/^a Lighthouse run folder that measured "([^"]+)" on a (phone|laptop) \(performance (\d+)\) and "([^"]+)" on a (phone|laptop) \(performance (\d+)\)$/, function (p1, d1, s1, p2, d2, s2) {
  rmSync(lhDir(this), { recursive: true, force: true });
  writeRunFolder(lhDir(this), [
    fakeResult(p1, DEVICES[d1], { performance: Number(s1) / 100, lcp: 2000 }),
    fakeResult(p2, DEVICES[d2], { performance: Number(s2) / 100, lcp: 900 }),
  ]);
});

const publish = (world, { source = 'local', at, commit = 'abc1234', branch = 'main', retain } = {}) =>
  lib.publishLighthouse({ dir: lhDir(world), storage: bucket(world), source, now: new Date(at ?? '2026-09-29T12:00:00Z'), meta: { commit, branch, dirty: false }, ...(retain ? { retain } : {}) });

When('I publish the Lighthouse run from {string} at {string} for commit {string} on branch {string}', async function (source, at, commit, branch) {
  state(this).lighthouse = await publish(this, { source, at, commit, branch });
});

When('I publish {int} Lighthouse runs keeping only the newest {int}', async function (count, keep) {
  state(this).lighthouseRuns = [];
  for (let i = 0; i < count; i++) state(this).lighthouseRuns.push(await publish(this, { at: `2026-09-29T1${i}:00:00Z`, commit: `c${i}c${i}c${i}c`, retain: keep }));
});

Given(/^the Lighthouse run folder (does not exist|has no summary\.json|has a broken summary\.json)$/, function (problem) {
  if (problem === 'does not exist') rmSync(lhDir(this), { recursive: true, force: true });
  else if (problem === 'has no summary.json') rmSync(join(lhDir(this), 'summary.json'));
  else writeFileSync(join(lhDir(this), 'summary.json'), '{ "results": [');
});

When('I try to publish the Lighthouse run', async function () {
  try {
    await publish(this);
    state(this).error = null;
  } catch (error) {
    state(this).error = error;
  }
});

Then('publishing should fail with a message mentioning {string}', function (text) {
  assert.ok(state(this).error, 'publishing should have failed');
  assert.ok(state(this).error.message.includes(text), state(this).error.message);
});

Then('the bucket should hold exactly these Lighthouse keys for run {string}:', function (runId, table) {
  assert.equal(state(this).lighthouse.runId, runId);
  const expected = table.raw().map(([key]) => key.replace('<run>', runId)).sort();
  assert.deepEqual(keys(this).filter((k) => k.startsWith('lighthouse-results/')), expected);
});

Then('nothing should be stored under {string}', function (prefix) {
  assert.deepEqual(keys(this).filter((k) => k.startsWith(prefix)), []);
});

const latest = (world) => stored(world, 'lighthouse-results/latest.json');
const index = (world) => stored(world, 'lighthouse-results/index.json');

Then('the latest Lighthouse summary should say it measured {string} with {int} runs per page, from {string}, commit {string} on {string}', function (url, runs, source, commit, branch) {
  const s = latest(this);
  assert.deepEqual([s.baseUrl, s.runsPerPage, s.source, s.commit, s.branch], [url, runs, source, commit, branch]);
});

Then('the latest Lighthouse summary should list {string} with performance {int} and {string} with performance {int}', function (a, pa, b, pb) {
  const rows = latest(this).results.map((r) => [`${r.path} ${r.device}`, r.scores.performance]);
  assert.deepEqual(rows, [[a, pa], [b, pb]]);
});

Then(/^the latest Lighthouse summary should count (\d+) of (\d+) within budget, and (be ok|not be ok)$/, function (within, total, ok) {
  const s = latest(this);
  assert.deepEqual([s.totals.withinBudget, s.totals.measurements, s.ok], [Number(within), Number(total), ok === 'be ok']);
});

Then('the latest Lighthouse summary should list every file of the run', function () {
  const s = latest(this);
  assert.deepEqual([...s.files].sort(), keys(this).filter((k) => k.startsWith(`lighthouse-results/runs/${s.runId}/`)));
});

Then('the Lighthouse index should list {string} as over budget in its newest run', function (which) {
  const [path, device] = which.split(' ');
  assert.deepEqual(index(this).runs[0].overBudget, [{ path, device }]);
});

Then('the Lighthouse index should list {int} runs, newest first: {string}', function (count, commits) {
  assert.equal(index(this).runs.length, count);
  assert.deepEqual(index(this).runs.map((r) => r.commit), commits.split(', '));
});

Then('the Lighthouse index should list {int} runs', function (count) {
  assert.equal(index(this).runs.length, count);
});

Then('the newest Lighthouse run in the index should show performance {int} on mobile and {int} on desktop, {int} of {int} within budget', function (mobile, desktop, within, total) {
  const run = index(this).runs[0];
  assert.deepEqual(run.performance, { mobile, desktop });
  assert.deepEqual([run.totals.withinBudget, run.totals.measurements], [within, total]);
});

Then('the Lighthouse index should have been written after every file it names', function () {
  // The fake bucket keeps insertion order; the index must be the last object written.
  const order = [...bucket(this).objects.keys()];
  assert.equal(order.at(-1), 'lighthouse-results/index.json');
  for (const key of index(this).runs[0].files) assert.ok(order.indexOf(key) < order.indexOf('lighthouse-results/index.json'), key);
});

Then("the oldest Lighthouse run's files should be gone from the bucket", function () {
  const oldest = state(this).lighthouseRuns[0].runId;
  assert.deepEqual(keys(this).filter((k) => k.includes(oldest)), []);
});

Given('the results folder also holds a report of 3 passing scenarios', function () {
  const report = [{ uri: 'features/example.feature', name: 'Example', elements: Array.from({ length: 3 }, (_, i) => ({ type: 'scenario', name: `Scenario ${i + 1}`, steps: [{ keyword: 'Given ', name: 'a step', result: { status: 'passed', duration: 1 } }] })) }];
  mkdirSync(state(this).dir, { recursive: true });
  writeFileSync(join(state(this).dir, 'offline.json'), JSON.stringify(report));
});

When('I publish the test results', async function () {
  await results.publishResults({ dir: state(this).dir, storage: bucket(this), meta: { commit: 'abc1234', branch: 'main', dirty: false }, now: new Date('2026-09-29T12:00:00Z') });
});

Then('no stored test-results file should come from the Lighthouse folder', function () {
  assert.deepEqual(keys(this).filter((k) => k.includes('/lighthouse/')), []);
});

// --- The command line ---------------------------------------------------------------------------------------------

When('I run the Lighthouse results command {string}', async function (command) {
  const out = [];
  const err = [];
  state(this).cli = {
    code: await cli.run(command.split(' '), { dir: lhDir(this), storage: bucket(this), log: (l) => out.push(l), error: (l) => err.push(l), meta: { commit: 'abc1234', branch: 'main', dirty: false }, now: new Date('2026-09-29T12:00:00Z') }),
    out: out.join('\n'),
    err: err.join('\n'),
  };
});

Then('the Lighthouse results command should succeed and say {string}', function (text) {
  const { code, out, err } = state(this).cli;
  assert.equal(code, 0, err);
  assert.ok(out.includes(text) || out.includes(text.replace('mobile', 'phone')), out);
});

Then('the Lighthouse results command should fail and say {string}', function (text) {
  const { code, err } = state(this).cli;
  assert.equal(code, 1);
  assert.ok(err.includes(text), err);
});

Then('the {string} script should run the Lighthouse suite and then publish it', function (name) {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts;
  assert.equal(scripts[name], 'node scripts/run-lighthouse.mjs');
  const runner = readFileSync(join(ROOT, 'scripts/run-lighthouse.mjs'), 'utf-8');
  assert.ok(runner.indexOf("'--profile', 'lighthouse'") < runner.indexOf("publish(['publish']"), 'measure first, then publish');
});

Then('the Lighthouse results commands should publish to {string} in the test bucket', function (prefix) {
  assert.equal(lib.LIGHTHOUSE_PREFIX, prefix);
  assert.equal(lib.RESULTS_BUCKET, 'photography-site-test');
});

// --- The Admin tab's logic (src/lib/lighthouse-view.ts) -------------------------------------------------------------

const view = await import(join(ROOT, 'src/lib/lighthouse-view.ts'));

Then(/^the Lighthouse tab address "([^"]*)" should show (the list|the run "[^"]*"|nothing)$/, function (hash, what) {
  const runId = /^the run "(.*)"$/.exec(what)?.[1];
  const expected = what === 'nothing' ? null : what === 'the list' ? { view: 'list' } : { view: 'run', runId };
  assert.deepEqual(view.parseLighthouseRoute(hash), expected);
});

Then(/^the Lighthouse link "([^"]*)" should be (followed|not followed)$/, function (link, verdict) {
  assert.equal(view.isLighthouseLink(link, 'https://api.test'), verdict === 'followed');
});

Then(/^the Lighthouse (score|metric [a-z-]+|size) ([\d.]+) should read "([^"]*)" in "([a-z]+)"$/, function (what, value, shown, locale) {
  const n = Number(value);
  const actual = what === 'score' ? view.scoreBand(n) : what === 'size' ? view.formatKilobytes(n, locale) : view.formatMetric(what.slice('metric '.length), n, locale);
  assert.equal(actual, shown);
});

// --- Remove Results and Run in Production (the local results service, scripts/lib/results-form.mjs) ----------------------

const resultsForm = await import(join(ROOT, 'scripts/lib/results-form.mjs'));
const LOCAL = 'http://localhost:4321';

/**
 * The scenario's service: this bucket, and a stand-in for GitHub's Lighthouse workflow that records each start's branch
 * and answers what the scenario says GitHub says (`gh`). GitHub has the branches main and QA-feature_x. The run being
 * followed is kept in the scenario's own file, never the real .astro/run-in-production.json; "the dev server restarts"
 * makes a new service over the same file.
 */
function service(world, { restart = false } = {}) {
  const s = state(world);
  if (!s.service || restart) {
    s.gh ??= { refs: [], status: 'queued', conclusion: '', log: '', logError: null };
    const url = (id) => `https://github.com/dienarvaez1/photography-site/actions/runs/${id}`;
    const lighthouse = {
      start: async (ref) => {
        s.gh.refs.push(ref);
        return { id: '9000', url: url('9000') };
      },
      find: async () => null,
      status: async (id) => ({ status: s.gh.status, conclusion: s.gh.conclusion, url: url(id) }),
      outcome: async () => {
        if (s.gh.logError) throw new Error(s.gh.logError);
        return resultsForm.publishedFromLog(s.gh.log);
      },
    };
    const branches = { list: async () => ['QA-feature_x', 'main'], current: async () => 'QA-feature_x' };
    mkdirSync(s.dir, { recursive: true });
    s.service = resultsForm.createResultsFormHandler({ storage: bucket(world), lighthouse, branches, lighthousePollMs: 10, lighthouseStateFile: join(s.dir, 'run-in-production.json'), ciStateFile: null });
  }
  return s.service;
}

async function ask(world, method, path, { origin = LOCAL, body } = {}) {
  const init = { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) };
  const response = await service(world)(new Request(`${LOCAL}${path}`, init));
  state(world).answer = { status: response.status, body: await response.json() };
}

When('the local results service is asked to remove the newest Lighthouse run', async function () {
  const newest = state(this).lighthouseRuns.at(-1);
  state(this).removedLighthouse = newest;
  await ask(this, 'POST', '/__results/lighthouse/remove', { body: { runs: [newest.runId] } });
  assert.deepEqual(state(this).answer, { status: 200, body: { removed: [newest.runId], missing: [], failed: [] } });
});

When('every delete from the bucket takes {int} ms', function (ms) {
  const storage = bucket(this);
  const deleteNow = storage.delete.bind(storage);
  const deletes = (state(this).deletes = { delayMs: ms, count: 0, active: 0, peak: 0 });
  storage.delete = async (key) => {
    deletes.count++;
    deletes.peak = Math.max(deletes.peak, ++deletes.active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    deletes.active--;
    return deleteNow(key);
  };
});

When('the bucket can\'t delete the files of the second Lighthouse run', function () {
  bucket(this).faults.failDeleteMatching = state(this).lighthouseRuns[1].runId;
});

When('the local results service is asked to remove every Lighthouse run', async function () {
  const started = Date.now();
  await ask(this, 'POST', '/__results/lighthouse/remove', { body: { runs: state(this).lighthouseRuns.map((run) => run.runId) } });
  state(this).removalMs = Date.now() - started;
});

const runIdsOf = (world, positions) => positions.map((i) => state(world).lighthouseRuns[i].runId);

Then('the service should report every Lighthouse run removed, nothing missing or failed', function () {
  const { status, body } = state(this).answer;
  assert.equal(status, 200);
  assert.deepEqual({ ...body, removed: [...body.removed].sort() }, { removed: runIdsOf(this, [0, 1, 2]).sort(), missing: [], failed: [] });
});

Then('the service should report the second Lighthouse run failed and the others removed', function () {
  const { body } = state(this).answer;
  assert.deepEqual([...body.removed].sort(), runIdsOf(this, [0, 2]).sort());
  assert.deepEqual(body.failed.map((f) => f.runId), runIdsOf(this, [1]));
  assert.match(body.failed[0].error, /simulated delete failure/);
});

Then(/^no file of (any removed Lighthouse run|the first and third Lighthouse runs) should be left in the bucket$/, function (which) {
  const runIds = which === 'any removed Lighthouse run' ? runIdsOf(this, [0, 1, 2]) : runIdsOf(this, [0, 2]);
  for (const runId of runIds) assert.deepEqual(keys(this).filter((k) => k.includes(runId)), [], runId);
});

Then('the bucket should have been deleting more than {int} file at once, but never more than {int}', function (low, high) {
  const { peak } = state(this).deletes;
  assert.equal(results.DELETE_CONCURRENCY, high);
  assert.ok(peak > low && peak <= high, `at most ${peak} at once`);
});

Then('the removal should have taken less than half as long as deleting the files one by one', function () {
  const { count, delayMs } = state(this).deletes;
  assert.ok(count >= 10, `${count} deletes`);
  assert.ok(state(this).removalMs < (count * delayMs) / 2, `${state(this).removalMs} ms for ${count} deletes of ${delayMs} ms each`);
});

Then('the latest Lighthouse summary should be the newest run left', function () {
  assert.equal(stored(this, 'lighthouse-results/latest.json').runId, state(this).lighthouseRuns.at(-2).runId);
});

Then("the removed Lighthouse run's files should be gone from the bucket", function () {
  const { runId } = state(this).removedLighthouse;
  assert.deepEqual(keys(this).filter((k) => k.includes(runId)), []);
});

When('the local results service is asked to run Lighthouse in production on the branch {string}', async function (ref) {
  await ask(this, 'POST', '/__results/lighthouse/run', { body: { ref } });
});

When('another site asks the local results service to run Lighthouse in production', async function () {
  await ask(this, 'POST', '/__results/lighthouse/run', { origin: 'https://evil.example', body: { ref: 'main' } });
});

When('the service is asked how the measurement is going', async function () {
  await ask(this, 'GET', '/__results/lighthouse/run');
});

When('the dev server restarts while the Lighthouse run is going', function () {
  service(this, { restart: true });
});

const logSaying = (runId, summary) =>
  [`lighthouse\tstore\t2026-10-01T18:40:00.3Z ✓ published ${runId}: 6/6 within budget → photography-site-test/lighthouse-results/runs/${runId}/`, `lighthouse\tstore\t2026-10-01T18:40:00.5Z ${summary}`].join('\n');

When(/^GitHub says the Lighthouse run completed with "([^"]+)", its log saying it published "([^"]+)" and "([^"]+)"$/, function (conclusion, runId, summary) {
  Object.assign(state(this).gh, { status: 'completed', conclusion, log: logSaying(runId, summary), logError: null });
});

When('GitHub says the Lighthouse run completed with {string}, its log saying nothing was published', function (conclusion) {
  Object.assign(state(this).gh, { status: 'completed', conclusion, log: 'lighthouse\tmeasure\t2026-10-01T18:40:00Z Error: Chromium could not start', logError: null });
});

When('GitHub says the Lighthouse run completed with {string}, but its log can\'t be read: {string}', function (conclusion, message) {
  Object.assign(state(this).gh, { status: 'completed', conclusion, logError: message });
});

When(/^the Lighthouse run's log can be read, saying it published "([^"]+)" and "([^"]+)"$/, function (runId, summary) {
  Object.assign(state(this).gh, { log: logSaying(runId, summary), logError: null });
});

Then('the service should answer 202 with a Lighthouse run on {string} measuring the production site, still going', function (ref) {
  const { status, body } = state(this).answer;
  assert.equal(status, 202);
  assert.equal(body.run.ref, ref);
  assert.equal(body.run.target, resultsForm.PRODUCTION_URL);
  assert.equal(body.run.url, 'https://github.com/dienarvaez1/photography-site/actions/runs/9000');
  assert.equal(body.run.finishedAt, null);
  assert.equal(body.run.runId, null);
  assert.ok(!Number.isNaN(Date.parse(body.run.startedAt)));
});

Then('the Lighthouse workflow should have been started once, on the branch {string}', function (ref) {
  assert.deepEqual(state(this).gh.refs, [ref]);
});

Then('the Lighthouse workflow should not have been started', function () {
  assert.deepEqual(state(this).gh?.refs ?? [], []);
});

Then('it should say the measurement is still going', function () {
  const { status, body } = state(this).answer;
  assert.equal(status, 200);
  assert.equal(body.run.finishedAt, null);
  assert.equal(body.run.runId, null);
});

Then(/^it should say the measurement ended with "([^"]+)", having published (?:"([^"]+)", with "([^"]+)"|no run)$/, function (conclusion, runId, summary) {
  const { run } = state(this).answer.body;
  assert.ok(run.finishedAt);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, conclusion);
  assert.equal(run.runId, runId ?? null);
  if (runId) assert.equal(run.summary, summary);
});

Then('it should say the error {string}', function (message) {
  assert.equal(state(this).answer.body.run.error, message);
});

Then('the service should answer {int} with the error {string} and the measurement already running', function (status, code) {
  const { answer } = state(this);
  assert.equal(answer.status, status);
  assert.equal(answer.body.error, code);
  assert.equal(answer.body.run.finishedAt, null);
});

Then('the service should answer {int} with the error {string} saying {string}', function (status, code, text) {
  const { answer } = state(this);
  assert.equal(answer.status, status);
  assert.equal(answer.body.error, code);
  assert.ok(answer.body.message.includes(text), answer.body.message);
});

Then("the local results service should measure {string}, the site's own address", async function (url) {
  const { SITE } = await import(join(ROOT, 'src/config/site.ts'));
  assert.equal(resultsForm.PRODUCTION_URL, url);
  assert.equal(SITE.url.replace(/\/$/, ''), url);
});

Then('it should start {string} with {string}, follow it with {string}, and read its log with {string}', function (file, start, follow, readLog) {
  assert.equal(resultsForm.LIGHTHOUSE_WORKFLOW, file);
  const source = readFileSync(join(ROOT, 'scripts/lib/results-form.mjs'), 'utf-8');
  assert.equal(start, 'gh workflow run');
  assert.ok(source.includes("gh(['workflow', 'run', workflow, '--ref', ref])"));
  assert.equal(follow, 'gh run view');
  assert.ok(source.includes("gh(['run', 'view', id, '--json', 'status,conclusion,url'])"));
  assert.equal(readLog, 'gh run view --log');
  assert.ok(source.includes("run('gh', ['run', 'view', id, '--log']"));
  assert.ok(source.includes('...workflowWithGh(LIGHTHOUSE_WORKFLOW)'));
});

Then('the Lighthouse workflow should leave LIGHTHOUSE_URL unset, so the suite measures that address', async function () {
  assert.equal(JSON.stringify(workflow()).includes('LIGHTHOUSE_URL'), false);
  const { BASE_URL } = await import(join(ROOT, 'features/support/lighthouse.js'));
  if (!process.env.LIGHTHOUSE_URL) assert.equal(BASE_URL, resultsForm.PRODUCTION_URL);
});

When('the service reads this Lighthouse workflow log:', function (log) {
  state(this).read = resultsForm.publishedFromLog(log);
});

Then('it should find the published run {string} and the summary {string}', function (runId, summary) {
  assert.deepEqual(state(this).read, { runId, summary });
});

const workflow = () => yaml.load(readFileSync(join(ROOT, '.github/workflows/lighthouse.yml'), 'utf-8'));

Then('the Lighthouse workflow should only run when started by hand', function () {
  assert.deepEqual(Object.keys(workflow().on), ['workflow_dispatch']);
});

Then('it should install Chromium and run {string} when the R2 secrets exist, and {string} when they don\'t', function (stored, notStored) {
  const job = workflow().jobs.lighthouse;
  assert.equal(job.env.CLOUDFLARE_API_TOKEN, '${{ secrets.CLOUDFLARE_API_TOKEN }}');
  assert.equal(job.env.CLOUDFLARE_ACCOUNT_ID, '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
  const runs = job.steps.filter((step) => step.run);
  assert.ok(runs.some((step) => step.run.includes('playwright install') && step.run.includes('chromium')));
  assert.equal(runs.find((step) => step.run === stored)?.if, "${{ env.CLOUDFLARE_API_TOKEN != '' }}");
  assert.equal(runs.find((step) => step.run === notStored)?.if, "${{ env.CLOUDFLARE_API_TOKEN == '' }}");
});

Then('it should keep the reports with the run even when pages are over budget', function () {
  const upload = workflow().jobs.lighthouse.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
  assert.equal(upload?.if, '${{ always() }}');
  assert.equal(upload.with.path, 'test-results/lighthouse/');
});

// --- Where a Lighthouse run was started from, and what it measured ----------------------------------------------------------

When('I publish the Lighthouse run from {string} started from {string} at {string}', async function (source, from, at) {
  state(this).lighthouse = await lib.publishLighthouse({ dir: lhDir(this), storage: bucket(this), source, from, now: new Date(at), meta: { commit: 'abc1234', branch: 'main', dirty: false } });
});

Then('the latest Lighthouse summary and its index entry should say source {string} and target {string}', function (source, target) {
  const s = stored(this, 'lighthouse-results/latest.json');
  const [entry] = stored(this, 'lighthouse-results/index.json').runs;
  const summary = stored(this, `lighthouse-results/runs/${entry.runId}/summary.json`);
  for (const run of [s, entry, summary]) assert.deepEqual([run.source, run.target], [source, target]);
});

When('the run is stored without a source or target, as before', async function () {
  const strip = (run) => ({ ...run, source: run.runId.endsWith('-ci') ? 'ci' : 'local', target: undefined });
  const index = stored(this, 'lighthouse-results/index.json');
  const { putJson } = results;
  for (const entry of index.runs) await putJson(bucket(this), `lighthouse-results/runs/${entry.runId}/summary.json`, strip(stored(this, `lighthouse-results/runs/${entry.runId}/summary.json`)));
  await putJson(bucket(this), 'lighthouse-results/latest.json', strip(stored(this, 'lighthouse-results/latest.json')));
  await putJson(bucket(this), 'lighthouse-results/index.json', { ...index, runs: index.runs.map(strip) });
});

When('I label the stored Lighthouse runs', async function () {
  await results.labelStoredRuns({ storage: bucket(this), prefix: 'lighthouse-results/' });
});

Then('the Lighthouse workflow should take a {string} input when started by hand, and publish with RESULTS_FROM set to it', function (name) {
  const wf = workflow();
  assert.equal(wf.on.workflow_dispatch.inputs[name].required, false);
  const step = wf.jobs.lighthouse.steps.find((s) => s.run === 'npm run test:lighthouse:record');
  assert.equal(step.env.RESULTS_FROM, `\${{ inputs.${name} }}`);
});

When('the local results service at {string} is asked to measure production on the branch {string}', async function (host, ref) {
  const inputs = (state(this).lighthouseInputs = []);
  const lighthouse = {
    start: async (_ref, given = {}) => {
      inputs.push(given);
      return { id: '9000', url: 'https://github.com/o/r/actions/runs/9000' };
    },
    find: async () => null,
    status: async () => ({ status: 'queued', conclusion: '' }),
    outcome: async () => ({ runId: null, summary: null }),
  };
  const branches = { list: async () => ['main'], current: async () => 'main' };
  const handle = resultsForm.createResultsFormHandler({ storage: bucket(this), lighthouse, branches, lighthouseStateFile: null, ciStateFile: null, localStateFile: null });
  const response = await handle(new Request(`http://${host}/__results/lighthouse/run`, { method: 'POST', headers: { Origin: `http://${host}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref }) }));
  assert.equal(response.status, 202, await response.text());
});

Then('GitHub should have been asked to start the Lighthouse run with the input source {string}', function (host) {
  assert.deepEqual(state(this).lighthouseInputs, [{ source: host }]);
});
