import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { parse } from 'node-html-parser';
import { config, lib, sourcePath, state } from '../support/photo-helpers.js';
import { DIST_DIR, ROOT } from '../support/lib.js';

const form = await import(join(ROOT, 'scripts/lib/photo-form.mjs'));
const formServer = await import(join(ROOT, 'scripts/lib/photo-form-server.mjs'));
const { CATEGORIES } = await import(join(ROOT, 'src/config/categories.ts'));
const en = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en.json'), 'utf-8'));
const es = JSON.parse(readFileSync(join(ROOT, 'src/i18n/es.json'), 'utf-8'));

const SITE = 'http://localhost:4321';

// --- Talking to the form's service ---------------------------------------------------------------------------------------

/** The service, over this scenario's temporary content folder and fake R2. */
function service(world) {
  const s = state(world);
  s.service ??= form.createPhotoFormHandler({ contentDir: s.contentDir, storage: s.storage, sync: Boolean(s.sync) });
  return s.service;
}

/** Sends one request the way the page (or something else) would, and remembers the answer. */
async function send(world, method, address, { body, origin, headers = {} } = {}) {
  const request = new Request(address, { method, body, headers: { ...(origin ? { Origin: origin } : {}), ...headers } });
  const response = await service(world)(request);
  const answer = response ? { status: response.status, body: await response.json() } : null;
  state(world).answer = answer;
  return answer;
}

/** A multipart body like the form's: the photo (unless `photo` is null) and the text fields. */
function formData(photo, fields = {}) {
  const data = new FormData();
  if (photo) data.set('photo', new File([photo], 'upload.jpg', { type: 'image/jpeg' }));
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const post = (world, path, photo, fields) => send(world, 'POST', `${SITE}/__photos/${path}`, { body: formData(photo, fields), origin: SITE });

async function fileBytes(world, name) {
  const bytes = await readFile(sourcePath(world, name));
  state(world).sent = bytes;
  return bytes;
}

/** The photo a submitted form is about: a picture, a text file, or nothing. */
async function whatWasSent(world, what) {
  if (what === 'a PNG picture') return sharp({ create: { width: 40, height: 30, channels: 3, background: '#557' } }).png().toBuffer();
  if (what === 'a text file') return Buffer.from('this is not a picture');
  if (what === 'no photo at all') return null;
  return fileBytes(world, 'moon.jpg');
}

const answer = (world) => state(world).answer;

// --- Setting the scene ------------------------------------------------------------------------------------------------------

Given('the category {string} already has photos with the orders {string}', async function (category, orders) {
  for (const order of orders.split(',').map((n) => Number(n.trim()))) {
    const id = createHash('sha256').update(`${category}/${order}`).digest('hex').slice(0, 16);
    await lib.writeEntry(lib.entryPath(state(this).contentDir, category, id), {
      title: `Earlier ${category} ${order}`,
      category,
      photo: { id, width: 100, height: 100 },
      featured: false,
      order,
    });
  }
});

// --- Reading a photo ----------------------------------------------------------------------------------------------------------

When('I send {string} to the form to be read', async function (name) {
  await post(this, 'analyze', await fileBytes(this, name));
});

When('I send a photo that claims to be 200 MB to the form to be read', async function () {
  await send(this, 'POST', `${SITE}/__photos/analyze`, { body: formData(Buffer.from('x')), origin: SITE, headers: { 'Content-Length': String(200 * 1024 * 1024) } });
});

Then('the form should answer with status {int}', function (status) {
  assert.equal(answer(this).status, status, JSON.stringify(answer(this).body));
});

Then('the form should have read a {int} by {int} photo with a 16-character id', function (width, height) {
  const { body } = answer(this);
  assert.equal(answer(this).status, 200, JSON.stringify(body));
  assert.deepEqual([body.width, body.height], [width, height]);
  assert.match(body.id, config.PHOTO_ID_PATTERN);
});

Then('the form should have read the camera line {string}', function (line) {
  assert.equal(answer(this).body.camera, line);
});

Then('the form should have read no camera line', function () {
  assert.equal(answer(this).body.camera, null);
});

Then('the form should say the photo is in no category yet', function () {
  assert.deepEqual(answer(this).body.inCategories, []);
});

Then('the form should say the photo is already in {string}', function (category) {
  assert.deepEqual(answer(this).body.inCategories, [category]);
});

// --- The order ------------------------------------------------------------------------------------------------------------------

When('I ask the form for the category orders', async function () {
  await send(this, 'GET', `${SITE}/__photos/status`);
});

Then('the form should say {string} has {int} photos, a highest order of {int} and a next order of {int}', function (category, count, max, next) {
  assert.deepEqual(answer(this).body.categories[category], { count, max, next });
});

Then('the form should know every configured category', function () {
  assert.deepEqual(Object.keys(answer(this).body.categories).sort(), CATEGORIES.map((c) => c.slug).sort());
});

Then('the form should say the entry was given the order {int}', function (order) {
  assert.equal(answer(this).body.order, order);
});

When('I submit {string} as {string} and {string} as {string} to {string} at the same moment, without orders', async function (fileA, titleA, fileB, titleB, category) {
  const one = post(this, 'add', await readFile(sourcePath(this, fileA)), { title: titleA, category });
  const two = post(this, 'add', await readFile(sourcePath(this, fileB)), { title: titleB, category });
  state(this).answers = await Promise.all([one, two]);
});

Then('the form should have given the two photos the orders {int} and {int}', function (a, b) {
  const answers = state(this).answers;
  assert.deepEqual(answers.map((r) => r.status), [200, 200], JSON.stringify(answers));
  assert.deepEqual(answers.map((r) => r.body.order).sort(), [a, b].sort());
});

// --- Submitting the form -------------------------------------------------------------------------------------------------------

When('I submit the photo {string} to the form with:', async function (name, table) {
  await post(this, 'add', await fileBytes(this, name), table.rowsHash());
});

When('I submit {string} to the form with:', async function (what, table) {
  await post(this, 'add', await whatWasSent(this, what), table.rowsHash());
});

Then('the form should refuse it with status {int} and the code {string}', function (status, code) {
  assert.deepEqual([answer(this).status, answer(this).body.error], [status, code], JSON.stringify(answer(this).body));
});

Then("the form's message should mention {string}", function (fragment) {
  assert.ok(answer(this).body.message.includes(fragment), answer(this).body.message);
});

Then('the form should answer with the written entry, identical to the file, and where it is', async function () {
  const { body } = answer(this);
  assert.equal(body.path, `astro/images/${body.id}.md`);
  assert.equal(body.key, `photos/astro/${body.id}.md`, 'where the entry is in the web bucket');
  assert.equal(await readFile(join(state(this).contentDir, body.path), 'utf-8'), body.entry);
});

Then('the stored original should be byte for byte the photo that was sent', function () {
  const [object] = [...state(this).storage.objects.originals.values()];
  assert.ok(Buffer.compare(object.body, state(this).sent) === 0);
});

// --- Only the owner's own page ------------------------------------------------------------------------------------------------

When(/^I send (GET|POST) (\S+) to the service from the origin "([^"]*)"$/, async function (method, address, origin) {
  const body = method === 'POST' ? formData(await fileBytes(this, 'moon.jpg'), { title: 'Half Moon', category: 'astro' }) : undefined;
  await send(this, method, address, { body, origin: origin === 'none' ? undefined : origin });
});

Then(/^the form's service should leave "\/admin\/" alone, and answer an unknown address of its own with 404$/, async function () {
  assert.equal(await service(this)(new Request(`${SITE}/admin/`)), null);
  assert.equal(await service(this)(new Request(`${SITE}/es/admin/`)), null);
  await send(this, 'GET', `${SITE}/__photos/nothing-here`);
  assert.deepEqual([answer(this).status, answer(this).body.error], [404, 'not-found']);
});

// --- Dev server only ----------------------------------------------------------------------------------------------------------

function builtFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.(html|js|mjs|css|json|txt|xml)$/.test(entry.name)) files.push(join(dir, entry.name));
    }
  };
  walk(join(ROOT, 'dist'));
  return files;
}

Then("astro.config.mjs should add the form's service in the dev server's setup and in no build step", function () {
  assert.match(readFileSync(join(ROOT, 'astro.config.mjs'), 'utf-8'), /photoForm\(\{ contentDir/);
  assert.deepEqual(Object.keys(formServer.photoForm({ contentDir: '/content' }).hooks), ['astro:server:setup']);
  // The photo code (sharp, wrangler) is loaded when the dev server starts, not when the config is read.
  const code = readFileSync(join(ROOT, 'scripts/lib/photo-form-server.mjs'), 'utf-8');
  assert.doesNotMatch(code, /^import .*from '\.\/(photo-form|r2-storage|photos)\.mjs'/m);
});

Then("no built page or script should contain the form's server code", function () {
  const offenders = builtFiles().filter((file) => /createPhotoFormHandler|photoFormMiddleware|MAX_UPLOAD_BYTES|createR2Storage|bin\/wrangler\.js/.test(readFileSync(file, 'utf-8')));
  assert.deepEqual(offenders, []);
});

// --- The built page and the form's code -------------------------------------------------------------------------------------

Then("the built Admin page in each language should offer every configured category to the form under its own name in that language", function () {
  for (const [locale, messages] of [['en', en], ['es', es]]) {
    const html = parse(readFileSync(join(DIST_DIR, locale === 'en' ? 'admin' : `${locale}/admin`, 'index.html'), 'utf-8'));
    const offered = JSON.parse(html.querySelector('[data-pics]').getAttribute('data-categories'));
    assert.deepEqual(offered, CATEGORIES.map(({ slug }) => ({ slug, label: messages.categories[slug].label })), locale);
    assert.ok(html.querySelector('[data-pics-form]'), `${locale}: the form's place is missing`);
  }
});

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));

Then("the form's messages should be the same set in English and Spanish, with the same placeholders", function () {
  const english = new Map(flatten(en.admin.pics.form));
  const spanish = new Map(flatten(es.admin.pics.form));
  assert.ok(english.size >= 30);
  assert.deepEqual([...spanish.keys()].sort(), [...english.keys()].sort());
  for (const [key, text] of english) assert.deepEqual(placeholders(spanish.get(key)), placeholders(text), key);
});

Then("the form's code should only fetch from the local photo service, never write HTML, and never send the admin token", function () {
  const code = readFileSync(join(ROOT, 'src/lib/photo-form.ts'), 'utf-8');
  assert.equal(code.match(/\bfetch\(/g)?.length, 1, 'one place makes requests');
  assert.match(code, /const SERVICE = '\/__photos';/);
  assert.match(code, /fetch\(`\$\{SERVICE\}\$\{path\}`/);
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|Authorization|remembered|sessionStorage|localStorage/);
});
