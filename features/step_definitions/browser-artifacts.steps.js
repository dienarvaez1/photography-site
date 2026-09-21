import { After, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';
import { createMemoryBucket } from '../support/memory-storage.js';

const lib = await import(join(ROOT, 'scripts/lib/results.mjs'));
const state = (world) => world.data.artifacts;

After({ tags: '@browser' }, function () {
  if (state(this)?.dir) rmSync(state(this).dir, { recursive: true, force: true });
});

When('the fixture browser suite runs with one failing and one passing scenario', function () {
  const dir = mkdtempSync(join(tmpdir(), 'artifacts-'));
  const run = spawnSync(process.execPath, [join(ROOT, 'node_modules/@cucumber/cucumber/bin/cucumber.js'), '--config', 'test-fixtures/browser-fail/cucumber.mjs', '--format', `json:${dir}/browser.json`], {
    cwd: ROOT, encoding: 'utf-8', env: { ...process.env, TEST_RESULTS_DIR: dir },
  });
  this.data.artifacts = { dir, run, folder: join(dir, 'artifacts', 'browser') };
});

Then('the run should fail because of the one scenario that fails on purpose', function () {
  const { run, dir } = state(this);
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(readFileSync(join(dir, 'browser.json'), 'utf-8'));
  const failing = report.flatMap((f) => f.elements).filter((e) => e.steps.some((s) => s.result.status === 'failed'));
  assert.deepEqual(failing.map((e) => e.name), ['Fails on purpose']);
});

const artifacts = (world) => (existsSync(state(world).folder) ? readdirSync(state(world).folder).sort() : []);

Then('the artifacts folder should hold exactly one screenshot, one trace and one notes file, all for {string}', function (slug) {
  const files = artifacts(this);
  assert.equal(files.length, 3, files.join(', '));
  assert.deepEqual(files.map((f) => f.split('.').pop()).sort(), ['png', 'txt', 'zip']);
  for (const file of files) assert.ok(file.startsWith(`${slug}-`), `${file} is for the wrong scenario (the passing one must leave nothing)`);
});

Then('the screenshot should be a real PNG image and the trace a real zip archive', function () {
  const read = (ext) => readFileSync(join(state(this).folder, artifacts(this).find((f) => f.endsWith(ext))));
  assert.deepEqual([...read('.png').subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(read('.png').length > 2000, 'the screenshot looks empty');
  assert.equal(read('.zip').subarray(0, 2).toString(), 'PK');
});

Then('the notes should name the scenario, the page, the status and the reason it failed, and how to open the trace', function () {
  const notes = readFileSync(join(state(this).folder, artifacts(this).find((f) => f.endsWith('.txt'))), 'utf-8');
  for (const expected of ['Scenario: Fails on purpose', 'Status: FAILED', 'failing on purpose to produce artifacts', 'Page: http://127.0.0.1:', 'npx playwright show-trace']) {
    assert.ok(notes.includes(expected), `notes are missing "${expected}":\n${notes}`);
  }
});

When('the results are published to a fake results bucket', async function () {
  const bucket = createMemoryBucket();
  const { dir } = state(this);
  writeFileSync(join(dir, 'offline.json'), '[]'); // any suite report will do: the artifacts are what is being checked
  state(this).bucket = bucket;
  state(this).published = await lib.publishResults({ dir, storage: bucket, source: 'local', meta: { commit: 'e786ff8', branch: 'main', dirty: false }, now: new Date('2026-09-21T04:30:12Z') });
});

Then(`the bucket should hold the screenshot, trace and notes under the run's {string} folder`, function (folder) {
  const prefix = `results/runs/${state(this).published.runId}/${folder}`;
  const keys = [...state(this).bucket.objects.keys()].filter((k) => k.startsWith(prefix));
  assert.deepEqual(keys.map((k) => k.split('.').pop()).sort(), ['png', 'txt', 'zip']);
  const types = Object.fromEntries(keys.map((k) => [k.split('.').pop(), state(this).bucket.objects.get(k).contentType]));
  assert.deepEqual(types, { png: 'image/png', txt: 'text/plain; charset=utf-8', zip: 'application/zip' });
});

Then("the run's summary should list them among its files", function () {
  const { published } = state(this);
  assert.equal(published.summary.files.filter((f) => f.includes('/artifacts/browser/')).length, 3);
});
