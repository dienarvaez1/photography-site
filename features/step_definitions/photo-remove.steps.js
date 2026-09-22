import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { config, lib, readEntry, state } from '../support/photo-helpers.js';
import { ROOT } from '../support/lib.js';
import { SITE, answer, send } from './photo-form.steps.js';

const { MANIFEST_KEY, entryKey } = await import(join(ROOT, 'src/config/photo-manifest.ts'));

const web = (world) => state(world).storage.objects.web;
const originals = (world) => state(world).storage.objects.originals;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The photo behind "<category>/<title slug>": its id, category, and the key its original is stored under. */
async function photoOf(world, ref) {
  const data = await readEntry(world, ref);
  return { ref, id: data.photo.id, category: data.category, key: config.photoKey(data.photo.id, 'original') };
}

const removeUrl = `${SITE}/__photos/remove`;
const postJson = (world, body) => send(world, 'POST', removeUrl, { body, origin: SITE, headers: { 'Content-Type': 'application/json' } });

// --- Asking for a removal ------------------------------------------------------------------------------------------------------

When('I ask the service to remove the photos: {string}', async function (list) {
  const photos = await Promise.all(list.split(', ').map((ref) => photoOf(this, ref)));
  // Remember every entry that uses these photos (a photo can be in two categories), for the assertions afterwards.
  const everyRef = {};
  for (const entry of await lib.listEntries(state(this).contentDir)) {
    const id = entry.data.photo?.id;
    if (!photos.some((p) => p.id === id)) continue;
    const ref = `${entry.data.category}/${lib.slugify(entry.data.title)}`;
    everyRef[ref] = { ref, id, category: entry.data.category, key: config.photoKey(id, 'original') };
  }
  state(this).removal = { photos: { ...state(this).removal?.photos, ...everyRef } };
  await postJson(this, JSON.stringify({ photos: photos.map(({ id, key }) => ({ id, key })) }));
});

When('I ask the service to remove the orphan original {string}', async function (key) {
  const id = /^photos\/([0-9a-f]{16})\//.exec(key)[1];
  await postJson(this, JSON.stringify({ photos: [{ id, key }] }));
});

When('I ask the service to remove the orphan original of the earlier photo {string}', async function (ref) {
  const { id, key } = state(this).removal.photos[ref];
  await postJson(this, JSON.stringify({ photos: [{ id, key }] }));
});

When('I send this removal request to the service:', async function (text) {
  let body = text;
  for (const [, ref] of text.matchAll(/<id of ([^>]+)>/g)) body = body.replaceAll(`<id of ${ref}>`, (await photoOf(this, ref)).id);
  await postJson(this, body);
});

When('I send a removal request naming {int} photos', async function (count) {
  const photos = Array.from({ length: count }, (_, i) => {
    const id = i.toString(16).padStart(16, '0');
    return { id, key: `photos/${id}/original.jpg` };
  });
  await postJson(this, JSON.stringify({ photos }));
});

// --- Setting the scene -----------------------------------------------------------------------------------------------------------

Given('I take note of everything in R2', function () {
  state(this).snapshot = snapshot(this);
});

function snapshot(world) {
  const of = (map) => Object.fromEntries([...map].map(([key, object]) => [key, hash(object.body)]).sort());
  return { originals: of(originals(world)), web: of(web(world)) };
}

Given('the buckets also hold the files of a photo whose id differs from the one of {string} by its last character', async function (ref) {
  const { id } = await photoOf(this, ref);
  const twin = `${id.slice(0, 15)}${id.endsWith('0') ? '1' : '0'}`;
  originals(this).set(config.photoKey(twin, 'original'), { body: Buffer.from(`original of ${twin}`), contentType: 'image/jpeg' });
  for (const key of config.photoKeys(twin).web) web(this).set(key, { body: Buffer.from(key), contentType: 'image/webp' });
  state(this).twin = twin;
});

Given('the buckets also hold these unrelated files:', function (table) {
  state(this).unrelated = table.hashes().map(({ bucket, key }) => ({ bucket, key }));
  for (const { bucket, key } of state(this).unrelated) (bucket === 'web' ? web(this) : originals(this)).set(key, { body: Buffer.from(`unrelated ${key}`), contentType: 'application/octet-stream' });
});

Given('the originals bucket also holds an original that no entry uses: {string}', function (key) {
  originals(this).set(key, { body: Buffer.from('an original nobody lists'), contentType: 'image/png' });
});

Given('R2 will fail to delete anything matching the photo id of {string}', async function (ref) {
  // only the photo's own files (photos/<id>/...), not its entry file, which is unpublished before any file goes
  state(this).storage.faults.failDeleteMatching = `photos/${(await photoOf(this, ref)).id}/`;
});

// --- What the service answered ---------------------------------------------------------------------------------------------------

const resultFor = (world, ref) => {
  const { id } = state(world).removal.photos[ref];
  const result = answer(world).body.results.find((r) => r.id === id);
  assert.ok(result, `the answer has a result for ${ref}`);
  return result;
};

Then('the service should report {int} files deleted for {string}', function (count, ref) {
  const result = resultFor(this, ref);
  assert.equal(result.error, undefined, result.error);
  const { id } = state(this).removal.photos[ref];
  assert.equal(result.deleted.length, count);
  assert.deepEqual([...result.deleted].sort(), [config.photoKey(id, 'original'), ...config.photoKeys(id).web].sort());
});

Then('the service should report entries removed from {string} for {string}', function (categories, ref) {
  assert.deepEqual([...resultFor(this, ref).entries].sort(), categories.split(', ').sort());
});

Then('the service should report a failure for {string} mentioning {string}', function (ref, fragment) {
  assert.ok(resultFor(this, ref).error?.includes(fragment), JSON.stringify(resultFor(this, ref)));
});

// --- What R2 holds afterwards ----------------------------------------------------------------------------------------------------

Then('nothing of the photos {string} should be left in R2', function (list) {
  const manifest = JSON.parse(web(this).get(MANIFEST_KEY).body.toString('utf-8'));
  for (const ref of list.split(', ')) {
    const { id, category } = state(this).removal.photos[ref];
    assert.deepEqual([...originals(this).keys()].filter((key) => key.includes(id)), [], `${ref}: originals bucket`);
    assert.deepEqual([...web(this).keys()].filter((key) => key.includes(id)), [], `${ref}: web bucket`);
    assert.equal(web(this).has(entryKey(category, id)), false);
    assert.equal(manifest.entries.some((e) => e.id === id), false, `${ref}: manifest`);
  }
});

Then('the photos {string} should be completely untouched in R2', async function (list) {
  const manifest = JSON.parse(web(this).get(MANIFEST_KEY).body.toString('utf-8'));
  for (const ref of list.split(', ')) {
    const { id, category, key } = await photoOf(this, ref);
    assert.ok(originals(this).has(key), `${ref}: the original`);
    for (const size of config.photoKeys(id).web) assert.ok(web(this).has(size), `${ref}: ${size}`);
    assert.ok(web(this).has(entryKey(category, id)), `${ref}: the entry file`);
    assert.ok(manifest.entries.some((e) => e.id === id && e.category === category), `${ref}: the manifest entry`);
  }
});

Then('the look-alike photo should be completely untouched in R2', function () {
  const { twin } = state(this);
  assert.ok(originals(this).has(config.photoKey(twin, 'original')));
  for (const key of config.photoKeys(twin).web) assert.ok(web(this).has(key), key);
});

Then('the unrelated files should all still be in R2', function () {
  for (const { bucket, key } of state(this).unrelated) assert.ok((bucket === 'web' ? web(this) : originals(this)).has(key), `${bucket}: ${key}`);
});

Then('R2 should no longer hold {string} in the originals bucket', function (key) {
  assert.equal(originals(this).has(key), false);
});

Then('R2 should hold exactly what it held before', function () {
  assert.deepEqual(snapshot(this), state(this).snapshot);
});

// --- The order of things ---------------------------------------------------------------------------------------------------------

Then('the manifest should have been written {int} time(s) since', function (count) {
  const seen = state(this).storage.events.slice(state(this).mark ?? 0);
  assert.equal(seen.filter((e) => e === `web: put ${MANIFEST_KEY}`).length, count, seen.join('\n'));
});

Then('the manifest should have been published before any file of the removed photos was deleted', function () {
  const seen = state(this).storage.events.slice(state(this).mark ?? 0);
  const manifest = seen.findIndex((e) => e === `web: put ${MANIFEST_KEY}`);
  const firstDelete = seen.findIndex((e) => /: delete photos\/[0-9a-f]{16}\//.test(e));
  assert.ok(manifest >= 0 && firstDelete >= 0, seen.join('\n'));
  assert.ok(manifest < firstDelete, `the manifest (#${manifest}) must come before the first deleted photo file (#${firstDelete}):\n${seen.join('\n')}`);
});
