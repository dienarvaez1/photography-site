import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { ROOT } from '../support/lib.js';
import { createMemoryStorage } from '../support/memory-storage.js';

const lib = await import(join(ROOT, 'scripts/lib/photos.mjs'));
const config = await import(join(ROOT, 'src/config/photos.ts'));

After(async function () {
  if (this.data.photos?.dir) await rm(this.data.photos.dir, { recursive: true, force: true });
});

const state = (world) => world.data.photos;
const entryPath = (world, relative) => join(state(world).contentDir, relative);
const sourcePath = (world, name) => join(state(world).filesDir, name);
const readEntry = async (world, relative) => matter(await readFile(entryPath(world, relative), 'utf-8')).data;

/** Deterministic distinct colour per file name, so different names give different bytes. */
function colourFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 };
}

async function makeJpeg(world, name, width, height, orientation) {
  let image = sharp({ create: { width, height, channels: 3, background: colourFor(name) } }).jpeg();
  if (orientation) image = image.withMetadata({ orientation });
  await image.toFile(sourcePath(world, name));
}

Given('an empty photo library and a fake R2', async function () {
  const dir = await mkdtemp(join(tmpdir(), 'photo-lib-'));
  const contentDir = join(dir, 'content');
  const filesDir = join(dir, 'files');
  await mkdir(contentDir);
  await mkdir(filesDir);
  this.data.photos = { dir, contentDir, filesDir, storage: createMemoryStorage() };
});

Given('a photo file {string} of {int}x{int}', async function (name, width, height) {
  await makeJpeg(this, name, width, height);
});

Given('a photo file {string} of {int}x{int} stored with EXIF orientation {int}', async function (name, width, height, orientation) {
  await makeJpeg(this, name, width, height, orientation);
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

Given('an entry {string} with no photo id', async function (relative) {
  await lib.writeEntry(entryPath(this, relative), { title: 'Legacy', category: 'nature', featured: false, order: 0 });
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

async function findEntryFile(world, slug) {
  const entry = (await lib.listEntries(state(world).contentDir)).find((e) => e.file.endsWith(`/${slug}.md`));
  assert.ok(entry, `No entry named ${slug}`);
  return entry.file;
}

When('I replace the photo of {string} with {string}', async function (slug, file) {
  await lib.replacePhoto({
    entryFile: await findEntryFile(this, slug),
    source: sourcePath(this, file),
    contentDir: state(this).contentDir,
    storage: state(this).storage,
  });
});

When('I remove the entry {string}', async function (slug) {
  await lib.removePhoto({ entryFile: await findEntryFile(this, slug), contentDir: state(this).contentDir, storage: state(this).storage });
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

// --- assertions -------------------------------------------------------------

Then('the entry {string} should reference a photo of {int}x{int} with a 16-character content id', async function (relative, width, height) {
  const { photo } = await readEntry(this, relative);
  assert.match(photo.id, config.PHOTO_ID_PATTERN);
  assert.deepEqual([photo.width, photo.height], [width, height]);
});

Then('the entry {string} should have the title {string} and the Spanish title {string}', async function (relative, title, es) {
  const data = await readEntry(this, relative);
  assert.equal(data.title, title);
  assert.equal(data.titles?.es, es);
});

Then('the entry {string} should exist', function (relative) {
  assert.ok(existsSync(entryPath(this, relative)), `${relative} should exist`);
});

Then('no entry should exist', async function () {
  assert.deepEqual((await lib.listEntries(state(this).contentDir)).map((e) => e.file), []);
});

Then('the entry {string} should still have order {int}', async function (relative, order) {
  assert.equal((await readEntry(this, relative)).order, order);
});

Then('the entries {string} and {string} should reference the same photo', async function (a, b) {
  assert.equal((await readEntry(this, a)).photo.id, (await readEntry(this, b)).photo.id);
});

Then('the private originals bucket should hold exactly the original of that photo', async function () {
  const { photo } = await onlyEntry(this);
  const { originals } = state(this).storage.objects;
  assert.deepEqual([...originals.keys()], [config.photoKey(photo.id, 'original')]);
  assert.equal([...originals.values()][0].contentType, 'image/jpeg');
});

Then('the public web bucket should hold exactly the thumb, cover and full sizes of that photo', async function () {
  const { photo } = await onlyEntry(this);
  const { web } = state(this).storage.objects;
  assert.deepEqual([...web.keys()].sort(), ['cover', 'full', 'thumb'].map((v) => config.photoKey(photo.id, v)).sort());
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

Then('the public web bucket should hold {int} object(s)', function (count) {
  assert.equal(state(this).storage.objects.web.size, count);
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

Then('the title {string} should become the file name {string}', function (title, slug) {
  assert.equal(lib.slugify(title), slug);
});

Then('the attempt should fail saying the entry already exists', function () {
  assert.match(state(this).error?.message ?? '', /already exists/);
});

Then('the attempt should fail', function () {
  assert.ok(state(this).error, 'Expected the attempt to fail');
});

async function idsOf(world, relatives) {
  return new Set(await Promise.all(relatives.map(async (r) => (await readEntry(world, r)).photo.id)));
}

function assertAllObjectsBelongTo(world, ids) {
  const { originals, web } = state(world).storage.objects;
  for (const key of [...originals.keys(), ...web.keys()]) {
    assert.ok([...ids].some((id) => key.startsWith(`photos/${id}/`)), `${key} does not belong to any remaining entry`);
  }
}

Then('the stored objects should all belong to the entry {string}', async function (relative) {
  assertAllObjectsBelongTo(this, await idsOf(this, [relative]));
});

Then('the stored objects should all belong to the entries {string} and {string}', async function (a, b) {
  assertAllObjectsBelongTo(this, await idsOf(this, [a, b]));
});

Then('verification should report no problems', function () {
  assert.deepEqual(state(this).verify.problems, []);
});

Then('verification should report a problem for {string} mentioning {string}', function (relative, fragment) {
  const found = state(this).verify.problems.filter((p) => p.file.endsWith(`/${relative}`) && p.message.includes(fragment));
  assert.ok(found.length > 0, `No problem for ${relative} mentioning "${fragment}": ${JSON.stringify(state(this).verify.problems)}`);
});

Then('sync should report {int} repaired entry and no problems', function (count) {
  assert.equal(state(this).sync.repaired.length, count);
  assert.deepEqual(state(this).sync.problems, []);
});

Then('sync should report a problem for {string} mentioning {string}', function (relative, fragment) {
  const found = state(this).sync.problems.filter((p) => p.file.endsWith(`/${relative}`) && p.message.includes(fragment));
  assert.ok(found.length > 0, `No problem for ${relative}: ${JSON.stringify(state(this).sync.problems)}`);
});

Then('the entry {string} should look like this, with the id filled in:', async function (relative, expected) {
  const { photo } = await readEntry(this, relative);
  const actual = await readFile(entryPath(this, relative), 'utf-8');
  assert.equal(actual.trimEnd(), expected.replace('<id>', photo.id).trimEnd());
});

Then('the entry {string} should not contain {string}', async function (relative, fragment) {
  assert.ok(!(await readFile(entryPath(this, relative), 'utf-8')).includes(fragment));
});
