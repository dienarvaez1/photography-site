import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
