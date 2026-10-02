import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';

const { createApiBucketStorage } = await import(join(ROOT, 'scripts/lib/r2-storage.mjs'));
const { createResultsFormHandler } = await import(join(ROOT, 'scripts/lib/results-form.mjs'));
const { NO_CACHE, RESULTS_BUCKET } = await import(join(ROOT, 'scripts/lib/results.mjs'));

/**
 * A stand-in for Cloudflare's R2 API (records each request, answers from `objects`), for wrangler's credentials
 * (`tokens`, handed out in turn; counted), and for the wrangler storage the API storage falls back to.
 */
function api(world) {
  world.r2 ??= { accountId: 'acc123', tokens: ['tok-1'], credentialCalls: 0, credentialError: null, refused: new Set(), status: null, objects: new Map(), requests: [], fallbackDeletes: [] };
  return world.r2;
}

function storage(world, bucket) {
  const r2 = api(world);
  return createApiBucketStorage(bucket, {
    credentials: async () => {
      r2.credentialCalls++;
      if (r2.credentialError) throw new Error(r2.credentialError);
      return { accountId: r2.accountId, token: r2.tokens.length > 1 ? r2.tokens.shift() : r2.tokens[0] };
    },
    fetchImpl: async (url, init) => {
      const request = { method: init.method, path: new URL(url).pathname.replace('/client/v4', ''), token: init.headers.Authorization.replace('Bearer ', ''), headers: init.headers, body: init.body };
      r2.requests.push(request);
      if (r2.refused.has(request.token)) return new Response('{"errors":[{"code":10000}]}', { status: 401, statusText: 'Unauthorized' });
      if (r2.status) return new Response('{"errors":[{"code":10001}]}', { status: r2.status, statusText: 'Internal Server Error' });
      const key = decodeURIComponent(request.path.split('/objects/')[1]);
      if (init.method === 'GET') return r2.objects.has(key) ? new Response(r2.objects.get(key)) : new Response('', { status: 404 });
      return new Response('{"success":true}', { status: 200 });
    },
    fallback: { put: async () => {}, get: async () => null, delete: async (key) => void r2.fallbackDeletes.push(key) },
  });
}

async function attempt(world, work) {
  world.r2.error = null;
  try {
    world.r2.result = await work();
  } catch (error) {
    world.r2.error = error;
  }
}

Given('R2\'s API with the account {string} and the token {string}', function (accountId, token) {
  Object.assign(api(this), { accountId, tokens: [token] });
});

Given(/^R2's API with the account "([^"]+)" and the token "([^"]+)", holding "([^"]+)" as "(.*)"$/, function (accountId, token, key, body) {
  Object.assign(api(this), { accountId, tokens: [token] });
  api(this).objects.set(key, body.replace(/\\"/g, '"'));
});

Given('R2\'s API refuses the token {string}, and wrangler\'s next token is {string}', function (refused, next) {
  api(this).refused.add(refused);
  api(this).tokens = [refused, next];
});

Given('R2\'s API answers every request with {int}', function (status) {
  api(this).status = status;
});

Given('wrangler can\'t give the credentials: {string}', function (message) {
  api(this).credentialError = message;
});

When('the API storage of {string} deletes {string}', async function (bucket, key) {
  const store = storage(this, bucket);
  await attempt(this, () => store.delete(key));
});

When('the API storage of {string} deletes {int} files at once', async function (bucket, count) {
  const store = storage(this, bucket);
  await attempt(this, () => Promise.all(Array.from({ length: count }, (_, i) => store.delete(`results/runs/x/file-${i}.json`))));
});

When('the API storage of {string} reads {string}', async function (bucket, key) {
  const store = (this.r2store ??= storage(this, bucket));
  await attempt(this, () => store.get(key));
});

When('the API storage of {string} writes {string} as JSON with no caching', async function (bucket, key) {
  const file = join(mkdtempSync(join(tmpdir(), 'r2-api-')), 'object.json');
  writeFileSync(file, '{"runs":[]}\n');
  this.r2file = file;
  const store = storage(this, bucket);
  await attempt(this, () => store.put(key, file, 'application/json', NO_CACHE));
});

When('the Admin page asks the results service whether it is there', async function () {
  const handle = createResultsFormHandler({ storage: storage(this, RESULTS_BUCKET), ciStateFile: null, lighthouseStateFile: null });
  const response = await handle(new Request('http://localhost:4321/__results/status'));
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

Then('R2\'s API should have been asked {string} with the token {string}', function (request, token) {
  const [method, path] = request.split(' ');
  assert.ok(this.r2.requests.some((r) => r.method === method && r.path === path && r.token === token), JSON.stringify(this.r2.requests.map((r) => `${r.method} ${r.path}`)));
});

Then('R2\'s API should have been asked {int} time(s)', function (times) {
  assert.equal(api(this).requests.length, times);
});

Then('wrangler should have been asked for the credentials {int} time(s)', function (times) {
  assert.equal(this.r2.credentialCalls, times);
});

Then('it should get {string}', function (text) {
  assert.equal(this.r2.error, null);
  assert.equal(this.r2.result.toString('utf-8'), text.replace(/\\"/g, '"'));
});

Then('it should get nothing', function () {
  assert.equal(this.r2.error, null);
  assert.equal(this.r2.result, null);
});

Then('it should not have failed', function () {
  assert.equal(this.r2.error, null);
});

Then('it should have failed with {string}', function (message) {
  assert.ok(this.r2.error?.message.startsWith(message), this.r2.error?.message);
});

Then('that request should have carried the file, {string} and {string}', function (contentType, cacheControl) {
  const request = this.r2.requests.at(-1);
  assert.equal(Buffer.from(request.body).toString('utf-8'), readFileSync(this.r2file, 'utf-8'));
  assert.equal(request.headers['content-type'], contentType);
  assert.equal(request.headers['cache-control'], cacheControl);
});

Then('R2\'s last request should have carried the token {string}', function (token) {
  assert.equal(this.r2.requests.at(-1).token, token);
});

Then('the wrangler storage should have deleted {string}', function (key) {
  assert.deepEqual(this.r2.fallbackDeletes, [key]);
});

Then('the dev server\'s results service should use the API storage for {string}', function (bucket) {
  assert.equal(RESULTS_BUCKET, bucket);
  const source = readFileSync(join(ROOT, 'scripts/lib/results-form-server.mjs'), 'utf-8');
  assert.match(source, /storage: createApiBucketStorage\(RESULTS_BUCKET, \{ log \}\)/);
});
