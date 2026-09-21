import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { entryFile, lib, sourcePath, state } from '../support/photo-helpers.js';
import { startPhotoService } from '../support/browser.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-pics-viewer');
const form = (world) => panel(world).locator('[data-photo-form]');
const control = (world, id) => form(world).locator(`#photo-form-${id}`);
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

// --- Setting the scene ------------------------------------------------------------------------------------------------

Given('the local photo service is running', async function () {
  await startPhotoService(this, state(this));
});

Given('the local photo service is not running', function () {
  this.b.photoService = null;
});

Given('a text file {string}', async function (name) {
  await writeFile(sourcePath(this, name), 'this is not a picture');
});

/**
 * Makes the tab remember, before the page loads, that a photo was being added (as the form does when it submits),
 * and that the admin is signed in (the token is in the tab too). Set once: a later reload finds what the page left.
 */
function rememberInTab(world, flash) {
  world.b.initScripts.push(`(() => {
    if (sessionStorage.getItem('test-seeded')) return;
    sessionStorage.setItem('test-seeded', '1');
    sessionStorage.setItem('admin-token', 'browser-test-admin-token');
    sessionStorage.setItem('admin-token-seen', String(Date.now()));
    const flash = ${JSON.stringify(flash)};
    sessionStorage.setItem('admin-photo-added', JSON.stringify({ ...flash, at: Date.now() - flash.ago }));
  })();`);
}

Given('the photo {string} was added as {string} to {string} with order {int} without the page hearing back', async function (file, title, category, order) {
  const { id } = await lib.analyzePhoto(sourcePath(this, file));
  await lib.addPhoto({ source: sourcePath(this, file), category, title, order, keepSource: true, contentDir: state(this).contentDir, storage: state(this).storage });
  rememberInTab(this, { id, title, category, ago: 0 });
});

Given(/^the tab remembers a photo "([^"]+)" that was just added to "([^"]+)" but has no entry$/, function (title, category) {
  rememberInTab(this, { id: '0123456789abcdef', title, category, ago: 0 });
});

Given(/^the tab remembers a photo "([^"]+)" that was added to "([^"]+)" (\d+) minutes ago$/, async function (title, category, minutes) {
  const { id } = await lib.analyzePhoto(sourcePath(this, 'moon.jpg'));
  await lib.addPhoto({ source: sourcePath(this, 'moon.jpg'), category, title, order: 5, keepSource: true, contentDir: state(this).contentDir, storage: state(this).storage });
  rememberInTab(this, { id, title, category, ago: Number(minutes) * 60_000 });
});

Then('the tab should no longer remember a photo being added', async function () {
  await settle(500);
  assert.equal(await page(this).evaluate(() => sessionStorage.getItem('admin-photo-added')), null);
});

// --- The form's place and fields ---------------------------------------------------------------------------------------

Then('the New Photo form should be open, above the list of photos', async function () {
  await form(this).waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  const boxes = await page(this).evaluate(() => ({
    form: document.querySelector('[data-photo-form]').getBoundingClientRect().toJSON(),
    list: document.querySelector('.pics-list').getBoundingClientRect().toJSON(),
  }));
  assert.ok(boxes.form.y + boxes.form.height <= boxes.list.y, JSON.stringify(boxes));
});

Then(/^the New Photo form should ask for these, in this order: (.+)$/, async function (list) {
  const expected = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  await control(this, 'photo').waitFor({ state: 'visible', timeout: 8000 });
  assert.deepEqual(await form(this).locator('label:visible').allInnerTexts(), expected);
});

Then('there should be exactly {int} New Photo form(s)', async function (count) {
  await settle(300);
  assert.equal(await panel(this).locator('[data-photo-form]').count(), count);
});

Then("keyboard focus should be on the form's photo field", async function () {
  await eventually(async () => (await page(this).evaluate(() => document.activeElement?.id)) === 'photo-form-photo', 'focus on the photo field');
});

Then('keyboard focus should be on the {string} button', async function (name) {
  await eventually(async () => (await page(this).evaluate(() => document.activeElement?.textContent?.trim())) === name, `focus on ${name}`);
});

Then('every field of the New Photo form should have a label, be at least 44 pixels tall and be in the tab order', async function () {
  await control(this, 'photo').waitFor({ state: 'visible', timeout: 8000 });
  const fields = await form(this).locator('input:visible, select:visible').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.id,
      labelled: Boolean(node.labels?.length && node.labels[0].textContent.trim()),
      tabIndex: node.tabIndex,
      // A checkbox is small itself: what counts is its whole row, which the label makes tappable.
      height: (node.type === 'checkbox' ? node.parentElement : node).getBoundingClientRect().height,
    }))
  );
  assert.equal(fields.length, 6, JSON.stringify(fields)); // photo, title, Spanish title, category, order, featured
  for (const field of fields) {
    assert.ok(field.labelled, `${field.id} has no label`);
    assert.ok(field.tabIndex >= 0, `${field.id} is not in the tab order`);
    assert.ok(field.height >= 44, `${field.id} is ${field.height}px tall`);
  }
});

Then('the New Photo form should say {string}', async function (text) {
  await form(this).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
});

Then('the New Photo form should have no fields, only a {string} button', async function (name) {
  assert.equal(await form(this).locator('input, select').count(), 0);
  assert.deepEqual(await form(this).locator('button').allInnerTexts(), [name]);
});

// --- Reading the photo -----------------------------------------------------------------------------------------------------

When('I choose the photo {string} in the form', async function (name) {
  await control(this, 'photo').waitFor({ state: 'visible', timeout: 8000 });
  await control(this, 'photo').setInputFiles(sourcePath(this, name));
});

Then('the form should show what it read: a 16-character photo id, the size {string} and the camera line {string}', async function (size, camera) {
  await form(this).locator('.photo-form-facts dd').first().waitFor({ state: 'visible', timeout: 8000 });
  const [id, shown] = await form(this).locator('.photo-form-facts dd').allInnerTexts();
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(shown, size);
  assert.equal(await control(this, 'camera').inputValue(), camera);
});

Then("the form's camera line should be {string}", async function (line) {
  await control(this, 'camera').waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await control(this, 'camera').inputValue(), line);
});

Then('the form should show no photo id', async function () {
  await settle(300);
  assert.equal(await form(this).locator('.photo-form-facts dd').count(), 0);
  assert.equal(await form(this).locator('.photo-form-extracted').isVisible(), false);
});

Then('the photo service should have been asked only: {string}', async function (list) {
  await settle(300);
  assert.equal(this.b.photoService.requests.map((r) => `${r.method} ${r.path}`).join(', '), list);
});

// --- Filling in ------------------------------------------------------------------------------------------------------------------

When("I fill in the form's {string} with {string}", async function (label, value) {
  await form(this).getByLabel(label, { exact: true }).fill(value);
});

Then("the form's {string} should still read {string}", async function (label, value) {
  assert.equal(await form(this).getByLabel(label, { exact: true }).inputValue(), value);
});

When('I choose the category {string} in the form', async function (label) {
  await control(this, 'category').selectOption({ label });
});

When('I type the order {string} in the form', async function (value) {
  await control(this, 'order').fill(value);
});

When('I clear the order in the form', async function () {
  await control(this, 'order').fill('');
});

When('I tick {string} in the form', async function (label) {
  await form(this).getByLabel(label, { exact: true }).check();
});

Then('the order should read {string}', async function (value) {
  await eventually(async () => (await control(this, 'order').inputValue()) === value, `the order reads ${value}`);
});

Then('the order hint should say {string}', async function (text) {
  await eventually(async () => (await control(this, 'order-hint').innerText()).includes(text), `the hint says ${text}`);
});

// --- After pressing Add photo ------------------------------------------------------------------------------------------------------

Then('the {string} button should be enabled again', async function (name) {
  await eventually(async () => !(await form(this).getByRole('button', { name, exact: true }).isDisabled()), `${name} enabled`);
});

Then("the form should show the entry it wrote, as the site's other entries look", async function () {
  const shown = await form(this).locator('.photo-form-entry').innerText();
  const written = await readFile(await entryFile(this, 'astro/half-moon'), 'utf-8');
  assert.equal(shown.trim(), written.trim());
  assert.match(shown, /^---\ntitle: "Half Moon"\n/);
});

Then('the results API should have asked for the list again', async function () {
  await eventually(() => this.b.results.requests.filter((r) => r.method === 'GET' && r.path === '/pics').length >= 2, 'the list was asked for again');
});

// --- Quality -------------------------------------------------------------------------------------------------------------------------

When('I show the New Photo form in its {string} state', async function (name) {
  if (name === 'not available') this.b.photoService = null;
  if (name === 'refused') await writeFile(sourcePath(this, 'notes.jpg'), 'this is not a picture');
  const field = panel(this).locator('#pics-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).getByRole('button', { name: 'Upload Photos', exact: true }).click();
  if (name === 'not available') return form(this).locator('.results-error').waitFor({ state: 'visible', timeout: 8000 });
  await control(this, 'photo').waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'refused') {
    await control(this, 'photo').setInputFiles(sourcePath(this, 'notes.jpg'));
    return form(this).locator('.results-error:not(:empty)').waitFor({ state: 'visible', timeout: 8000 });
  }
  if (name === 'empty') return;
  await control(this, 'photo').setInputFiles(sourcePath(this, 'moon.jpg'));
  await form(this).locator('.photo-form-facts dd').first().waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'photo read') return;
  await control(this, 'title').fill('Half Moon');
  await control(this, 'category').selectOption({ label: 'Astrophotography' });
  if (name === 'filled in') return;
  await panel(this).getByRole('button', { name: 'Add photo', exact: true }).click();
  await form(this).locator('.photo-form-done').waitFor({ state: 'visible', timeout: 8000 });
});

Then('every button and field of the New Photo form should be entirely inside the screen', async function () {
  const viewport = page(this).viewportSize();
  const boxes = await form(this).locator('button:visible, input:visible, select:visible').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  assert.ok(boxes.length >= 1);
  for (const box of boxes) assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify(box));
});
