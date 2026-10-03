// POST /translate (workers/results-api/src/translate.mjs) through the real router, with a stand-in for Workers AI.
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';

const { handle } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));
const API = 'https://api.test';
const state = (world) => world.data.translate;
const unescape = (text) => text.replaceAll('\\n', '\n');

/** Answers "[es] <text>" (or "[en] …"), like a translator that keeps everything; `mode` bends it for a scenario. */
function fakeAi(world) {
  return {
    run: async (model, input) => {
      const s = state(world);
      s.calls.push({ model, input });
      if (s.mode === 'down') throw new Error('AI unavailable');
      const to = /to (\w+)\./.exec(input.messages[0].content)[1] === 'Spanish' ? 'es' : 'en';
      const text = input.messages.at(-1).content;
      const translated = `[${to}] ${text}`;
      if (s.mode === 'quoted') return { response: `Translation: "${translated}"` };
      if (s.mode === 'no-placeholders') return { response: translated.replace(/\{[A-Za-z]+\}/g, 'mi correo') };
      if (s.mode === 'html') return { response: `<p>${translated}</p>` };
      return { response: translated };
    },
  };
}

Given('a results API with the admin token {string} and a translation service', function (token) {
  this.data.translate = { token, calls: [], mode: 'ok' };
  state(this).env = { ADMIN_TOKEN: token, ALLOWED_ORIGINS: 'http://localhost:4321', AI: fakeAi(this) };
});

Given('the translation service answers with quotes and a label', function () {
  state(this).mode = 'quoted';
});
Given('the translation service drops placeholders', function () {
  state(this).mode = 'no-placeholders';
});
Given('the translation service answers with HTML', function () {
  state(this).mode = 'html';
});
Given('the translation service is down', function () {
  state(this).mode = 'down';
});
Given('the results API has no translation service', function () {
  delete state(this).env.AI;
});

async function post(world, body, token = state(world).token) {
  const request = new Request(`${API}/translate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://localhost:4321' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const response = await handle(request, state(world).env);
  state(world).answer = { status: response.status, body: await response.json(), cors: response.headers.get('Access-Control-Allow-Origin') };
}

When('I ask the API to translate from {string} to {string}:', async function (from, to, table) {
  await post(this, { from, to, texts: Object.fromEntries(table.hashes().map((r) => [r.key, unescape(r.text)])) });
});

When('I send the API this translation request: {}', async function (body) {
  await post(this, body.trim().startsWith('{') ? JSON.parse(body) : body);
});

When('I ask the API to translate {int} texts at once', async function (count) {
  await post(this, { from: 'en', to: 'es', texts: Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, 'Hi'])) });
});

When('I ask the API to translate with the token {string}', async function (token) {
  await post(this, { from: 'en', to: 'es', texts: { a: 'Hi' } }, token);
});

Then('the response should be {int} with these translations:', function (status, table) {
  const { answer } = state(this);
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  assert.deepEqual(answer.body, { texts: Object.fromEntries(table.hashes().map((r) => [r.key, unescape(r.text)])) });
  assert.equal(answer.cors, 'http://localhost:4321', 'the page on localhost may read it');
});

Then('the translate response should be {int} with the error {string}', function (status, error) {
  const { answer } = state(this);
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  assert.equal(answer.body.error, error);
});

Then('the translation service should have been asked {int} time(s), with model {string}, from {word} to {word}', function (count, model, from, to) {
  const { calls } = state(this);
  assert.equal(calls.length, count);
  for (const { model: used, input } of calls) {
    assert.equal(used, model);
    assert.match(input.messages[0].content, new RegExp(`from ${from} to ${to}\\.`));
    assert.match(input.messages[0].content, /placeholder/i, 'told to keep placeholders');
    if (to === 'Spanish') assert.match(input.messages[0].content, /informally with "tú"/, 'the site speaks to its visitors as tú');
  }
});

Then('the translation service should not have been asked', function () {
  assert.equal(state(this).calls.length, 0);
});

Then("the results API's wrangler.jsonc should bind Workers AI as {string}", function (binding) {
  const config = readFileSync(join(ROOT, 'workers/results-api/wrangler.jsonc'), 'utf-8');
  assert.match(config, new RegExp(`"ai"\\s*:\\s*\\{\\s*"binding"\\s*:\\s*"${binding}"`));
});
