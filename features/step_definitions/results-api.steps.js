import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { ROOT } from '../support/lib.js';
import { asR2Binding } from '../support/r2-binding.js';
import { publishRuns, runsFromRows } from '../support/results-fixtures.js';

const { handle } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));
const { RESULTS_API_ALLOWED_ORIGINS } = await import(join(ROOT, 'src/config/results.ts'));

const API = 'https://api.test';
const NOW = Date.parse('2026-09-21T12:00:00Z');
const ORIGINS = 'https://site.test,http://localhost:4321';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const state = (world) => world.data.api;

async function useBucket(world, runs) {
  const { bucket, runIds } = await publishRuns(runs);
  const asked = [];
  const binding = asR2Binding(bucket);
  const spy = { get: (key) => (asked.push(key), binding.get(key)) };
  Object.assign(state(world), { bucket, runIds, asked, env: { ...state(world).env, RESULTS: spy } });
}

Given('a results API with the admin token {string} and these published runs:', async function (token, table) {
  this.data.api = { token, env: { ADMIN_TOKEN: token, ALLOWED_ORIGINS: ORIGINS }, now: NOW, responses: [], links: {} };
  const runs = runsFromRows(table.hashes());
  await useBucket(this, runs);
});

Given('a bucket with no published runs', async function () {
  await useBucket(this, []);
});

Given(/^the admin token is (not set|".*")$/, function (value) {
  const env = { ...state(this).env };
  if (value === 'not set') delete env.ADMIN_TOKEN;
  else env.ADMIN_TOKEN = value.slice(1, -1);
  state(this).env = env;
});

When('the admin token is changed to {string}', function (token) {
  state(this).env = { ...state(this).env, ADMIN_TOKEN: token };
});

// --- The real Workers runtime ----------------------------------------------------------------------------------

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

After(function () {
  const runtime = state(this)?.runtime;
  if (!runtime) return;
  runtime.child.kill('SIGTERM');
  rmSync(runtime.dir, { recursive: true, force: true });
});

Given('the same runs are stored in a local R2 bucket and the Worker runs in the real Workers runtime', { timeout: 120_000 }, async function () {
  const s = state(this);
  const dir = mkdtempSync(join(tmpdir(), 'results-workerd-'));
  // Seed a local R2 bucket (the same simulation `wrangler dev` uses) with everything the publisher stored.
  const proxy = await getPlatformProxy({ configPath: join(ROOT, 'workers/results-api/wrangler.jsonc'), persist: { path: join(dir, 'v3') } });
  for (const [key, object] of s.bucket.objects) await proxy.env.RESULTS.put(key, object.body);
  await proxy.dispose();

  const port = await freePort();
  const args = ['dev', '-c', join(ROOT, 'workers/results-api/wrangler.jsonc'), '--local', '--persist-to', dir, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(await freePort()), '--var', `ADMIN_TOKEN:${s.token}`, '--var', `ALLOWED_ORIGINS:${ORIGINS}`];
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], { stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  s.runtime = { child, dir, base: `http://127.0.0.1:${port}` };
  let up = false;
  for (let i = 0; i < 200 && !up; i++) {
    up = await fetch(`${s.runtime.base}/health`).then((r) => r.ok, () => false);
    if (!up) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(up, 'the Worker did not start in the local Workers runtime');
});

// --- Making calls ------------------------------------------------------------------------------------

/** Calls the real handler and records everything about the answer. */
async function call(world, url, { method = 'GET', headers = {}, now } = {}) {
  const s = state(world);
  // Either the handler in this process, or (when set up) the same code running in the real Workers runtime.
  const target = url.startsWith('http') ? url : `${s.runtime?.base ?? API}${url}`;
  const response = s.runtime ? await fetch(target, { method, headers }) : await handle(new Request(target, { method, headers }), s.env, now ?? s.now);
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf-8');
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON (a file)
  }
  s.last = { status: response.status, headers: response.headers, bytes, text, body, origin: headers.Origin };
  s.responses.push(s.last);
  return s.last;
}

/** "with the token "x"", "with no token", ... optionally followed by ", from the origin "o"". */
function requestHeaders(world, how) {
  const [, kind, origin] = /^(.*?)(?:, from the origin "([^"]*)")?$/.exec(how);
  const headers = {};
  if (kind === 'with the admin token') headers.Authorization = `Bearer ${state(world).token}`;
  else if (kind === 'with a Basic authorization header') headers.Authorization = 'Basic dXNlcjpwYXNz';
  else if (kind !== 'with no token') headers.Authorization = `Bearer ${/^with the token "(.*)"$/.exec(kind)[1]}`;
  if (origin) headers.Origin = origin;
  return headers;
}

When(/^I call "([^"]*)" (with .+)$/, async function (path, how) {
  await call(this, path, { headers: requestHeaders(this, how) });
});

When('I call the newest run with the admin token', async function () {
  await call(this, `/runs/${state(this).runIds[0]}`, { headers: { Authorization: `Bearer ${state(this).token}` } });
});

When(/^I send a "(\w+)" request to "([^"]*)" with the admin token$/, async function (method, path) {
  await call(this, path, { method, headers: { Authorization: `Bearer ${state(this).token}` } });
});

When('I send a preflight request for {string} from the origin {string}', async function (path, origin) {
  await call(this, path, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
});

When('I call the file route with the raw path {string} and no signature', async function (path) {
  await call(this, path);
});

// --- Signed links --------------------------------------------------------------------------------------

/** The links the run endpoint hands out for the newest run. */
async function linksOfNewestRun(world) {
  const answer = await call(world, `/runs/${state(world).runIds[0]}`, { headers: { Authorization: `Bearer ${state(world).token}` } });
  assert.equal(answer.status, 200, answer.text);
  return answer.body.links;
}

const runKey = (world, file) => `results/runs/${state(world).runIds[0]}/${file}`;

When('I open the signed link for {string} of the newest run', async function (file) {
  const links = await linksOfNewestRun(this);
  assert.ok(links[file], `no signed link for ${file} (have: ${Object.keys(links).join(', ')})`);
  state(this).file = file;
  await call(this, links[file]);
});

const tamper = {
  'but with its signature changed': (url) => {
    url.searchParams.set('sig', url.searchParams.get('sig').replace(/.$/, (c) => (c === '0' ? '1' : '0')));
  },
  'but with its signature removed': (url) => url.searchParams.delete('sig'),
  'but pointed at a different file': (url) => {
    url.pathname = url.pathname.replace('offline.html', 'offline.json');
  },
  'but pointed at a different run': (world) => (url) => {
    url.pathname = url.pathname.replace(state(world).runIds[0], state(world).runIds[1]);
  },
  'but with its expiry moved a day later': (url) => url.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 86400)),
};

When(/^I open the signed link for "([^"]*)" of the newest run, (but .+)$/, async function (file, problem) {
  const links = await linksOfNewestRun(this);
  const url = new URL(links[file]);
  if (problem === 'but opened after it expired') {
    await call(this, url.toString(), { now: state(this).now + 901 * 1000 });
    return;
  }
  const change = tamper[problem];
  assert.ok(change, `unknown problem: ${problem}`);
  (problem === 'but pointed at a different run' ? change(this) : change)(url);
  await call(this, url.toString());
});

When('I remember the signed link for {string} of the newest run', async function (file) {
  state(this).remembered = (await linksOfNewestRun(this))[file];
  assert.ok(state(this).remembered);
});

When('I open the remembered link', async function () {
  await call(this, state(this).remembered);
});

When('I open a correctly signed link for the file {string} of the newest run', async function (file) {
  const exp = Math.floor(state(this).now / 1000) + 600;
  const sig = createHmac('sha256', state(this).token).update(`${state(this).runIds[0]}/${file}|${exp}`).digest('hex');
  await call(this, `/files/${state(this).runIds[0]}/${file}?exp=${exp}&sig=${sig}`);
});

When(/^I open a file link for "([^"]*)" of the newest run, signed with the token "([^"]*)"$/, async function (file, token) {
  const exp = Math.floor(state(this).now / 1000) + 600;
  const sig = createHmac('sha256', token).update(`${state(this).runIds[0]}/${file}|${exp}`).digest('hex');
  await call(this, `/files/${state(this).runIds[0]}/${file}?exp=${exp}&sig=${sig}`);
});

Given('the newest run\'s summary also lists these files: {string}', function (names) {
  const key = runKey(this, 'summary.json');
  const object = state(this).bucket.objects.get(key);
  const summary = JSON.parse(object.body.toString('utf-8'));
  state(this).ordinary = [...summary.files];
  state(this).odd = names.split(', ').map((name) => `results/runs/${state(this).runIds[0]}/${name}`);
  summary.files.push(...state(this).odd);
  object.body = Buffer.from(JSON.stringify(summary));
});

Then('the links should not include any of those files', function () {
  const { links } = state(this).last.body;
  const prefix = `results/runs/${state(this).runIds[0]}/`;
  for (const key of state(this).odd) assert.ok(!(key.slice(prefix.length) in links), `link for ${key}`);
});

Then("there should be a signed link for each of the run's ordinary files", function () {
  const { links } = state(this).last.body;
  const prefix = `results/runs/${state(this).runIds[0]}/`;
  assert.deepEqual(Object.keys(links).sort(), state(this).ordinary.map((key) => key.slice(prefix.length)).sort());
});

// --- Checking answers --------------------------------------------------------------------------------------

Then('the response should be {int}', function (status) {
  assert.equal(state(this).last.status, status, state(this).last.text);
});

Then('the response should be {int} and say configured {string}', function (status, configured) {
  assert.equal(state(this).last.status, status);
  assert.equal(state(this).last.body.configured, configured === 'yes');
});

Then('the response should be {int} and list no runs', function (status) {
  assert.equal(state(this).last.status, status);
  assert.deepEqual(state(this).last.body.runs, []);
});

Then('the response should be {int} with the error {string}', function (status, error) {
  assert.equal(state(this).last.status, status, state(this).last.text);
  assert.equal(state(this).last.body?.error, error);
});

const stored = (world, key) => state(world).bucket.objects.get(key).body.toString('utf-8');

Then('the response should be exactly the stored index.json', function () {
  assert.equal(state(this).last.text, stored(this, 'results/index.json'));
});

Then('the response should be exactly the stored latest.json', function () {
  assert.equal(state(this).last.text, stored(this, 'results/latest.json'));
});

Then('the listed runs should be, newest first, the commits: {string}', function (commits) {
  assert.deepEqual(state(this).last.body.runs.map((r) => r.commit), commits.split(', '));
});

Then('the summary should be for the commit {string}', function (commit) {
  const { last } = state(this);
  assert.equal((last.body.summary ?? last.body).commit, commit);
});

Then("there should be a signed link for each of the run's stored files, all on the API's own address", function () {
  const { summary, links } = state(this).last.body;
  const prefix = `results/runs/${summary.runId}/`;
  const expected = summary.files.map((key) => key.slice(prefix.length));
  assert.deepEqual(Object.keys(links).sort(), expected.sort());
  assert.ok(Object.keys(links).some((path) => path.startsWith('artifacts/')), 'expected artifact links too');
  for (const link of Object.values(links)) {
    const url = new URL(link);
    assert.equal(url.origin, new URL(state(this).runtime?.base ?? API).origin);
    assert.match(url.pathname, /^\/files\//);
    assert.ok(url.searchParams.get('exp') && url.searchParams.get('sig'));
  }
});

Then('the links should be valid for {int} seconds', function (seconds) {
  const { body } = state(this).last;
  assert.equal(body.linksExpireInSeconds, seconds);
  for (const link of Object.values(body.links)) {
    assert.equal(Number(new URL(link).searchParams.get('exp')), Math.floor(state(this).now / 1000) + seconds);
  }
});

Then('its content type should be {string}', function (type) {
  assert.equal(state(this).last.headers.get('Content-Type'), type);
});

Then('its content should be exactly what was stored', function () {
  const { last, file } = state(this);
  assert.ok(last.bytes.equals(state(this).bucket.objects.get(runKey(this, file)).body));
  if (file.endsWith('.png')) assert.deepEqual([...last.bytes.subarray(0, 4)], PNG_SIGNATURE);
});

const uncached = (headers) => {
  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
};

Then('it should not be cached, and the browser must not guess its type', function () {
  uncached(state(this).last.headers);
});

Then('its extra protection should be {string}', function (protection) {
  const { headers } = state(this).last;
  const csp = headers.get('Content-Security-Policy');
  const disposition = headers.get('Content-Disposition');
  if (protection === 'a sandbox that allows scripts but no origin') {
    assert.equal(csp, 'sandbox allow-scripts');
    assert.equal(disposition, null);
  } else if (protection === 'a download, not shown in the browser') {
    assert.match(disposition, /^attachment; filename="[\w.-]+\.zip"$/);
    assert.equal(csp, null);
  } else {
    assert.equal(protection, 'none');
    assert.equal(csp, null);
    assert.equal(disposition, null);
  }
});

Then('the bucket should not have been asked for anything', function () {
  assert.deepEqual(state(this).asked, []);
});

Then('the bucket should not have been asked for anything outside {string}', function (prefix) {
  assert.ok(state(this).asked.length > 0 || state(this).responses.length > 0);
  assert.deepEqual(state(this).asked.filter((key) => !key.startsWith(prefix) || key.includes('..')), []);
});

// --- Browser access -----------------------------------------------------------------------------------------------

Then(/^the response should (allow|not allow) that origin to read it$/, function (allow) {
  const { headers, origin } = state(this).last;
  assert.equal(headers.get('Access-Control-Allow-Origin'), allow === 'allow' ? origin : null);
  if (allow === 'allow') assert.match(headers.get('Vary'), /Origin/);
});

Then(/^the preflight should (allow|not allow) the Authorization header$/, function (allow) {
  const header = state(this).last.headers.get('Access-Control-Allow-Headers');
  if (allow === 'allow') assert.match(header, /Authorization/);
  else assert.equal(header, null);
  assert.equal(state(this).last.headers.get('Access-Control-Allow-Origin') !== null, allow === 'allow');
});

Then('no response body or header should contain the admin token', function () {
  const { token, responses } = state(this);
  assert.ok(responses.length >= 5);
  for (const { text, headers } of responses) {
    assert.ok(!text.includes(token), 'token in a body');
    for (const [name, value] of headers) assert.ok(!value.includes(token) && !name.includes(token), `token in header ${name}`);
  }
});

Then('every response should be uncached, not sniffable and no-referrer', function () {
  assert.ok(state(this).responses.length >= 5);
  for (const { headers } of state(this).responses) uncached(headers);
});

// --- The deployment files ---------------------------------------------------------------------------------------------

const workerFile = (name) => readFileSync(join(ROOT, 'workers/results-api', name), 'utf-8');
/** wrangler.jsonc without its whole-line comments (a URL's // is left alone). */
const workerConfig = () => JSON.parse(workerFile('wrangler.jsonc').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'));

Then("the Worker's configuration should bind the bucket {string} as RESULTS", function (bucket) {
  assert.deepEqual(workerConfig().r2_buckets, [{ binding: 'RESULTS', bucket_name: bucket }]);
});

Then("the Worker's configuration should allow exactly the origins listed in the site configuration", function () {
  assert.deepEqual(workerConfig().vars.ALLOWED_ORIGINS.split(','), [...RESULTS_API_ALLOWED_ORIGINS]);
});

Then("the Worker's configuration should contain no secret value", function () {
  assert.deepEqual(Object.keys(workerConfig().vars), ['ALLOWED_ORIGINS']);
  assert.doesNotMatch(workerFile('wrangler.jsonc'), /ADMIN_TOKEN["']?\s*:/);
});

Then("the Worker's code should never write, delete or list anything in R2", function () {
  const code = workerFile('src/index.mjs');
  assert.doesNotMatch(code, /\.(put|delete|list|head|createMultipartUpload)\(/);
  const used = [...code.matchAll(/env\.RESULTS\.(\w+)\(/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  assert.deepEqual(used.filter((method) => method !== 'get'), []);
});
