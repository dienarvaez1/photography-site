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
 * The scenario's service: this bucket, and a stand-in for running Lighthouse that records each start and lets the
 * scenario print lines and end it. Kept for the scenario, so a measurement it starts can be asked about afterwards.
 */
function service(world) {
  const s = state(world);
  if (!s.service) {
    s.measured = [];
    const measure = (run) => s.measured.push(run);
    s.service = resultsForm.createResultsFormHandler({ storage: bucket(world), measure });
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

Then('the latest Lighthouse summary should be the newest run left', function () {
  assert.equal(stored(this, 'lighthouse-results/latest.json').runId, state(this).lighthouseRuns.at(-2).runId);
});

Then("the removed Lighthouse run's files should be gone from the bucket", function () {
  const { runId } = state(this).removedLighthouse;
  assert.deepEqual(keys(this).filter((k) => k.includes(runId)), []);
});

When('the local results service is asked to run Lighthouse in production', async function () {
  await ask(this, 'POST', '/__results/lighthouse/run');
});

When('another site asks the local results service to run Lighthouse in production', async function () {
  await ask(this, 'POST', '/__results/lighthouse/run', { origin: 'https://evil.example' });
});

When('the service is asked how the measurement is going', async function () {
  await ask(this, 'GET', '/__results/lighthouse/run');
});

When('the measurement ends with exit code {int} after printing {string}', function (code, line) {
  const run = state(this).measured.at(-1);
  run.onOutput('=== publishing ===');
  run.onOutput(line);
  run.onExit(code);
});

When("the measurement can't start because {string}", function (message) {
  state(this).measured.at(-1).onExit(null, new Error(message));
});

Then('the service should answer 202 with a measurement of the production site that is still running', function () {
  const { status, body } = state(this).answer;
  assert.equal(status, 202);
  assert.equal(body.run.target, resultsForm.PRODUCTION_URL);
  assert.equal(body.run.finishedAt, null);
  assert.ok(!Number.isNaN(Date.parse(body.run.startedAt)));
});

Then('Lighthouse should have been started once, against the production site', function () {
  assert.deepEqual(state(this).measured.map((run) => run.target), [resultsForm.PRODUCTION_URL]);
});

Then('Lighthouse should not have been started', function () {
  assert.deepEqual(state(this).measured ?? [], []);
});

Then('it should say the measurement is still running', function () {
  const { status, body } = state(this).answer;
  assert.equal(status, 200);
  assert.equal(body.run.finishedAt, null);
  assert.equal(body.run.ok, null);
});

Then(/^it should say the measurement ended (ok|not ok), with "([^"]+)" as its last line$/, function (how, line) {
  const { run } = state(this).answer.body;
  assert.ok(run.finishedAt);
  assert.equal(run.ok, how === 'ok');
  assert.equal(run.log.at(-1), line);
});

Then('it should say the measurement ended not ok, with the error {string}', function (message) {
  const { run } = state(this).answer.body;
  assert.ok(run.finishedAt);
  assert.equal(run.ok, false);
  assert.equal(run.error, message);
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

Then('it should run {string} with LIGHTHOUSE_URL set to that address and its own results folder', function (script) {
  const source = readFileSync(join(ROOT, 'scripts/lib/results-form.mjs'), 'utf-8');
  assert.ok(source.includes(`join(ROOT, '${script}')`));
  assert.match(source, /LIGHTHOUSE_URL: target, TEST_RESULTS_DIR: join\(ROOT, 'test-results', 'on-demand'\)/);
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
