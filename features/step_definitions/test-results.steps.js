import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';
import { ROOT } from '../support/lib.js';
import { createMemoryBucket } from '../support/memory-storage.js';

const lib = await import(join(ROOT, 'scripts/lib/results.mjs'));
const cli = await import(join(ROOT, 'scripts/lib/results-cli.mjs'));
const runner = await import(join(ROOT, 'scripts/lib/test-runner.mjs'));

const state = (world) => world.data.results;

After(function () {
  if (state(this)?.dir) rmSync(state(this).dir, { recursive: true, force: true });
});

// --- A real Cucumber run of the fixture suite (done once, reused) ------------------------------------

let fixtureRun;
function realFixtureRun() {
  if (!fixtureRun) {
    const dir = mkdtempSync(join(tmpdir(), 'mini-run-'));
    spawnSync(process.execPath, [join(ROOT, 'node_modules/@cucumber/cucumber/bin/cucumber.js'), '--config', 'test-fixtures/mini/cucumber.mjs', '--format', `json:${dir}/mini.json`, '--format', `html:${dir}/mini.html`], { cwd: ROOT, encoding: 'utf-8' });
    fixtureRun = { json: readFileSync(join(dir, 'mini.json')), html: readFileSync(join(dir, 'mini.html')), report: JSON.parse(readFileSync(join(dir, 'mini.json'), 'utf-8')) };
    rmSync(dir, { recursive: true, force: true });
  }
  return fixtureRun;
}

Given('a fake test-results bucket', function () {
  this.data.results = { bucket: createMemoryBucket(), dir: mkdtempSync(join(tmpdir(), 'results-dir-')), error: null };
});

const put = (world, name, body) => {
  const file = join(state(world).dir, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
};

Given('the JSON report of a real run of the fixture suite', function () {
  state(this).report = realFixtureRun().report;
  state(this).summary = lib.summarizeCucumber(state(this).report);
});

Given('a results folder holding the offline and browser reports of a real run', function () {
  const { json, html } = realFixtureRun();
  for (const suite of ['offline', 'browser']) {
    put(this, `${suite}.json`, json);
    put(this, `${suite}.html`, html);
  }
});

/** A Cucumber report where every scenario passes. */
const passingReport = (scenarios) => [{ uri: 'features/example.feature', name: 'Example', elements: Array.from({ length: scenarios }, (_, i) => ({ type: 'scenario', name: `Scenario ${i + 1}`, steps: [{ keyword: 'Given ', name: 'a step', result: { status: 'passed', duration: 2_000_000 } }] })) }];

Given('a results folder with one report of 3 passing scenarios and 1 skipped', function () {
  const report = passingReport(3);
  report[0].elements.push({ type: 'scenario', name: 'Skipped one', steps: [{ keyword: 'Given ', name: 'a step', result: { status: 'skipped', duration: 0 } }] });
  put(this, 'offline.json', JSON.stringify(report));
});

Then('the summary should list {string} as neither passed nor failed', function (name) {
  const { summary, report } = { summary: state(this).summary, report: state(this).report };
  assert.ok(!summary.failures.some((f) => f.scenario === name), 'a skipped scenario is not a failure');
  const element = report.flatMap((f) => f.elements).find((e) => e.name === name);
  assert.ok(element.steps.every((s) => s.result.status === 'skipped'), 'the fixture scenario should be entirely skipped');
  assert.equal(summary.skipped, 1);
  assert.equal(summary.passed + summary.failed + summary.skipped, summary.scenarios);
});

Then('the newest index entry should be marked as not ok', function () {
  assert.equal(json(this, 'results/index.json').runs[0].ok, false);
});

Given('a results folder with one passing offline report', function () {
  put(this, 'offline.json', JSON.stringify(passingReport(4)));
});

const smokeReport = (count, failing, detail) => ({
  baseUrl: 'https://example.test',
  checkedAt: '2026-09-21T04:30:12Z',
  ok: false,
  checks: Array.from({ length: count }, (_, i) => (i === 0 ? { name: failing, ok: false, detail } : { name: `check ${i}`, ok: true, detail: '' })),
});

Given(/^a smoke result of (\d+) checks where "([^"]+)" failed with "([^"]+)"$/, function (count, name, detail) {
  state(this).smoke = smokeReport(Number(count), name, detail);
});

Given(/^a results folder with only a smoke result of (\d+) checks where "([^"]+)" failed with "([^"]+)"$/, function (count, name, detail) {
  put(this, 'smoke.json', JSON.stringify(smokeReport(Number(count), name, detail)));
});

Given('failure artifacts for the scenario {string} in the results folder', function (name) {
  put(this, `artifacts/browser/${name}.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  put(this, `artifacts/browser/${name}.zip`, Buffer.from('PK'));
  put(this, `artifacts/browser/${name}.txt`, 'Scenario: fails\n');
});

Given('the bucket refuses to store anything matching {string}', function (fragment) {
  state(this).bucket.faults.failPutMatching = fragment;
});

Given('a results folder that is empty', function () {});

Given('a results folder whose offline.json is not valid JSON', function () {
  put(this, 'offline.json', '{"truncated": [');
});

// --- Summaries ---------------------------------------------------------------------------------------------

Then('the summary should count {int} scenarios: {int} passed, {int} failed and {int} skipped', function (total, passed, failed, skipped) {
  const s = state(this).summary;
  assert.deepEqual([s.scenarios, s.passed, s.failed, s.skipped], [total, passed, failed, skipped]);
});

Then('the summary should count {int} steps: {int} passed, {int} failed and {int} skipped', function (total, passed, failed, skipped) {
  const { steps } = state(this).summary;
  assert.deepEqual([steps.total, steps.passed, steps.failed, steps.skipped], [total, passed, failed, skipped]);
});

Then('the summary should list the feature {string} with {int} scenarios and {int} failures', function (name, scenarios, failed) {
  const feature = state(this).summary.features.find((f) => f.name === name);
  assert.deepEqual([feature?.scenarios, feature?.failed], [scenarios, failed]);
});

Then('the summary should list these failures:', function (table) {
  const { failures } = state(this).summary;
  assert.equal(failures.length, table.hashes().length);
  for (const row of table.hashes()) {
    const failure = failures.find((f) => f.scenario === row.scenario);
    assert.ok(failure, `no failure for ${row.scenario}`);
    assert.ok(failure.step.includes(row['step contains']), failure.step);
    assert.ok(failure.message.includes(row['message contains']), failure.message);
  }
});

Then('the summary should list at most {int} slowest scenarios, in descending order of time', function (max) {
  const { slowest } = state(this).summary;
  assert.ok(slowest.length >= 1 && slowest.length <= max);
  assert.deepEqual(slowest.map((s) => s.ms), [...slowest.map((s) => s.ms)].sort((a, b) => b - a));
});

Then('the smoke summary should count {int} checks: {int} passed and {int} failed, naming that check and its detail', function (checks, passed, failed) {
  const summary = lib.summarizeSmoke(state(this).smoke);
  assert.deepEqual([summary.checks, summary.passed, summary.failed], [checks, passed, failed]);
  assert.deepEqual(summary.failures, [{ name: 'robots.txt points at the real sitemap', detail: 'sitemap host differs' }]);
});

Then(/^the run id for "([^"]+)", commit "([^"]+)", uncommitted changes "([^"]+)" and source "([^"]+)" should be "([^"]+)"$/, function (time, commit, dirty, source, id) {
  assert.equal(lib.makeRunId({ now: new Date(time), commit, dirty: dirty === 'yes', source }), id);
});

// --- Publishing ----------------------------------------------------------------------------------------------

async function publish(world, time, commit, source, retain) {
  return lib.publishResults({ dir: state(world).dir, storage: state(world).bucket, source, meta: { commit, branch: 'main', dirty: false }, now: new Date(time), ...(retain ? { retain } : {}) });
}

When(/^I publish the results at "([^"]+)" from commit "([^"]+)" as "([^"]+)"$/, async function (time, commit, source) {
  state(this).last = await publish(this, time, commit, source);
});

When(/^I publish the results at "([^"]+)" from commit "([^"]+)" as "([^"]+)" keeping only (\d+) runs$/, async function (time, commit, source, retain) {
  state(this).last = await publish(this, time, commit, source, Number(retain));
});

When(/^I try to publish the results at "([^"]+)" from commit "([^"]+)" as "([^"]+)"$/, async function (time, commit, source) {
  try {
    state(this).last = await publish(this, time, commit, source);
    state(this).error = null;
  } catch (error) {
    state(this).error = error;
  }
});

const objects = (world) => state(world).bucket.objects;
const json = (world, key) => JSON.parse(objects(world).get(key).body.toString('utf-8'));

Then('the bucket should hold these objects:', function (table) {
  for (const [key] of table.raw()) assert.ok(objects(this).has(key), `missing ${key}; have ${[...objects(this).keys()].join(', ')}`);
});

Then('every object in the bucket should be under the {string} prefix', function (prefix) {
  const outside = [...objects(this).keys()].filter((k) => !k.startsWith(prefix) || k.includes('..'));
  assert.deepEqual(outside, []);
});

Then('the objects should have these content types:', function (table) {
  for (const [name, type] of table.raw()) {
    const key = [...objects(this).keys()].find((k) => basename(k) === name);
    assert.ok(key, `no object named ${name}`);
    assert.equal(objects(this).get(key).contentType, type, name);
  }
});

Then('no object should be cached, so the newest results are always the ones read', function () {
  for (const [key, object] of objects(this)) assert.equal(object.cacheControl, 'no-store', key);
});

Then(/^the run's summary should say: commit "([^"]+)", source "([^"]+)", ok "(yes|no)", (\d+) scenarios with (\d+) failed$/, function (commit, source, ok, scenarios, failed) {
  const summary = json(this, 'results/latest.json');
  assert.deepEqual([summary.commit, summary.source, summary.ok, summary.totals.scenarios, summary.totals.failed], [commit, source, ok === 'yes', Number(scenarios), Number(failed)]);
});

Then("the run's summary should list every file it uploaded", function () {
  const summary = json(this, 'results/latest.json');
  const prefix = `results/runs/${summary.runId}/`;
  const actual = [...objects(this).keys()].filter((k) => k.startsWith(prefix)).sort();
  assert.deepEqual([...summary.files].sort(), actual);
});

Then('latest.json should be identical to that summary', function () {
  const latest = json(this, 'results/latest.json');
  assert.deepEqual(json(this, `results/runs/${latest.runId}/summary.json`), latest);
});

Then('the index should list these runs, newest first:', function (table) {
  assert.deepEqual(json(this, 'results/index.json').runs.map((r) => r.runId), table.raw().map(([id]) => id));
});

Then('the newest index entry should show {int} scenarios, {int} failed, and {int} named failures', function (scenarios, failed, named) {
  const [entry] = json(this, 'results/index.json').runs;
  assert.deepEqual([entry.totals.scenarios, entry.totals.failed, entry.failures.length], [scenarios, failed, named]);
  for (const failure of entry.failures) assert.ok(failure.suite && failure.name);
});

Then('the attempt should fail naming {string}', function (name) {
  assert.ok(state(this).error, 'expected the publish to fail');
  assert.ok(state(this).error.message.includes(name), state(this).error.message);
});

Then('the attempt should fail saying {string}', function (message) {
  assert.ok(state(this).error, 'expected the publish to fail');
  assert.ok(state(this).error.message.includes(message), state(this).error.message);
});

Then('the bucket should not hold a results index or a latest pointer', function () {
  assert.ok(!objects(this).has('results/index.json') && !objects(this).has('results/latest.json'));
});

Then('the bucket should hold no objects', function () {
  assert.equal(objects(this).size, 0);
});

Then('no object of the run {string} should remain in the bucket', function (id) {
  assert.deepEqual([...objects(this).keys()].filter((k) => k.includes(`/runs/${id}/`)), []);
});

Then('every object of the run {string} should still be in the bucket', function (id) {
  const entry = json(this, 'results/index.json').runs.find((r) => r.runId === id);
  assert.ok(entry?.files.length >= 5);
  for (const key of entry.files) assert.ok(objects(this).has(key), key);
});

// --- Trends -----------------------------------------------------------------------------------------------------

Given('these runs, oldest first, where {string} and {string} fail as shown:', function (a, b, table) {
  const rows = table.hashes();
  const runs = rows.map((row, i) => ({
    runId: `run-${row.run}`, startedAt: `2026-09-2${i + 1}T00:00:00Z`, source: 'local', commit: 'abc', branch: 'main', dirty: false, ok: false, totals: { scenarios: 2, passed: 1, failed: 1, skipped: 0 }, files: [],
    failures: [a, b].filter((name) => row[name] === 'fail').map((name) => ({ suite: 'offline', name, feature: 'x.feature' })),
  }));
  put(this, 'unused.txt', '');
  objects(this).set('results/index.json', { body: Buffer.from(JSON.stringify({ updatedAt: null, runs: runs.reverse() })), contentType: 'application/json', cacheControl: 'no-store' });
});

When('I look at the trend over the last {int} runs', async function (window) {
  state(this).trend = await lib.trend({ storage: state(this).bucket, window });
});

Then(/^the trend should say "([^"]+)" failed in (\d+) of (\d+) runs, is (failing|passing) now and is (not )?flaky$/, function (name, failed, of, now, notFlaky) {
  const entry = state(this).trend.scenarios.find((s) => s.name === `offline: ${name}`);
  assert.ok(entry, `${name} is not in the trend`);
  assert.deepEqual([entry.failedRuns, state(this).trend.runs, entry.failingNow, entry.flaky], [Number(failed), Number(of), now === 'failing', !notFlaky]);
});

Then('the trend should list no failures', function () {
  assert.deepEqual(state(this).trend.scenarios, []);
});

// --- Command line ---------------------------------------------------------------------------------------------------

async function runCommand(world, line, dir = state(world).dir) {
  const out = [];
  const err = [];
  const code = await cli.run(line.split(/\s+/), {
    dir, storage: state(world).bucket, log: (t) => out.push(t), error: (t) => err.push(t),
    meta: { commit: 'e786ff8', branch: 'main', dirty: false }, now: new Date('2026-09-21T04:30:12Z'),
  });
  state(world).command = { code, out: out.join('\n'), err: err.join('\n') };
}

When('I run the results command {string}', async function (line) {
  await runCommand(this, line);
});

When('I run the results command {string} with no results folder', async function (line) {
  await runCommand(this, line, join(state(this).dir, 'does-not-exist'));
});

Then('the command should succeed and say {string}', function (fragment) {
  const { code, out, err } = state(this).command;
  assert.equal(code, 0, err);
  assert.ok(out.includes(fragment), `output does not say "${fragment}":\n${out}`);
});

Then('the command should fail saying {string}', function (fragment) {
  const { code, out, err } = state(this).command;
  assert.equal(code, 1);
  assert.ok((err + out).includes(fragment), `neither output says "${fragment}":\n${err}\n${out}`);
});

Then('the results output should mention {string}', function (fragment) {
  assert.ok(state(this).command.out.includes(fragment), state(this).command.out);
});

// --- Runner and configuration -------------------------------------------------------------------------------------------

Then(/^planning a test run with arguments "([^"]*)" should run "([^"]+)" and publish "(yes|no)"$/, function (argv, suites, publish) {
  const plan = runner.planRun(argv.split(/\s+/).filter(Boolean), '/r');
  assert.deepEqual(plan.suites.map((s) => s.name), suites.split(','));
  assert.equal(plan.publish, publish === 'yes');
});

Then(/^every planned suite should write "<name>\.json" and "<name>\.html" into the results folder$/, function () {
  for (const suite of runner.planRun([], '/r').suites) {
    const formats = suite.args.filter((_, i) => suite.args[i - 1] === '--format');
    assert.ok(formats.includes(`json:/r/${suite.name}.json`), suite.name);
    assert.ok(formats.includes(`html:/r/${suite.name}.html`), suite.name);
  }
});

Then('planning a test run with the suite {string} should fail saying {string}', function (suite, message) {
  assert.throws(() => runner.planRun(['--suite', suite], '/r'), new RegExp(message));
});

Then('the results bucket should be {string} with the prefix {string}', function (bucket, prefix) {
  assert.equal(lib.RESULTS_BUCKET, bucket);
  assert.equal(lib.RESULTS_PREFIX, prefix);
});

Then('it should not be either of the photo buckets', async function () {
  const { PHOTO_BUCKETS } = await import(join(ROOT, 'src/config/photos.ts'));
  assert.ok(!Object.values(PHOTO_BUCKETS).includes(lib.RESULTS_BUCKET), 'results must never be mixed into a photo bucket');
});

Then('the test-results folder should be ignored by git', function () {
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf-8'), /^test-results\/$/m);
});

Then('no page, header or site code should reference the results bucket, so it stays private', function () {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (readFileSync(full, 'utf-8').includes(lib.RESULTS_BUCKET)) hits.push(full.replace(`${ROOT}/`, ''));
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'public'));
  assert.deepEqual(hits, []);
});

// --- Workflows ---------------------------------------------------------------------------------------------------------------

const workflow = (name) => yaml.load(readFileSync(join(ROOT, '.github/workflows', name), 'utf-8'));
const allSteps = (name) => Object.values(workflow(name).jobs).flatMap((job) => job.steps);
const publishStep = (name) => allSteps(name).find((s) => /results\.mjs publish|results:publish/.test(s.run ?? ''));

Then('the CI workflow should write JSON and HTML reports for both suites', function () {
  const runs = allSteps('ci.yml').map((s) => s.run ?? '').join('\n');
  for (const suite of ['offline', 'browser']) {
    assert.ok(runs.includes(`json:test-results/${suite}.json`) && runs.includes(`html:test-results/${suite}.html`), suite);
  }
});

function assertConditionalPublish(step, job) {
  assert.ok(step, 'no publish step');
  assert.match(step.if ?? '', /always\(\)/, 'must publish even after failures');
  assert.match(step.if, /CLOUDFLARE_API_TOKEN/, 'must skip when the token is not configured');
  const env = { ...job.env, ...step.env };
  assert.match(env.CLOUDFLARE_API_TOKEN, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(env.CLOUDFLARE_ACCOUNT_ID, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
}

Then('the CI workflow should publish the results, even after failures, only when the R2 secrets exist', function () {
  const job = workflow('ci.yml').jobs.test;
  assertConditionalPublish(job.steps.find((s) => /results\.mjs publish|results:publish/.test(s.run ?? '')), job);
  assert.match(publishStep('ci.yml').run, /--source ci|source ci/);
});

Then('the smoke workflow should save and publish its result only when the R2 secrets exist', function () {
  const job = workflow('smoke.yml').jobs.smoke;
  assert.match(job.steps.map((s) => s.run ?? '').join('\n'), /smoke\.mjs.*--out test-results\/smoke\.json/);
  assertConditionalPublish(job.steps.find((s) => /results\.mjs publish|results:publish/.test(s.run ?? '')), job);
});

// --- The real R2 adapter (wrangler's actual output, with colour codes, ERROR on stderr) ----------------------------

const r2 = await import(join(ROOT, 'scripts/lib/r2-storage.mjs'));

const STDOUT = ' \u001b[1m⛅️ wrangler 4.134.0\u001b[0m\n────────\nResource location: remote \n\nDownloading "results/index.json" from "photography-site-test".\n';
const SAMPLES = {
  'a missing object': { stderr: '\u001b[31m✘ \u001b[41;31m[\u001b[41;97mERROR\u001b[41;31m]\u001b[0m \u001b[1mThe specified key does not exist.\u001b[0m\n\n\n🪵  Logs were written to "/tmp/w.log"\n', stdout: STDOUT },
  'an authentication failure': { stderr: '\u001b[31m✘ [ERROR]\u001b[0m A request to the Cloudflare API failed.\n  Authentication error [code: 10000]\n', stdout: STDOUT },
  'an unreachable network': { stderr: '\u001b[31m✘ [ERROR]\u001b[0m fetch failed\n', stdout: STDOUT },
};

Given(/^wrangler failed with the real output for (a missing object|an authentication failure|an unreachable network)$/, function (problem) {
  const { detail, output } = r2.describeWranglerFailure(SAMPLES[problem]);
  this.data.wranglerFailure = { detail, output, message: `wrangler r2 object get failed:\n${detail}` };
});

Then('the failure should be recognised as a missing object', function () {
  assert.equal(r2.isMissingObjectError(this.data.wranglerFailure), true);
});

Then('the failure should not be recognised as a missing object', function () {
  assert.equal(r2.isMissingObjectError(this.data.wranglerFailure), false);
});

Then(/^the failure's reason should be "([^"]+)"$/, function (reason) {
  assert.ok(this.data.wranglerFailure.detail.includes(reason), this.data.wranglerFailure.detail);
  assert.ok(!this.data.wranglerFailure.detail.includes('Downloading'), 'the reason must be the ERROR, not the progress lines');
});

Then(/^the failure's reason should mention "([^"]+)"$/, function (fragment) {
  assert.ok(this.data.wranglerFailure.detail.includes(fragment), this.data.wranglerFailure.detail);
});
