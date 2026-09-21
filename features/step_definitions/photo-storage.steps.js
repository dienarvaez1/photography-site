import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { copyFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { config, createLibrary, entryFile, findEntry, lib, makeJpeg, readEntry, removeLibrary, sourcePath, state } from '../support/photo-helpers.js';

After(async function () {
  await removeLibrary(this);
});

Given('an empty photo library and a fake R2', async function () {
  await createLibrary(this);
});

Given('a photo file {string} of {int}x{int}', async function (name, width, height) {
  await makeJpeg(this, name, width, height);
});

Given('a photo file {string} of {int}x{int} stored with EXIF orientation {int}', async function (name, width, height, orientation) {
  await makeJpeg(this, name, width, height, { orientation });
});

Given('a copy of {string} named {string}', async function (from, to) {
  await copyFile(sourcePath(this, from), sourcePath(this, to));
});

Given('R2 will fail to store anything matching {string}', function (fragment) {
  state(this).storage.faults.failPutMatching = fragment;
});

Given('R2 will return corrupted originals', function () {
  state(this).storage.faults.corruptOriginals = true;
});

Given('an entry {string} with no photo id', async function (ref) {
  const [category, slug] = ref.split('/');
  await lib.writeEntry(join(state(this).contentDir, category, 'images', `${slug}.md`), { title: 'Legacy', category, featured: false, order: 0 });
});

// --- add / replace / remove -------------------------------------------------

/** Parses the optional trailing clauses of the "add" steps. */
function addOptions(rest) {
  const grab = (re) => rest.match(re)?.[1];
  return {
    titleEs: grab(/and the Spanish title "([^"]+)"/),
    camera: grab(/and camera "([^"]+)"/),
    order: grab(/and order (\d+)/) ? Number(grab(/and order (\d+)/)) : 0,
    keepSource: /and the option to keep the source/.test(rest),
  };
}

async function add(world, file, category, title, rest) {
  return lib.addPhoto({
    source: sourcePath(world, file),
    category,
    title,
    ...addOptions(rest ?? ''),
    contentDir: state(world).contentDir,
    storage: state(world).storage,
  });
}

When(/^I add "([^"]+)" to the category "([^"]+)" with the title "([^"]+)"(.*)$/, async function (file, category, title, rest) {
  await add(this, file, category, title, rest);
});

Given(/^I have added "([^"]+)" to the category "([^"]+)" with the title "([^"]+)"(.*)$/, async function (file, category, title, rest) {
  await add(this, file, category, title, rest);
});

When(/^I try to add "([^"]+)" to the category "([^"]+)" with the title "([^"]+)"(.*)$/, async function (file, category, title, rest) {
  try {
    await add(this, file, category, title, rest);
    this.data.photos.error = null;
  } catch (error) {
    this.data.photos.error = error;
  }
});

async function replace(world, ref, file, camera) {
  await lib.replacePhoto({
    entryFile: await entryFile(world, ref),
    source: sourcePath(world, file),
    camera,
    contentDir: state(world).contentDir,
    storage: state(world).storage,
  });
}

When('I replace the photo of {string} with {string}', async function (ref, file) {
  await replace(this, ref, file);
});

When('I replace the photo of {string} with {string} and camera {string}', async function (ref, file, camera) {
  await replace(this, ref, file, camera);
});

When('I try to replace the photo of {string} with {string}', async function (ref, file) {
  try {
    await replace(this, ref, file);
    this.data.photos.error = null;
  } catch (error) {
    this.data.photos.error = error;
  }
});

When('I remove the entry {string}', async function (ref) {
  await lib.removePhoto({ entryFile: await entryFile(this, ref), contentDir: state(this).contentDir, storage: state(this).storage });
});

// --- verify / sync ----------------------------------------------------------

When('I verify the library', async function () {
  state(this).verify = await lib.verifyPhotos({ contentDir: state(this).contentDir, storage: state(this).storage });
});

When('I verify the library deeply', async function () {
  state(this).verify = await lib.verifyPhotos({ contentDir: state(this).contentDir, storage: state(this).storage, deep: true });
});

When('I sync the library', async function () {
  state(this).sync = await lib.syncPhotos({ contentDir: state(this).contentDir, storage: state(this).storage });
});

async function onlyEntry(world) {
  const entries = await lib.listEntries(state(world).contentDir);
  assert.equal(entries.length, 1, 'Expected exactly one entry');
  return entries[0].data;
}

Given('the {string} size disappears from R2', async function (variant) {
  const { photo } = await onlyEntry(this);
  state(this).storage.objects.web.delete(config.photoKey(photo.id, variant));
});

Given('the original disappears from R2', async function () {
  const { photo } = await onlyEntry(this);
  state(this).storage.objects.originals.delete(config.photoKey(photo.id, 'original'));
});

// --- assertions: entries ------------------------------------------------------

Then('the entry {string} should reference a photo of {int}x{int} with a 16-character content id', async function (ref, width, height) {
  const { photo } = await readEntry(this, ref);
  assert.match(photo.id, config.PHOTO_ID_PATTERN);
  assert.deepEqual([photo.width, photo.height], [width, height]);
});

Then('the entry {string} should have the title {string} and the Spanish title {string}', async function (ref, title, es) {
  const data = await readEntry(this, ref);
  assert.equal(data.title, title);
  assert.equal(data.titles?.es, es);
});

Then('the entry {string} should exist', async function (ref) {
  assert.ok(await findEntry(this, ref), `${ref} should exist`);
});

Then('the entry {string} should not exist', async function (ref) {
  assert.equal(await findEntry(this, ref), undefined, `${ref} should not exist`);
});

Then('no entry should exist', async function () {
  assert.deepEqual((await lib.listEntries(state(this).contentDir)).map((e) => e.file), []);
});

Then('the entry {string} should be stored as {string} named after its photo id', async function (ref, folder) {
  const entry = await findEntry(this, ref);
  assert.ok(entry, `${ref} should exist`);
  assert.equal(entry.file, join(state(this).contentDir, folder, `${entry.data.photo.id}.md`));
});

Then('the entry {string} should still have order {int}', async function (ref, order) {
  assert.equal((await readEntry(this, ref)).order, order);
});

Then('the entries {string} and {string} should reference the same photo', async function (a, b) {
  assert.equal((await readEntry(this, a)).photo.id, (await readEntry(this, b)).photo.id);
});

Then('the entries {string} and {string} should reference different photos', async function (a, b) {
  assert.notEqual((await readEntry(this, a)).photo.id, (await readEntry(this, b)).photo.id);
});

Then('the entry {string} should not contain {string}', async function (ref, fragment) {
  const text = await readFile(await entryFile(this, ref), 'utf-8');
  assert.ok(!text.toLowerCase().includes(fragment.toLowerCase()), `${ref} must not contain "${fragment}"`);
});

Then('the entry {string} should only have these fields: {}', async function (ref, list) {
  const expected = list.split(',').map((k) => k.trim()).sort();
  assert.deepEqual(Object.keys(await readEntry(this, ref)).sort(), expected);
});

Then('the entry {string} should look like this, with the id filled in:', async function (ref, expected) {
  const { photo } = await readEntry(this, ref);
  const actual = await readFile(await entryFile(this, ref), 'utf-8');
  assert.equal(actual.trimEnd(), expected.replace('<id>', photo.id).trimEnd());
});

Then('the category folder {string} should contain only the folder {string}', async function (category, folder) {
  const entries = await readdir(join(state(this).contentDir, category), { withFileTypes: true });
  assert.deepEqual(entries.map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`), [`${folder}/`]);
});

Then('the folder {string} should contain exactly {int} entry file(s), each named after its photo id', async function (folder, count) {
  const dir = join(state(this).contentDir, folder);
  const files = existsSync(dir) ? await readdir(dir) : [];
  assert.equal(files.length, count, `${folder} contains: ${files.join(', ')}`);
  for (const file of files) {
    const { photo } = (await lib.listEntries(dir)).find((e) => e.file.endsWith(`/${file}`)).data;
    assert.equal(file, `${photo.id}.md`, `${file} must be named after its photo id`);
  }
});

Then('the folder {string} should contain no files', async function (folder) {
  const dir = join(state(this).contentDir, folder);
  assert.deepEqual(existsSync(dir) ? await readdir(dir) : [], []);
});

Then('the title {string} should match the reference {string}', function (title, reference) {
  assert.equal(lib.slugify(title), lib.slugify(reference));
});

// --- assertions: R2 and local files -------------------------------------------

Then('the private originals bucket should hold exactly the original of that photo', async function () {
  const { photo } = await onlyEntry(this);
  const { originals } = state(this).storage.objects;
  assert.deepEqual([...originals.keys()], [config.photoKey(photo.id, 'original')]);
  assert.equal([...originals.values()][0].contentType, 'image/jpeg');
});

Then('the public web bucket should hold exactly every web size of that photo', async function () {
  const { photo } = await onlyEntry(this);
  const { web } = state(this).storage.objects;
  assert.deepEqual([...web.keys()].sort(), Object.keys(config.PHOTO_VARIANTS).map((v) => config.photoKey(photo.id, v)).sort());
  for (const object of web.values()) assert.equal(object.contentType, 'image/webp');
});

Then('all uploaded objects should be cacheable forever', function () {
  const { originals, web } = state(this).storage.objects;
  for (const object of [...originals.values(), ...web.values()]) assert.match(object.cacheControl, /immutable/);
});

Then('the local file {string} should be gone', function (name) {
  assert.ok(!existsSync(sourcePath(this, name)), `${name} should have been deleted after a verified upload`);
});

Then('the local file {string} should still exist', function (name) {
  assert.ok(existsSync(sourcePath(this, name)), `${name} must not be deleted`);
});

Then('the private originals bucket should hold {int} object(s)', function (count) {
  assert.equal(state(this).storage.objects.originals.size, count);
});

Then('the public web bucket should hold the web sizes of {int} photo(s)', function (photos) {
  assert.equal(state(this).storage.objects.web.size, photos * Object.keys(config.PHOTO_VARIANTS).length);
});

async function storedSize(world, variant) {
  const { photo } = await onlyEntry(world);
  const object = state(world).storage.objects.web.get(config.photoKey(photo.id, variant));
  const { width, height } = await sharp(object.body).metadata();
  return { width, height };
}

Then('the stored {string} size should be {int}x{int}', async function (variant, width, height) {
  assert.deepEqual(await storedSize(this, variant), { width, height });
});

Then('the stored sizes should match the sizes the site computes for the entry', async function () {
  const { photo } = await onlyEntry(this);
  for (const variant of Object.keys(config.PHOTO_VARIANTS)) {
    assert.deepEqual(await storedSize(this, variant), config.variantSize(photo, variant), `${variant} size differs from what the site puts in <img width height>`);
  }
});

Then('the attempt should fail saying the entry already exists', function () {
  assert.match(state(this).error?.message ?? '', /already exists/);
});

Then('the attempt should fail', function () {
  assert.ok(state(this).error, 'Expected the attempt to fail');
});

async function idsOf(world, refs) {
  return new Set(await Promise.all(refs.map(async (r) => (await readEntry(world, r)).photo.id)));
}

function assertAllObjectsBelongTo(world, ids) {
  const { originals, web } = state(world).storage.objects;
  for (const key of [...originals.keys(), ...web.keys()]) {
    assert.ok([...ids].some((id) => key.startsWith(`photos/${id}/`)), `${key} does not belong to any remaining entry`);
  }
}

Then('the stored objects should all belong to the entry {string}', async function (ref) {
  assertAllObjectsBelongTo(this, await idsOf(this, [ref]));
});

Then('the stored objects should all belong to the entries {string} and {string}', async function (a, b) {
  assertAllObjectsBelongTo(this, await idsOf(this, [a, b]));
});

// --- assertions: verify / sync -----------------------------------------------

Then('verification should report no problems', function () {
  assert.deepEqual(state(this).verify.problems, []);
});

Then('verification should report a problem for {string} mentioning {string}', async function (ref, fragment) {
  const file = await entryFile(this, ref);
  const found = state(this).verify.problems.filter((p) => p.file === file && p.message.includes(fragment));
  assert.ok(found.length > 0, `No problem for ${ref} mentioning "${fragment}": ${JSON.stringify(state(this).verify.problems)}`);
});

Then('sync should report {int} repaired entry and no problems', function (count) {
  assert.equal(state(this).sync.repaired.length, count);
  assert.deepEqual(state(this).sync.problems, []);
});

Then('sync should report a problem for {string} mentioning {string}', async function (ref, fragment) {
  const file = await entryFile(this, ref);
  const found = state(this).sync.problems.filter((p) => p.file === file && p.message.includes(fragment));
  assert.ok(found.length > 0, `No problem for ${ref}: ${JSON.stringify(state(this).sync.problems)}`);
});
