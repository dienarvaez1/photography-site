import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';
import { asR2Binding } from '../support/r2-binding.js';
import { createMemoryBucket } from '../support/memory-storage.js';
import { fakeResult, writeRunFolder } from '../support/lighthouse-fixtures.js';

const { handle } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));
const { publishLighthouse } = await import(join(ROOT, 'scripts/lib/lighthouse-results.mjs'));

const API = 'https://api.test';
const NOW = Date.parse('2026-09-29T12:00:00Z');
const state = (world) => world.data.lighthouseApi;

async function publishAll(world, rows) {
  const bucket = createMemoryBucket();
  const runIds = [];
  for (const row of rows) {
    const dir = mkdtempSync(join(tmpdir(), 'lh-run-'));
    writeRunFolder(dir, [
      fakeResult('/', 'mobile', { performance: Number(row['phone performance']) / 100, lcp: 2000 }),
      fakeResult('/', 'desktop', { performance: Number(row['laptop performance']) / 100, lcp: 900 }),
    ]);
    const { runId } = await publishLighthouse({ dir, storage: bucket, now: new Date(row.time), meta: { commit: row.commit, branch: 'main', dirty: false } });
    runIds.unshift(runId); // newest first
    rmSync(dir, { recursive: true, force: true });
  }
  const asked = [];
  const binding = asR2Binding(bucket);
  Object.assign(state(world), { bucket, runIds, asked, env: { ...state(world).env, RESULTS: { get: (key) => (asked.push(key), binding.get(key)) } } });
}

Given('a results API with the admin token {string} and these Lighthouse runs:', async function (token, table) {
  this.data.lighthouseApi = { token, env: { ADMIN_TOKEN: token, ALLOWED_ORIGINS: 'https://site.test' }, now: NOW };
  await publishAll(this, table.hashes());
});

Given('no Lighthouse run has been published', async function () {
  await publishAll(this, []);
});

Given('the Lighthouse API has no admin token set', function () {
  const { ADMIN_TOKEN: _unset, ...env } = state(this).env;
  state(this).env = env;
});

async function call(world, url, { headers = {}, now } = {}) {
  const s = state(world);
  const response = await handle(new Request(url.startsWith('http') ? url : `${API}${url}`, { headers }), s.env, now ?? s.now);
  const text = Buffer.from(await response.arrayBuffer()).toString('utf-8');
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // a file
  }
  s.last = { status: response.status, headers: response.headers, text, body };
  return s.last;
}

const withToken = (world) => ({ Authorization: `Bearer ${state(world).token}` });

When(/^I call the Lighthouse route "([^"]*)" with (the admin token|no token|the token "[^"]*")$/, async function (route, how) {
  const given = /^the token "(.*)"$/.exec(how)?.[1];
  const headers = how === 'the admin token' ? withToken(this) : how === 'no token' ? {} : { Authorization: `Bearer ${given}` };
  await call(this, route, { headers });
});

When('I call the newest Lighthouse run with the admin token', async function () {
  await call(this, `/lighthouse/runs/${state(this).runIds[0]}`, { headers: withToken(this) });
});

async function linksOfNewest(world) {
  const answer = await call(world, `/lighthouse/runs/${state(world).runIds[0]}`, { headers: withToken(world) });
  assert.equal(answer.status, 200, answer.text);
  return answer.body.links;
}

When('I open the signed Lighthouse link for {string} of the newest run', async function (file) {
  const links = await linksOfNewest(this);
  assert.ok(links[file], `no link for ${file}: ${Object.keys(links)}`);
  await call(this, links[file]);
});

When(/^I open the signed Lighthouse link for "([^"]*)" of the newest run, but (.+)$/, async function (file, problem) {
  const link = new URL((await linksOfNewest(this))[file]);
  const runId = state(this).runIds[0];
  if (problem === 'an hour later') return call(this, link.href, { now: NOW + 3600_000 });
  if (problem === 'with a changed signature') link.searchParams.set('sig', link.searchParams.get('sig').replace(/^./, (c) => (c === 'a' ? 'b' : 'a')));
  if (problem === 'with the signature of a test-results link') {
    // What the test-results store signs for the same run id and path: valid there, never here.
    link.searchParams.set('sig', createHmac('sha256', state(this).token).update(`${runId}/${file}|${link.searchParams.get('exp')}`).digest('hex'));
  }
  return call(this, link.href);
});

When('I open a Lighthouse-signed link on the test results\' file route', async function () {
  const link = new URL((await linksOfNewest(this))['mobile-home.html']);
  link.pathname = link.pathname.replace('/lighthouse/files/', '/files/');
  await call(this, link.href);
});

When("I follow the index page's link to {string}", async function (file) {
  const href = [...state(this).last.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&')).find((h) => h.includes(`/${file}?`));
  assert.ok(href, `no link to ${file} on the index page`);
  await call(this, href);
});

Then(/^the Lighthouse response should be (\d+) and be exactly the stored "([^"]+)"$/, function (status, key) {
  assert.equal(state(this).last.status, Number(status), state(this).last.text);
  assert.equal(state(this).last.text, state(this).bucket.objects.get(key).body.toString('utf-8'));
});

Then('it should list the Lighthouse runs, newest first, for the commits {string}', function (commits) {
  assert.deepEqual(state(this).last.body.runs.map((r) => r.commit), commits.split(', '));
});

Then('the Lighthouse response should be {int} with the summary of commit {string}', function (status, commit) {
  assert.equal(state(this).last.status, status, state(this).last.text);
  assert.equal(state(this).last.body.summary.commit, commit);
});

Then(/^there should be a signed Lighthouse link for (.+), valid for (\d+) seconds$/, function (list, seconds) {
  const { links, linksExpireInSeconds } = state(this).last.body;
  const files = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(links).sort(), [...files].sort());
  for (const file of files) {
    const url = new URL(links[file]);
    assert.equal(url.origin, API);
    assert.equal(url.pathname, `/lighthouse/files/${state(this).runIds[0]}/${file}`);
    assert.equal(Number(url.searchParams.get('exp')), Math.floor(NOW / 1000) + Number(seconds));
    assert.match(url.searchParams.get('sig'), /^[0-9a-f]{64}$/);
  }
  assert.equal(linksExpireInSeconds, Number(seconds));
});

Then('the Lighthouse response should be {int} and list no runs', function (status) {
  assert.equal(state(this).last.status, status);
  assert.deepEqual(state(this).last.body, { updatedAt: null, runs: [] });
});

Then('the Lighthouse response should be {int} with the error {string}', function (status, error) {
  assert.equal(state(this).last.status, status, state(this).last.text);
  assert.equal(state(this).last.body?.error, error);
});

Then('the Lighthouse response should be {int} with the content type {string}', function (status, type) {
  assert.equal(state(this).last.status, status, state(this).last.text.slice(0, 200));
  assert.equal(state(this).last.headers.get('content-type'), type);
});

Then('it should be exactly the stored report, sandboxed and never cached', function () {
  const key = `lighthouse-results/runs/${state(this).runIds[0]}/mobile-home.html`;
  assert.equal(state(this).last.text, state(this).bucket.objects.get(key).body.toString('utf-8'));
  assert.equal(state(this).last.headers.get('content-security-policy'), 'sandbox allow-scripts');
  assert.equal(state(this).last.headers.get('cache-control'), 'private, no-store');
});

Then('every report link on the index page should be a signed Lighthouse link on the API\'s own address', function () {
  const reports = [...state(this).last.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /\.html/.test(h));
  assert.ok(reports.length >= 2, 'the index page links its reports');
  for (const href of reports) {
    const url = new URL(href.replaceAll('&amp;', '&'));
    assert.equal(url.origin, API);
    assert.match(url.pathname, new RegExp(`^/lighthouse/files/${state(this).runIds[0]}/(mobile|desktop)-[a-z0-9-]+\\.html$`));
    assert.match(url.searchParams.get('sig') ?? '', /^[0-9a-f]{64}$/);
  }
});

Then('the bucket should not have been asked for any Lighthouse run', function () {
  assert.deepEqual(state(this).asked, []);
});

Then('the bucket should not have been asked for anything outside {string} for Lighthouse', function (prefix) {
  assert.ok(state(this).asked.length > 0);
  assert.deepEqual(state(this).asked.filter((key) => !key.startsWith(prefix) || key.includes('..')), []);
});
