import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import exifr from 'exifr';
import { entryFile, exifLib, findEntry, lib, makeJpeg, readEntry, state } from '../support/photo-helpers.js';

const orNull = (value) => (value === 'none' ? null : value);

// --- Pure formatting rules --------------------------------------------------

Then('the exposure time {string} should be shown as {string}', function (seconds, shown) {
  assert.equal(exifLib.formatShutterSpeed(Number(seconds)) ?? null, orNull(shown));
});

Then('the make {string} and model {string} should be named {string}', function (make, model, name) {
  assert.equal(exifLib.cameraName(make || undefined, model || undefined) ?? null, orNull(name));
});

/** "make=Canon;iso=100;focalLength=50" -> { make: 'Canon', iso: 100, focalLength: 50 } (numbers where numeric). */
function parseSettings(text) {
  return Object.fromEntries(
    text.split(';').map((pair) => {
      const [key, ...rest] = pair.split('=');
      const value = rest.join('=');
      return [key.trim(), /^\d+(\.\d+)?$/.test(value) ? Number(value) : value];
    })
  );
}

Then(/^the camera line for (.+) should be "(.*)"$/, function (settings, line) {
  assert.equal(exifLib.formatCamera(parseSettings(settings)) ?? null, orNull(line));
});

// --- Building photos with EXIF ---------------------------------------------

Given('a photo file {string} of {int}x{int} with EXIF:', async function (name, width, height, table) {
  await makeJpeg(this, name, width, height, { exif: table.rowsHash() });
});

Given('the photo file {string} is stored with EXIF orientation {int}', async function (name, orientation) {
  const spec = state(this).specs[name];
  assert.ok(spec, `No photo file ${name} to re-encode`);
  await makeJpeg(this, name, spec.width, spec.height, { exif: spec.exif, orientation });
});

// --- Assertions on entries ---------------------------------------------------

Then('the entry {string} should have the camera line {string}', async function (ref, line) {
  assert.equal((await readEntry(this, ref)).camera, line);
});

Then('the entry {string} should not have the field {string}', async function (ref, field) {
  assert.ok(!(field in (await readEntry(this, ref))), `${ref} should not have "${field}"`);
});

Then('the original stored in R2 should still contain its EXIF make {string}', async function (make) {
  const [object] = [...state(this).storage.objects.originals.values()];
  const exif = await exifr.parse(object.body, { pick: ['Make'] });
  assert.equal(exif?.Make, make);
});

// --- Editing entries the way a person (or an older version of the tool) would ----

async function rewrite(world, ref, change) {
  const entry = await findEntry(world, ref);
  assert.ok(entry, `No entry ${ref}`);
  await lib.writeEntry(entry.file, change({ ...entry.data }), entry.body);
}

Given('the entry {string} has its camera line edited by hand to {string}', async function (ref, camera) {
  await rewrite(this, ref, (data) => ({ ...data, camera }));
});

Given('the entry {string} has no camera line', async function (ref) {
  await rewrite(this, ref, ({ camera, ...rest }) => rest);
});

Given('the entry {string} has these leftover fields from an older version: {}', async function (ref, list) {
  // Written as raw text on purpose: the tool itself refuses to write these fields.
  const lines = { exif: 'exif:\n  model: "NIKON Z 7"', copyright: 'copyright: "© Someone"' };
  const file = await entryFile(this, ref);
  const extra = list.split(',').map((k) => lines[k.trim()]).join('\n');
  const text = await readFile(file, 'utf-8');
  await writeFile(file, text.replace(/\n---\n$/, `\n${extra}\n---\n`));
});

When('I remember the text of the entry {string}', async function (ref) {
  state(this).remembered = await readFile(await entryFile(this, ref), 'utf-8');
});

Then('the entry {string} should read exactly as remembered', async function (ref) {
  assert.equal(await readFile(await entryFile(this, ref), 'utf-8'), state(this).remembered);
});

// --- Filling in missing camera lines -----------------------------------------

When('I fill in the missing camera lines', async function () {
  state(this).fill = await lib.fillCameraLines({ contentDir: state(this).contentDir, storage: state(this).storage });
});

When('I fill in the missing camera line for only the entry {string}', async function (ref) {
  state(this).fill = await lib.fillCameraLines({
    contentDir: state(this).contentDir,
    storage: state(this).storage,
    entryFiles: [await entryFile(this, ref)],
  });
});

Then('filling should report {int} updated and {int} unchanged and no problems', function (updated, unchanged) {
  const { fill } = state(this);
  assert.deepEqual([fill.updated.length, fill.unchanged.length, fill.problems], [updated, unchanged, []]);
});

Then('filling should report a problem for {string} mentioning {string}', async function (ref, fragment) {
  const file = await entryFile(this, ref);
  const found = state(this).fill.problems.filter((p) => p.file === file && p.message.includes(fragment));
  assert.ok(found.length > 0, `No problem for ${ref} mentioning "${fragment}": ${JSON.stringify(state(this).fill.problems)}`);
});
