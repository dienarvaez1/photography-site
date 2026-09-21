import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, ROOT, readBuiltPage, loadMessages } from '../support/lib.js';
import { fakeOriginals, sampleFile } from '../support/originals-fixtures.js';
import { readdirSync } from 'node:fs';

const view = await import(join(ROOT, 'src/lib/pics-view.ts'));
const { RESULTS_API_URL } = await import(join(ROOT, 'src/config/results.ts'));
const photosConfig = await import(join(ROOT, 'src/config/photos.ts'));

const API_ORIGINS = 'https://site.test,http://localhost:4321';

const state = (world) => world.data.api;

async function setUp(world, files, options) {
  const fake = fakeOriginals(files, options);
  world.data.api = { token: 'correct-admin-token-123', env: { ADMIN_TOKEN: 'correct-admin-token-123', ALLOWED_ORIGINS: API_ORIGINS, ORIGINALS: fake.binding }, now: Date.parse('2026-09-21T12:00:00Z'), responses: [], links: {}, runIds: [], originals: fake, files };
}

Given('a results API with the admin token {string} and these original photos:', async function (token, table) {
  const files = [];
  for (const [i, row] of table.hashes().entries()) files.push({ id: row.id, ext: row.extension, body: await sampleFile(row.metadata, i * 40) });
  await setUp(this, files);
  state(this).token = token;
  state(this).env.ADMIN_TOKEN = token;
});

Given('a bucket with no original photos', async function () {
  const { token } = state(this);
  await setUp(this, []);
  state(this).token = token;
  state(this).env.ADMIN_TOKEN = token;
});

Given(/^the bucket also holds (.+)$/, function (list) {
  const s = state(this);
  for (const [, key] of list.matchAll(/"([^"]+)"/g)) s.originals.objects.set(key, { body: Buffer.from('x'), uploaded: new Date() });
});

Given('the bucket lists at most {int} objects per page', async function (pageSize) {
  const s = state(this);
  const fake = fakeOriginals(s.files, { pageSize });
  s.originals = fake;
  s.env = { ...s.env, ORIGINALS: fake.binding };
});

Given('the bucket holds {int} originals and lists {int} object per page', async function (count, pageSize) {
  const s = state(this);
  const files = Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(16, '0'), body: Buffer.from('x') }));
  const fake = fakeOriginals(files, { pageSize });
  s.originals = fake;
  s.env = { ...s.env, ORIGINALS: fake.binding };
});

Given('the Worker has no originals bucket', function () {
  if (this.b) return void delete this.b.results.env.ORIGINALS; // in the browser tests
  const env = { ...state(this).env };
  delete env.ORIGINALS;
  state(this).env = env;
});

// --- The list ---------------------------------------------------------------------------------------------------

Then('the photo list should be exactly: {string}', function (ids) {
  assert.deepEqual(state(this).last.body.photos.map((p) => p.id), ids ? ids.split(', ') : []);
});

Then('every listed photo should carry the size and key of the stored file', function () {
  const { objects } = state(this).originals;
  for (const photo of state(this).last.body.photos) {
    assert.ok(objects.has(photo.key), photo.key);
    assert.equal(photo.size, objects.get(photo.key).body.length);
    assert.match(photo.key, new RegExp(`^photos/${photo.id}/original\\.(jpg|jpeg)$`));
  }
});

Then('the list should say it is complete', function () {
  assert.equal(state(this).last.body.complete, true);
});

Then('the list should say it is incomplete', function () {
  assert.equal(state(this).last.body.complete, false);
});

// --- One photo ------------------------------------------------------------------------------------------------------

const photo = (world) => state(world).last.body;

Then('the camera line should be {string}', function (line) {
  assert.equal(photo(this).cameraLine, line);
});

Then('the size should be the stored file\'s size, which is over {int} million bytes', function (millions) {
  assert.ok(photo(this).size > millions * 1_000_000);
  assert.equal(photo(this).size, state(this).originals.objects.get(photo(this).key).body.length);
});

Then("the size should be the stored file's size", function () {
  assert.equal(photo(this).size, state(this).originals.objects.get(photo(this).key).body.length);
});

Then('the copyright should be {string}', function (text) {
  assert.equal(photo(this).copyright, text);
});

Then('the artist should be {string}', function (text) {
  assert.equal(photo(this).artist, text);
});

Then('there should be no copyright', function () {
  assert.equal(photo(this).copyright, null);
});

Then('there should be no camera line, no copyright and no artist', function () {
  assert.deepEqual([photo(this).cameraLine, photo(this).copyright, photo(this).artist], [null, null, null]);
});

Then('the bucket should only have been asked to list, and to read at most {int} bytes from the start of a file', function (max) {
  const { calls } = state(this).originals;
  assert.ok(calls.length > 0);
  for (const call of calls) {
    if (call.op === 'list') continue;
    assert.equal(call.op, 'get');
    assert.equal(call.range?.offset, 0, 'reads from the start');
    assert.ok(call.range.length <= max, `read ${call.range.length} bytes`);
  }
  assert.ok(calls.some((c) => c.op === 'get'), 'some file was read');
});

Then('the answer should not contain the location, serial number, date or any other metadata of the file, only the camera, size, copyright and artist', function () {
  const answer = state(this).last;
  assert.deepEqual(Object.keys(answer.body).sort(), ['artist', 'camera', 'cameraLine', 'copyright', 'id', 'key', 'size']);
  for (const secret of ['SECRET-SERIAL', '2023', 'GPS', 'Latitude', 'Longitude', '45', '122', 'Serial']) assert.ok(!answer.text.includes(secret), `the answer contains "${secret}"`);
});

Then('every answer should be small JSON with no picture data in it', function () {
  for (const { headers, bytes } of state(this).responses) {
    assert.match(headers.get('Content-Type'), /^application\/json/);
    assert.ok(bytes.length < 4000, `${bytes.length} bytes`);
    assert.ok(!bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'starts like a JPEG');
    assert.ok(!bytes.includes(Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAA')), 'contains file padding');
  }
});

Then('the originals should be unchanged', function () {
  const { objects, files } = state(this).originals ? { objects: state(this).originals.objects, files: state(this).files } : {};
  assert.equal(objects.size, files.length);
});

// --- Configuration ---------------------------------------------------------------------------------------------------

const workerFile = (name) => readFileSync(join(ROOT, 'workers/results-api', name), 'utf-8');
const workerConfig = () => JSON.parse(workerFile('wrangler.jsonc').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'));

Then("the Worker's configuration should bind the originals bucket named in the site's photo configuration as ORIGINALS", function () {
  assert.ok(workerConfig().r2_buckets.some((b) => b.binding === 'ORIGINALS' && b.bucket_name === photosConfig.PHOTO_BUCKETS.originals));
});

Then("the Worker's code should never write or delete in the originals bucket", function () {
  assert.doesNotMatch(workerFile('src/pics.mjs'), /\.(put|delete|createMultipartUpload|resumeMultipartUpload)\(/);
  const used = [...workerFile('src/pics.mjs').matchAll(/bucket\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), ['get', 'list']);
  assert.match(workerFile('src/pics.mjs'), /range: \{ offset: 0, length: HEADER_BYTES \}/);
});

// --- The viewer's logic -----------------------------------------------------------------------------------------------

Then('{int} bytes in {string} should be shown as {string}', function (bytes, locale, text) {
  assert.equal(view.formatBytes(bytes, locale), text);
});

Then('{int} bytes in {string} should be written exactly as {string}', function (bytes, locale, text) {
  assert.equal(view.formatExactBytes(bytes, locale, 'bytes'), text);
});

Given(/^the originals "([^"]+)" where the site knows (.+)$/, function (ids, knownText) {
  this.data.pics = { ids: ids.split(', '), known: {} };
  for (const [, id, title, category] of knownText.matchAll(/(\w+) as "([^"]+)" in "([^"]+)"/g)) this.data.pics.known[id] = { title, category };
});

Then('the rows should be ordered: {string}', function (order) {
  const { ids, known } = this.data.pics;
  const rows = view.joinPhotos(ids.map((id) => ({ id, key: `photos/${id}/original.jpg`, size: 1, uploaded: null })), known);
  this.data.pics.rows = rows;
  assert.deepEqual(rows.map((r) => r.id), order.split(', '));
});

Then('every original should appear exactly once', function () {
  assert.deepEqual(this.data.pics.rows.map((r) => r.id).sort(), [...this.data.pics.ids].sort());
});

Then("the Pics Viewer's Upload Photos button should open the New Photo form, and Remove Photos should only show a message, and make no request to the API", function () {
  const code = readFileSync(join(ROOT, 'src/lib/pics-viewer.ts'), 'utf-8');
  const body = code.slice(code.indexOf('function summary('), code.indexOf('// --- The list'));
  assert.match(body, /icon\('upload'\)|button\('upload', 'upload'\)/);
  assert.match(body, /button\('remove', 'trash'\)/);
  // The buttons themselves ask for nothing: Upload opens the form (which has its own service), Remove says it is not available.
  assert.doesNotMatch(body, /api<|api\(|fetch\(|\.put\(|\.delete\(|method:/);
  assert.match(body, /if \(kind === 'upload'\) \{[^}]*openForm\(\);/);
  assert.match(body, /status\.textContent = m\('pics\.removeSoon'\)/);
  assert.match(code, /photoForm\(\{/);
  // ...and the API still only knows GET.
  assert.match(readFileSync(join(ROOT, 'workers/results-api/src/index.mjs'), 'utf-8'), /request\.method !== 'GET'/);
});

Then('a {int} by {int} picture should be shown at {int} by {int}', function (width, height, shownWidth, shownHeight) {
  assert.deepEqual(view.thumbSize(width, height), { width: shownWidth, height: shownHeight });
});

Then('no answer of the API should be able to carry a picture or a picture address', function () {
  const code = readFileSync(join(ROOT, 'src/lib/pics-viewer.ts'), 'utf-8');
  const details = /type Details = \{([^}]*)\}/.exec(code)[1];
  assert.doesNotMatch(details, /src|url|href|image|thumb|data/i, 'the details the API returns are text and numbers');
  assert.doesNotMatch(readFileSync(join(ROOT, 'workers/results-api/src/pics.mjs'), 'utf-8'), /thumbnail|base64|toString\(.base64/i);
});

// --- What is built ------------------------------------------------------------------------------------------------------------

Then('the built page {string} should hold the Pics Viewer for the configured API with {string} messages and every photo of the site by its id', function (page, locale) {
  const { root } = readBuiltPage(page);
  const container = root.querySelector('[data-pics]');
  assert.ok(container?.closest('#panel-pics-viewer'), 'the viewer is inside the Pics Viewer panel');
  assert.equal(container.getAttribute('data-api'), RESULTS_API_URL);
  assert.equal(container.getAttribute('data-locale'), locale);
  const messages = JSON.parse(container.getAttribute('data-messages'));
  const source = loadMessages(locale).admin;
  assert.deepEqual(messages.pics, source.pics, 'the pics messages');
  for (const key of ['gate', 'errors', 'signOut', 'refresh', 'loading']) assert.deepEqual(messages[key], source.results[key], key);

  const known = JSON.parse(container.getAttribute('data-photos'));
  const ids = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.md')) ids.push(entry.name.replace(/\.md$/, ''));
    }
  };
  walk(join(ROOT, 'test-fixtures/photos'));
  assert.ok(ids.length > 0);
  assert.deepEqual(Object.keys(known).sort(), ids.sort(), 'every photo entry is known to the viewer, by its id');
  for (const value of Object.values(known)) assert.ok(value.title && value.category);
  assert.equal(container.querySelector('[data-pics-root]').getAttribute('aria-live'), 'polite');
  assert.ok(root.querySelector('#panel-pics-viewer noscript'), 'a message for visitors without JavaScript');
});

Then('the built page {string} should have a tab named {string} with the address {string}', function (page, name, hash) {
  const { root } = readBuiltPage(page);
  const tab = root.querySelectorAll('[role="tab"]').find((t) => t.text.trim() === name);
  assert.ok(tab, `no tab named ${name}`);
  assert.equal(`#${tab.id.replace(/^tab-/, '')}`, hash);
  assert.equal(tab.getAttribute('aria-controls'), 'panel-pics-viewer');
});

Then('the built page {string} should give every photo of the site a thumbnail that is its public 400 pixel web copy, and never an original', function (page) {
  const known = JSON.parse(readBuiltPage(page).root.querySelector('[data-pics]').getAttribute('data-photos'));
  const dimensions = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.md')) {
        const front = readFileSync(join(dir, entry.name), 'utf-8');
        dimensions.set(entry.name.replace(/\.md$/, ''), { width: Number(/width: (\d+)/.exec(front)[1]), height: Number(/height: (\d+)/.exec(front)[1]) });
      }
    }
  };
  walk(join(ROOT, 'test-fixtures/photos'));
  for (const [id, photo] of Object.entries(known)) {
    assert.equal(photo.thumb.src, `${photosConfig.PHOTOS_BASE_URL}/photos/${id}/w400.webp`);
    assert.ok(!/original/.test(photo.thumb.src));
    const { width, height } = dimensions.get(id);
    assert.equal(photo.thumb.width, Math.min(400, width));
    assert.equal(photo.thumb.height, Math.round((Math.min(400, width) * height) / width));
  }
});

Then("no built page or script should contain the originals bucket's name", function () {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.(html|js|css|json|txt|xml)$/.test(entry.name)) files.push(join(dir, entry.name));
    }
  };
  walk(DIST_DIR);
  const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(photosConfig.PHOTO_BUCKETS.originals));
  assert.deepEqual(offenders, []);
});

Then("the Pics Viewer's code should create no image but the thumbnail taken from the page's own photo data, and should only ask the API for the list and for one photo by its id", function () {
  const code = readFileSync(join(ROOT, 'src/lib/pics-viewer.ts'), 'utf-8');
  assert.doesNotMatch(code, /createElement\(['"](canvas|video|picture|source|iframe|embed|object)|el\(['"](canvas|video|picture|source|iframe|embed|object)|new Image|URL\.createObjectURL|\.blob\(\)|\.src\s*=/);
  const images = [...code.matchAll(/el\('img'[^\n]*/g)].map((m) => m[0]);
  assert.equal(images.length, 1, 'one image: the thumbnail');
  assert.match(images[0], /src: photo\.thumb\.src/, 'its address comes from the photo data of the page');
  assert.deepEqual([...code.matchAll(/api<[^>]*>\((`[^`]*`|'[^']*')\)/g)].map((m) => m[1]).sort(), ["'/pics'", '`/pics/${encodeURIComponent(id)}`']);
});
