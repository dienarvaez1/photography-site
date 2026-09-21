import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setUpOriginals } from '../support/browser.js';
import { sampleFile } from '../support/originals-fixtures.js';
import { PHOTOS_BASE_URL } from '../../src/config/photos.ts';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-pics-viewer');
const file = (world, name) => panel(world).locator('.pic-link', { hasText: name }).first();
const tip = (world) => panel(world).locator('.pic-tip');
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

Given('the originals bucket holds these files:', async function (table) {
  const files = [];
  for (const [i, row] of table.hashes().entries()) files.push({ id: row['photo id'], body: await sampleFile(row.metadata, i * 40) });
  setUpOriginals(this, files);
});

When('the file {string} disappears from the bucket', function (key) {
  const { objects } = this.b.results.originals;
  this.b.results.removed = { key, object: objects.get(key) };
  objects.delete(key);
});

When('the file {string} comes back', function (key) {
  const { removed } = this.b.results;
  assert.equal(removed.key, key);
  this.b.results.originals.objects.set(key, removed.object);
});

// --- Signing in --------------------------------------------------------------------------------------------------------------

When('I sign in to the Pics Viewer with the token {string}', async function (token) {
  const field = panel(this).locator('#pics-token');
  await field.fill(token);
  await field.press('Enter');
});

When('I click {string} in the Pics Viewer', async function (name) {
  await panel(this).getByRole('button', { name, exact: true }).click();
});

Then('the Pics Viewer should ask for the admin token', async function () {
  await panel(this).locator('#pics-token').waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).getByLabel('Admin token').waitFor({ state: 'visible' });
});

Then('the Pics Viewer should ask for the token in Spanish', async function () {
  await panel(this).getByLabel('Token de administrador').waitFor({ state: 'visible', timeout: 8000 });
});

Then('the Pics Viewer should say {string}', async function (text) {
  await panel(this).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
});

Then('the browser should still remember the token', async function () {
  assert.equal(await page(this).evaluate(() => sessionStorage.getItem('admin-token')), this.b.results.token);
});

Then('the results API should not have been asked for the pictures', async function () {
  await settle(500);
  assert.deepEqual(this.b.results.requests.filter((r) => r.path.startsWith('/pics')), []);
});

// --- The list -------------------------------------------------------------------------------------------------------------------

Then('the Pics Viewer should list {int} original photos in this order: {string}', async function (count, order) {
  const titles = panel(this).locator('.pics-list .pic-title');
  await eventually(async () => (await titles.count()) === count, `${count} photos listed`);
  assert.deepEqual(await titles.allInnerTexts(), order.split(', '));
  assert.ok((await panel(this).locator('.results-count').innerText()).startsWith(String(count)));
});

Then('the file for {string} should show the category {string} and the path {string}', async function (name, category, path) {
  const link = file(this, name);
  assert.equal(await link.locator('.pic-category').innerText(), category);
  assert.equal(await link.locator('.pic-key').innerText(), path);
});

Then('every file should be a link that is in the tab order and large enough to tap', async function () {
  await eventually(async () => (await panel(this).locator('a.pic-link').count()) === 4, 'the list is shown');
  const links = await panel(this).locator('a.pic-link').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), tabIndex: a.tabIndex, height: a.getBoundingClientRect().height })));
  assert.equal(links.length, 4);
  for (const link of links) {
    assert.ok(link.href);
    assert.ok(link.tabIndex >= 0);
    assert.ok(link.height >= 44, `${link.height}px tall`);
  }
});

// --- The tooltip -----------------------------------------------------------------------------------------------------------------

When('I hover over the file {string}', async function (name) {
  await file(this, name).hover();
});

When('I click the file {string}', async function (name) {
  await file(this, name).click();
});

When('I tap the file {string}', async function (name) {
  await file(this, name).tap();
});

When('I tap somewhere else on the page', async function () {
  await page(this).locator('.admin h1').tap();
});

When('I move the pointer away from the files', async function () {
  await page(this).mouse.move(2, 2);
});

When('I move the pointer onto the tooltip', async function () {
  await tip(this).hover();
});

When('I click somewhere else on the page', async function () {
  await page(this).locator('.admin h1').click();
});

When('I tab until the file {string} has keyboard focus', async function (name) {
  for (let i = 0; i < 80; i++) {
    const focused = await page(this).evaluate(() => (document.activeElement?.classList.contains('pic-link') ? document.activeElement.querySelector('.pic-title').textContent : ''));
    if (focused === name) break;
    await page(this).keyboard.press('Tab');
  }
  const links = await panel(this).locator('.pic-title').allInnerTexts();
  this.b.focusedIndex = links.indexOf(name);
  assert.equal(await page(this).evaluate(() => document.activeElement?.querySelector?.('.pic-title')?.textContent), name);
});

Then('the file {string} should still have keyboard focus', async function (name) {
  assert.equal(await page(this).evaluate(() => document.activeElement?.querySelector?.('.pic-title')?.textContent), name);
});

Then('the tooltip should show these facts:', async function (table) {
  await tip(this).locator('dl').waitFor({ state: 'visible', timeout: 8000 });
  const facts = await tip(this).locator('dl').evaluate((dl) => Object.fromEntries([...dl.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])));
  for (const [label, value] of table.raw()) assert.equal(facts[label], value, `${label}: ${JSON.stringify(facts)}`);
});

Then('the tooltip should say {string}', async function (text) {
  await tip(this).getByText(text, { exact: false }).waitFor({ state: 'visible', timeout: 8000 });
});

Then(/^the tooltip should show the stored size of "([0-9a-f]+)", which is about (.+)$/, async function (id, about) {
  const size = this.b.results.originals.objects.get(`photos/${id}/original.jpg`).body.length;
  const exact = new Intl.NumberFormat(about.includes(',') ? 'es' : 'en').format(size);
  await tip(this).locator('dl').waitFor({ state: 'visible', timeout: 8000 });
  const facts = await tip(this).locator('dl').evaluate((dl) => [...dl.querySelectorAll('dd')].map((dd) => dd.textContent));
  assert.ok(facts.includes(`${about} (${exact} bytes)`), `${JSON.stringify(facts)} should include ${about} (${exact} bytes)`);
});

Then('the tooltip should be what describes that file for a screen reader', async function () {
  const id = await tip(this).getAttribute('id');
  assert.equal(await tip(this).getAttribute('role'), 'tooltip');
  const describedBy = await tip(this).evaluate((node) => node.parentElement.querySelector('a').getAttribute('aria-describedby'));
  assert.equal(describedBy, id);
});

Then('exactly one tooltip should be showing, for {string}', async function (name) {
  await eventually(async () => (await tip(this).count()) === 1, 'exactly one tooltip');
  assert.ok((await tip(this).evaluate((node) => node.parentElement.querySelector('.pic-title').textContent)) === name);
});

Then('exactly one tooltip should be showing, for the next file in the list', async function () {
  await eventually(async () => (await tip(this).count()) === 1, 'exactly one tooltip');
  const titles = await panel(this).locator('.pic-title').allInnerTexts();
  assert.equal(await tip(this).evaluate((node) => node.parentElement.querySelector('.pic-title').textContent), titles[this.b.focusedIndex + 1]);
});

Then('no tooltip should be showing', async function () {
  await eventually(async () => (await tip(this).count()) === 0, 'no tooltip');
});

Then('the tooltip should be entirely inside the screen', async function () {
  const box = await tip(this).boundingBox();
  const viewport = page(this).viewportSize();
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify({ box, viewport }));
});

Then(/^the results API should have been asked for photo "([0-9a-f]+)" (\d+) times? and for photo "([0-9a-f]+)" (\d+) times?$/, function (a, na, b, nb) {
  const count = (id) => this.b.results.requests.filter((r) => r.method === 'GET' && r.path === `/pics/${id}`).length;
  assert.deepEqual([count(a), count(b)], [Number(na), Number(nb)]);
});

// --- The pictures stay private ---------------------------------------------------------------------------------------------------

Then("the Pics Viewer should show no canvas or video, and no image other than the list's thumbnails", async function () {
  assert.equal(await panel(this).locator('canvas, video, picture, iframe, object, embed').count(), 0);
  assert.equal(await panel(this).locator('img:not(.pic-link img)').count(), 0);
  assert.equal(await panel(this).locator('img').count(), 3, 'one for each photo the site knows');
});

Then('the page should have asked only for the list and for photo details, always with the token in the Authorization header', function () {
  const asked = this.b.results.requests.filter((r) => r.method === 'GET');
  assert.ok(asked.length >= 4, 'the list and three photos');
  for (const request of asked) {
    assert.match(request.path, /^\/pics(\/[0-9a-f]{16})?$/);
    assert.equal(request.authorization, `Bearer ${this.b.results.token}`);
  }
});

Then('no request to the API should have been for a photo file, and the token should not be in any address', function () {
  for (const { url } of this.b.results.requests) {
    assert.ok(!/original|\.jpe?g|\.webp|\.png/i.test(url), url);
    assert.ok(!url.includes(this.b.results.token), url);
  }
  assert.deepEqual(this.b.blocked, []);
});

Then('the only pictures requested should be the public 400 pixel copies of {string}', async function (ids) {
  await settle(300);
  const expected = ids ? ids.split(', ').map((id) => `${PHOTOS_BASE_URL}/photos/${id}/w400.webp`) : [];
  assert.deepEqual([...new Set(this.b.photoRequests)].sort(), expected.sort());
});

const row = (world, title) => panel(world).locator('.pic-link', { hasText: title }).first();

Then('the row for {string} should start with a loaded thumbnail, no more than 96 pixels wide and tall, to the left of its title', async function (title) {
  const link = row(this, title);
  const image = link.locator('img');
  await image.scrollIntoViewIfNeeded();
  await eventually(async () => (await image.evaluate((img) => img.complete && img.naturalWidth > 0)) === true, 'the thumbnail loads');
  const boxes = await link.evaluate((node) => ({ img: node.querySelector('img').getBoundingClientRect().toJSON(), title: node.querySelector('.pic-title').getBoundingClientRect().toJSON(), row: node.getBoundingClientRect().toJSON() }));
  assert.ok(boxes.img.x + boxes.img.width <= boxes.title.x, 'the thumbnail is to the left of the title');
  assert.ok(boxes.img.x >= boxes.row.x && boxes.img.y >= boxes.row.y, 'inside the row');
  assert.ok(boxes.img.width <= 96.5 && boxes.img.height <= 96.5, JSON.stringify(boxes.img));
});

Then('the row for {string} should say {string} where the picture would be', async function (title, text) {
  const link = row(this, title);
  assert.equal(await link.locator('img').count(), 0);
  assert.equal(await link.locator('.pic-thumb-none').innerText(), text);
});

Then('every thumbnail should be lazy-loaded and have an empty description, because the row\'s text already names the photo', async function () {
  const images = await panel(this).locator('.pics-list img').evaluateAll((imgs) => imgs.map((i) => ({ loading: i.getAttribute('loading'), alt: i.getAttribute('alt') })));
  assert.equal(images.length, 3);
  for (const image of images) assert.deepEqual(image, { loading: 'lazy', alt: '' });
});

Given('the results API takes {int} milliseconds to answer', function (ms) {
  this.b.results.delayMs = ms;
});

Then('the tooltip should hold no picture', async function () {
  await tip(this).waitFor({ state: 'visible' });
  assert.equal(await tip(this).locator('img, canvas, video').count(), 0);
});

Then('the results API should have been asked for the list only', function () {
  assert.deepEqual(this.b.results.requests.filter((r) => r.method === 'GET').map((r) => r.path), ['/pics']);
});

Then('the bucket should have been asked only to list, and to read the first {int} bytes at most of any file', function (max) {
  const { calls } = this.b.results.originals;
  assert.ok(calls.some((c) => c.op === 'list'));
  for (const call of calls) {
    if (call.op === 'list') continue;
    assert.equal(call.range?.offset, 0);
    assert.ok(call.range.length <= max);
  }
});

// --- Whole-page checks ----------------------------------------------------------------------------------------------------------------

When('I show the Pics Viewer in its {string} state', async function (state) {
  if (state === 'sign-in') return;
  const field = panel(this).locator('#pics-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  if (state === 'tooltip showing') {
    await file(this, 'Orion Nebula').hover();
    await tip(this).locator('dl').waitFor({ state: 'visible', timeout: 8000 });
  }
});
