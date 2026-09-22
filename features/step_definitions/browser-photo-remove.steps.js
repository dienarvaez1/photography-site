import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config, state } from '../support/photo-helpers.js';
import { CONTENT_DIR, ROOT } from '../support/lib.js';
import { pushEntries } from '../../scripts/lib/entry-sync.mjs';
import { setUpOriginals } from '../support/browser.js';

const { MANIFEST_KEY, entryKey } = await import(join(ROOT, 'src/config/photo-manifest.ts'));

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-pics-viewer');
const bar = (world) => panel(world).locator('[data-remove-bar]');
const web = (world) => state(world).storage.objects.web;
const originals = (world) => state(world).storage.objects.originals;
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(check, describe, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const result = await check();
      if (result !== false) return result;
      last = new Error('not yet');
    } catch (error) {
      last = error;
    }
    if (Date.now() > end) throw new Error(`${describe}: ${last?.message ?? last}`);
    await settle(100);
  }
}

/** The sample library's entry file for a photo id: { file, category }. */
function fixtureEntry(id) {
  for (const category of readdirSync(CONTENT_DIR)) {
    const file = join(CONTENT_DIR, category, 'images', `${id}.md`);
    try {
      readdirSync(dirname(file));
      if (readdirSync(dirname(file)).includes(`${id}.md`)) return { file, category };
    } catch {
      // not in this category
    }
  }
  throw new Error(`no sample entry for ${id}`);
}

// --- Setting the scene -----------------------------------------------------------------------------------------------------------

Given('the buckets hold these photos, shared by the Pics Viewer and the photo service:', async function (table) {
  const s = state(this);
  s.seeded = {};
  for (const { 'photo id': id, 'on the site': onSite } of table.hashes()) {
    originals(this).set(config.photoKey(id, 'original'), { body: Buffer.from(`original of ${id}`), contentType: 'image/jpeg', uploaded: new Date('2026-09-01T12:00:00Z') });
    if (onSite === 'yes') {
      const { file, category } = fixtureEntry(id);
      const target = join(s.contentDir, category, 'images', `${id}.md`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
      for (const key of config.photoKeys(id).web) web(this).set(key, { body: Buffer.from(key), contentType: 'image/webp' });
      s.seeded[id] = { category, entry: true };
    } else {
      s.seeded[id] = { entry: false };
    }
  }
  s.sync = true;
  await pushEntries({ contentDir: s.contentDir, storage: s.storage }); // the entry files and the manifest, as the tools would publish them
  // The Pics Viewer's API lists these very originals.
  setUpOriginals(this, [], { objects: originals(this) });
});

Given('R2 will fail to delete the files of the photo id {string}', function (id) {
  state(this).storage.faults.failDeleteMatching = `photos/${id}/`;
});

// --- The checkboxes and the bar -------------------------------------------------------------------------------------------------

const row = (world, text) => panel(world).locator('.pic', { hasText: text }).first();

Then('the Pics Viewer should show a checkbox on each of its {int} photos, none ticked', async function (count) {
  await eventually(async () => (await panel(this).locator('.pic-check').count()) === count, `${count} checkboxes`);
  assert.equal(await panel(this).locator('.pics-list .pic').count(), count);
  assert.equal(await panel(this).locator('.pic-check:checked').count(), 0);
});

Then('the checkbox of {string} should be named {string}', async function (title, name) {
  assert.equal(await row(this, title).locator('.pic-check').getAttribute('aria-label'), name);
});

Then('the removal bar should say {string}', async function (text) {
  await eventually(async () => (await bar(this).innerText()).includes(text), `the bar says "${text}"`);
});

Then('the removal bar should ask: {string}', async function (text) {
  await eventually(async () => (await bar(this).locator('.pics-remove-warning').innerText()).includes(text), `the bar asks "${text}"`);
});

Then('the removal bar should offer {string}, {string} \\(disabled) and {string}', async function (a, b, c) {
  await bar(this).waitFor({ state: 'visible', timeout: 8000 });
  const buttons = await bar(this).locator('button').evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent.trim(), disabled: n.disabled })));
  assert.deepEqual(buttons, [{ text: a, disabled: false }, { text: b, disabled: true }, { text: c, disabled: false }]);
});

Then('the removal bar should offer {string}, {string} and {string}', async function (a, b, c) {
  await bar(this).waitFor({ state: 'visible', timeout: 8000 });
  assert.deepEqual(await bar(this).locator('button').allInnerTexts(), [a, b, c]);
});

Then('the removal bar should offer {string} and {string}', async function (a, b) {
  await bar(this).waitFor({ state: 'visible', timeout: 8000 });
  assert.deepEqual(await bar(this).locator('button').allInnerTexts(), [a, b]);
});

Then('the button {string} of the removal bar should be enabled', async function (name) {
  assert.equal(await bar(this).getByRole('button', { name, exact: true }).isDisabled(), false);
});

Then('the button {string} of the removal bar should be disabled', async function (name) {
  assert.equal(await bar(this).getByRole('button', { name, exact: true }).isDisabled(), true);
});

Then('the {string} button should be pressed', async function (name) {
  assert.equal(await panel(this).getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
});

Then("keyboard focus should be on the first photo's checkbox", async function () {
  await eventually(async () => (await page(this).evaluate(() => document.activeElement?.classList.contains('pic-check'))) === true, 'focus on a checkbox');
  assert.equal(await page(this).evaluate(() => document.activeElement === document.querySelector('.pic-check')), true);
});

Then('every checkbox and every button of the removal bar should be in the tab order and at least 44 pixels tall', async function () {
  const boxes = await panel(this).locator('.pic-check').evaluateAll((nodes) => nodes.map((n) => ({ tabIndex: n.tabIndex, disabled: n.disabled, height: n.closest('label').getBoundingClientRect().height, width: n.closest('label').getBoundingClientRect().width })));
  const buttons = await bar(this).locator('button:not(:disabled)').evaluateAll((nodes) => nodes.map((n) => ({ tabIndex: n.tabIndex, disabled: n.disabled, height: n.getBoundingClientRect().height, width: n.getBoundingClientRect().width })));
  assert.equal(boxes.length, 4);
  assert.ok(buttons.length >= 2);
  for (const item of [...boxes, ...buttons]) assert.ok(item.tabIndex >= 0 && item.height >= 44 && item.width >= 44, JSON.stringify(item));
});

When('I tick the photo {string}', async function (text) {
  await row(this, text).locator('.pic-check').check();
});

Then('the photo {string} should be ticked', async function (text) {
  assert.equal(await row(this, text).locator('.pic-check').isChecked(), true);
});

Then('every photo should be ticked', async function () {
  assert.equal(await panel(this).locator('.pic-check:not(:checked)').count(), 0);
  assert.equal(await panel(this).locator('.pic-check:checked').count(), 4);
});

Then('no photo should be ticked', async function () {
  assert.equal(await panel(this).locator('.pic-check:checked').count(), 0);
});

// --- Confirming ---------------------------------------------------------------------------------------------------------------------

Then('the confirmation should name exactly: {string}', async function (list) {
  // The names are separated by ", " in the feature and each name holds its own id in brackets, so compare them joined.
  const shown = await bar(this).locator('.pics-remove-named li').allInnerTexts();
  assert.equal(shown.join(' | '), list.replaceAll('), ', ') | '));
});

When(/^I (click|press) back out of the confirmation$/, async function (way) {
  if (way === 'click') await bar(this).getByRole('button', { name: 'Keep them', exact: true }).click();
  else await page(this).keyboard.press('Escape');
});

Then('nothing should have been deleted from R2', function () {
  for (const [id, { entry }] of Object.entries(state(this).seeded)) {
    assert.ok(originals(this).has(config.photoKey(id, 'original')), `the original of ${id}`);
    if (entry) for (const key of config.photoKeys(id).web) assert.ok(web(this).has(key), key);
  }
  assert.ok(!state(this).storage.events.some((e) => e.includes(': delete ')), state(this).storage.events.join('\n'));
});

// --- After deleting ------------------------------------------------------------------------------------------------------------------

Then('nothing of the photo ids {string} should be left in R2', async function (list) {
  const manifest = () => JSON.parse(web(this).get(MANIFEST_KEY).body.toString('utf-8'));
  await eventually(() => list.split(', ').every((id) => ![...originals(this).keys(), ...web(this).keys()].some((key) => key.includes(id))), 'the files are gone');
  for (const id of list.split(', ')) {
    assert.equal(manifest().entries.some((e) => e.id === id), false, `${id} is in the manifest`);
    const { category, entry } = state(this).seeded[id];
    if (entry) assert.equal(web(this).has(entryKey(category, id)), false, `${id}: entry file`);
  }
});

Then('the photo ids {string} should be completely untouched in R2', function (list) {
  const manifest = JSON.parse(web(this).get(MANIFEST_KEY).body.toString('utf-8'));
  for (const id of list.split(', ')) {
    const { category, entry } = state(this).seeded[id];
    assert.ok(originals(this).has(config.photoKey(id, 'original')), `${id}: the original`);
    if (entry) {
      for (const key of config.photoKeys(id).web) assert.ok(web(this).has(key), `${id}: ${key}`);
      assert.ok(web(this).has(entryKey(category, id)), `${id}: the entry file`);
      assert.ok(manifest.entries.some((e) => e.id === id), `${id}: the manifest entry`);
    }
  }
});

// --- Quality --------------------------------------------------------------------------------------------------------------------------

When('I show the removal in its {string} state', async function (name) {
  const field = panel(this).locator('#pics-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'not available') {
    this.b.photoService = null;
    await panel(this).getByRole('button', { name: 'Remove Photos', exact: true }).click();
    await panel(this).getByText('only works while the site runs on your computer', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });
    return;
  }
  await panel(this).getByRole('button', { name: 'Remove Photos', exact: true }).click();
  await bar(this).waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'choosing') return;
  await row(this, 'Half Moon').locator('.pic-check').check();
  await row(this, 'Orion Nebula').locator('.pic-check').check();
  if (name === 'photos ticked') return;
  await bar(this).getByRole('button', { name: 'Delete selected', exact: true }).click();
  await bar(this).locator('.pics-remove-warning').waitFor({ state: 'visible', timeout: 8000 });
});

Then('every button and checkbox of the removal should be entirely inside the screen', async function () {
  const viewport = page(this).viewportSize();
  const boxes = await panel(this).locator('[data-remove-bar] button, .pic-check').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  assert.ok(boxes.length >= 3);
  for (const box of boxes) assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify(box));
});

// --- A long list --------------------------------------------------------------------------------------------------------------------

Given('the buckets also hold {int} more photos the site does not list', function (count) {
  for (let i = 1; i <= count; i++) {
    const id = i.toString(16).padStart(16, '0');
    originals(this).set(config.photoKey(id, 'original'), { body: Buffer.from(`original of ${id}`), contentType: 'image/jpeg', uploaded: new Date('2026-09-01T12:00:00Z') });
    state(this).seeded[id] = { entry: false };
  }
});

Then('{int} photos should be ticked', async function (count) {
  assert.equal(await panel(this).locator('.pic-check:checked').count(), count);
});

Then('every photo should be ticked in a list of {int}', async function (count) {
  assert.equal(await panel(this).locator('.pic-check').count(), count);
  assert.equal(await panel(this).locator('.pic-check:not(:checked)').count(), 0);
});

When('I remember the ticked photos', async function () {
  state(this).ticked = await panel(this).locator('.pic-check:checked').evaluateAll((boxes) => boxes.map((box) => box.dataset.id));
  assert.ok(state(this).ticked.length > 0);
});

Then('the confirmation should name {int} photos and then say {string}', async function (count, more) {
  const names = await bar(this).locator('.pics-remove-named li').allInnerTexts();
  assert.equal(names.length, count + 1);
  assert.equal(names.at(-1), more);
});

Then('the remembered photos should be gone from R2, and every other photo should still be there', async function () {
  const gone = new Set(state(this).ticked);
  await eventually(() => [...gone].every((id) => !originals(this).has(config.photoKey(id, 'original'))), 'the remembered photos are gone');
  for (const id of gone) assert.equal([...originals(this).keys(), ...web(this).keys()].some((key) => key.includes(id)), false, id);
  const others = Object.keys(state(this).seeded).filter((id) => !gone.has(id));
  for (const id of others) assert.ok(originals(this).has(config.photoKey(id, 'original')), `${id} must still be there`);
  assert.equal(originals(this).size, others.length, 'nothing else was deleted');
});

