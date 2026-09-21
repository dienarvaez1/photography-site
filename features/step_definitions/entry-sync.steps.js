import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { entryFile, findEntry, lib, readEntry, state } from '../support/photo-helpers.js';
import { ROOT } from '../support/lib.js';
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
  assert.deepEqual([...web(this).keys()].filter((key) => key.startsWith(`photos/${category}/`)), []);
});

Then('the entry {string} should be in R2 as its own .md file, identical to the local file', async function (ref) {
  const { category, photo } = await readEntry(this, ref);
  const object = web(this).get(`photos/${category}/${photo.id}.md`);
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
