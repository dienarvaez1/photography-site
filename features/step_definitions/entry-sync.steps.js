import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { config, entryFile, findEntry, lib, readEntry, sourcePath, state } from '../support/photo-helpers.js';
import { ROOT } from '../support/lib.js';
import { pushEntries } from '../../scripts/lib/entry-sync.mjs';
import { join } from 'node:path';

const manifestModule = await import(join(ROOT, 'src/config/photo-manifest.ts'));
const { MANIFEST_KEY, entryKey, buildManifest } = manifestModule;

const web = (world) => state(world).storage.objects.web;
const events = (world) => state(world).storage.events;
const idFor = (category, title) => createHash('sha256').update(`${category}/${title}`).digest('hex').slice(0, 16);
const manifestIn = (world) => JSON.parse(web(world).get(MANIFEST_KEY).body.toString('utf-8'));
const putWeb = (world, key, text, contentType) => web(world).set(key, { body: Buffer.from(text), contentType, cacheControl: 'no-cache' });

Given('the entries live in R2, with the library folder as their local mirror', function () {
  state(this).sync = true;
});

// --- What R2 holds ---------------------------------------------------------------------------------------------------------------

/** Puts entries straight into R2 (as another computer's `photos:add` would have), replacing the manifest. */
function publishEntries(world, rows) {
  const entries = rows.map(({ category, title, order, camera }) => {
    const id = idFor(category, title);
    const data = { title, category, photo: { id, width: 1200, height: 800 }, ...(camera ? { camera } : {}), featured: false, order: Number(order) };
    putWeb(world, entryKey(category, id), lib.serializeEntry(data), 'text/markdown; charset=utf-8');
    return { category, id, data };
  });
  putWeb(world, MANIFEST_KEY, JSON.stringify(buildManifest(entries, '2026-09-21T00:00:00Z')), 'application/json; charset=utf-8');
  state(world).published = entries;
}

Given('R2 holds these entries:', function (table) {
  publishEntries(this, table.hashes());
});

Given('R2 holds a manifest with a broken entry: {}', function (what) {
  const id = idFor('astro', 'Half Moon');
  const data = { title: 'Half Moon', category: 'astro', photo: { id, width: 1200, height: 800 }, featured: false, order: 1 };
  const broken = {
    'a title that is missing': () => delete data.title,
    'a photo id that is invalid': () => (data.photo.id = 'nope'),
    'an order that is missing': () => delete data.order,
    'a size that is missing': () => delete data.photo.width,
  }[what];
  broken();
  putWeb(this, MANIFEST_KEY, JSON.stringify({ version: 1, updatedAt: 'x', entries: [{ category: 'astro', id: what === 'a photo id that is invalid' ? 'nope' : id, data }] }), 'application/json');
});

When('the entry file of {string} disappears from R2', async function (ref) {
  const { category, photo } = await readEntry(this, ref);
  web(this).delete(entryKey(category, photo.id));
});

Given('I remember the photo id of {string}', async function (ref) {
  const { category, photo } = await readEntry(this, ref);
  state(this).remembered = { category, id: photo.id };
});

When('I remember what R2 has been asked to change', function () {
  state(this).mark = events(this).length;
});

// --- Assertions on R2 ------------------------------------------------------------------------------------------------------------

const slugOf = (entry) => `${entry.category}/${lib.slugify(entry.data.title)}`;

Then('the manifest in R2 should list exactly: {string}', function (list) {
  assert.deepEqual(manifestIn(this).entries.map(slugOf), list === '' ? [] : list.split(', '));
});

Then('R2 should hold no manifest', function () {
  assert.equal(web(this).has(MANIFEST_KEY), false);
});

Then('R2 should hold no entry file for {string}', function (category) {
  assert.deepEqual([...web(this).keys()].filter((key) => key.startsWith(`photos/categories/${category}/`)), []);
});

Then('the entry {string} should be in R2 as its own .md file, identical to the local file', async function (ref) {
  const { category, photo } = await readEntry(this, ref);
  const object = web(this).get(`photos/categories/${category}/${photo.id}.md`);
  assert.ok(object, 'the entry file is in the web bucket');
  assert.equal(object.body.toString('utf-8'), await readFile(await entryFile(this, ref), 'utf-8'));
  assert.equal(object.contentType, 'text/markdown; charset=utf-8');
  assert.equal(object.cacheControl, 'no-cache', 'an entry that changes must not be cached');
});

Then('the entry file of the remembered photo should be gone from R2', function () {
  const { category, id } = state(this).remembered;
  assert.equal(web(this).has(entryKey(category, id)), false);
});

Then('the manifest entry {string} should carry the same data as the local entry', async function (ref) {
  const local = await readEntry(this, ref);
  const listed = manifestIn(this).entries.find((e) => slugOf(e) === ref);
  assert.ok(listed, `${ref} is in the manifest`);
  assert.deepEqual(listed.data, JSON.parse(JSON.stringify(local)));
  assert.equal(listed.id, local.photo.id);
  assert.equal(listed.category, local.category);
});

Then('the manifest entry {string} should have the camera line {string}', function (ref, line) {
  assert.equal(manifestIn(this).entries.find((e) => slugOf(e) === ref).data.camera, line);
});

Then('the manifest entry {string} should have order {int}', function (ref, order) {
  assert.equal(manifestIn(this).entries.find((e) => slugOf(e) === ref).data.order, order);
});

Then('the manifest in R2 should be JSON of version 1 holding, for each entry, its category, photo id and data', function () {
  const manifest = manifestIn(this);
  assert.equal(manifest.version, 1);
  assert.match(manifest.updatedAt, /^\d{4}-\d\d-\d\dT/);
  for (const entry of manifest.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['category', 'data', 'id']);
    assert.equal(entry.data.photo.id, entry.id);
    assert.equal(web(this).get(MANIFEST_KEY).contentType, 'application/json; charset=utf-8');
    assert.equal(web(this).get(MANIFEST_KEY).cacheControl, 'no-cache');
  }
});

// --- The order things happen in ---------------------------------------------------------------------------------------------------

Then('the R2 change {string} should have happened before the R2 change {string}', function (first, second) {
  const seen = events(this).slice(state(this).mark ?? 0);
  const a = seen.findIndex((e) => e.includes(first));
  const b = seen.findIndex((e) => e.includes(second));
  assert.ok(a >= 0, `no change matching "${first}" in:\n${seen.join('\n')}`);
  assert.ok(b >= 0, `no change matching "${second}" in:\n${seen.join('\n')}`);
  assert.ok(a < b, `"${first}" (#${a}) should come before "${second}" (#${b}):\n${seen.join('\n')}`);
});

Then('R2 should not have been asked to change anything since', function () {
  assert.deepEqual(events(this).slice(state(this).mark), []);
});

// --- The local mirror --------------------------------------------------------------------------------------------------------------

Then('the local entry {string} should read exactly what its R2 data serialises to', async function (ref) {
  const listed = manifestIn(this).entries.find((e) => slugOf(e) === ref);
  assert.equal(await readFile(await entryFile(this, ref), 'utf-8'), lib.serializeEntry(listed.data));
});

Given('the local entry {string} is edited to have order {int}', async function (ref, order) {
  const entry = await findEntry(this, ref);
  await lib.writeEntry(entry.file, { ...entry.data, order }, entry.body);
});

// --- Where an uploaded photo's files end up ---------------------------------------------------------------------------------

const originals = (world) => state(world).storage.objects.originals;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const idOf = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** The entries named like "astro/half-moon" (category/title slug), as { category, id, data } from the local mirror. */
async function entriesOf(world, list) {
  return Promise.all(list.split(', ').map(async (ref) => {
    const data = await readEntry(world, ref);
    return { ref, category: data.category, id: data.photo.id, data };
  }));
}

Given('I remember the bytes of the photo file {string}', async function (name) {
  state(this).sent = await readFile(sourcePath(this, name));
});

Given('R2 works again', function () {
  state(this).storage.faults.failPutMatching = null;
});

Then('the private originals bucket should hold exactly the originals of: {string}', async function (list) {
  const entries = await entriesOf(this, list);
  const expected = [...new Set(entries.map((e) => config.photoKey(e.id, 'original')))].sort();
  assert.deepEqual([...originals(this).keys()].sort(), expected);
  for (const object of originals(this).values()) {
    assert.equal(object.contentType, 'image/jpeg');
    assert.equal(object.cacheControl, IMMUTABLE);
  }
});

Then('the public web bucket should hold exactly the web sizes, entry files and manifest of: {string}', async function (list) {
  const entries = await entriesOf(this, list);
  const expected = [
    ...new Set(entries.flatMap((e) => config.photoKeys(e.id).web)),
    ...entries.map((e) => entryKey(e.category, e.id)),
    MANIFEST_KEY,
  ].sort();
  assert.deepEqual([...web(this).keys()].sort(), expected);
  for (const [key, object] of web(this)) {
    if (key.endsWith('.webp')) assert.deepEqual([object.contentType, object.cacheControl], ['image/webp', IMMUTABLE], key);
    else if (key.endsWith('.md')) assert.deepEqual([object.contentType, object.cacheControl], ['text/markdown; charset=utf-8', 'no-cache'], key);
    else assert.deepEqual([key, object.contentType, object.cacheControl], [MANIFEST_KEY, 'application/json; charset=utf-8', 'no-cache']);
  }
});

Then('nothing but originals should be in the private originals bucket', function () {
  for (const key of originals(this).keys()) assert.match(key, /^photos\/[0-9a-f]{16}\/original\.jpg$/, `${key} does not belong in the private bucket`);
});

Then('no original should be in the public web bucket', function () {
  for (const key of web(this).keys()) assert.doesNotMatch(key, /original\./, `${key} must never be public`);
});

Then('every photo id in the manifest should be the hash of its original in R2', function () {
  const { entries } = manifestIn(this);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const original = originals(this).get(config.photoKey(entry.id, 'original'));
    assert.ok(original, `the original of ${entry.id} is in the originals bucket`);
    assert.equal(idOf(original.body), entry.id);
  }
});

Then('every manifest entry should equal the front matter of its entry file in R2', function () {
  const { entries } = manifestIn(this);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const object = web(this).get(entryKey(entry.category, entry.id));
    assert.ok(object, `${entryKey(entry.category, entry.id)} is in the web bucket`);
    const text = object.body.toString('utf-8');
    assert.deepEqual(matter(text).data, entry.data, `${entry.category}/${entry.id}`);
    assert.equal(text, lib.serializeEntry(entry.data), 'the entry file is written the way the tools always write it');
  }
});

Then('the manifest in R2 should hold exactly these entries:', function (table) {
  const expected = table.hashes().map((row) => ({
    title: row.title,
    ...(row.titleEs ? { titles: { es: row.titleEs } } : {}),
    category: row.category,
    photo: { width: Number(row.width), height: Number(row.height) },
    ...(row.camera ? { camera: row.camera } : {}),
    featured: row.featured === 'true',
    order: Number(row.order),
  }));
  const actual = manifestIn(this).entries.map((entry) => {
    const { id, ...photo } = entry.data.photo;
    assert.equal(id, entry.id, 'the entry names the photo it holds');
    assert.equal(entry.category, entry.data.category);
    return { ...entry.data, photo };
  });
  assert.deepEqual(actual, expected);
});

Then("the manifest's update time should be the time of this run", function () {
  const { updatedAt, version } = manifestIn(this);
  assert.equal(version, 1);
  assert.equal(new Date(updatedAt).toISOString(), updatedAt, 'an ISO time');
  assert.ok(Math.abs(Date.now() - Date.parse(updatedAt)) < 60_000, updatedAt);
});

Then('the public web bucket should hold no entry file and no manifest', function () {
  assert.deepEqual([...web(this).keys()].filter((key) => key.endsWith('.md') || key === MANIFEST_KEY), []);
});

Given('the entries already in the library folder are published to R2, which the tools now work with', async function () {
  await pushEntries({ contentDir: state(this).contentDir, storage: state(this).storage });
  state(this).sync = true;
});

Then('the public web bucket should hold every web size of the photo of {string}, its entry file and the manifest', async function (ref) {
  const [entry] = await entriesOf(this, ref);
  for (const key of [...config.photoKeys(entry.id).web, entryKey(entry.category, entry.id), MANIFEST_KEY]) assert.ok(web(this).has(key), `${key} is in the web bucket`);
  assert.equal(originals(this).has(entryKey(entry.category, entry.id)), false);
});
