import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setUpOriginals } from '../support/browser.js';
import { sampleFile } from '../support/originals-fixtures.js';
import { PHOTOS_BASE_URL } from '../../src/config/photos.ts';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR } from '../support/lib.js';

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

When('I click the file {string}, then immediately fire a mouseleave on it', async function (name) {
  await file(this, name).evaluate((link) => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    link.closest('.pic').dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
  });
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

// --- The Upload Photos and Remove Photos buttons ----------------------------------------------------------------------------------

const action = (world, name) => panel(world).getByRole('button', { name, exact: true });

Then('the photo counter should be at the left of its row, with {string} then {string} across from it at the right, all on one line', async function (first, second) {
  await eventually(async () => (await panel(this).locator('.pics-summary').count()) === 1, 'the summary row');
  const boxes = await panel(this).locator('.pics-summary').evaluate((row) => ({
    row: row.getBoundingClientRect().toJSON(),
    counter: row.querySelector('.results-count').getBoundingClientRect().toJSON(),
    buttons: [...row.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...b.getBoundingClientRect().toJSON() })),
  }));
  assert.deepEqual(boxes.buttons.map((b) => b.text), [first, second], 'the two buttons, in this order');
  const [a, b] = boxes.buttons;
  assert.ok(Math.abs(a.y - boxes.counter.y) < boxes.counter.height + 40 && a.y < boxes.counter.y + boxes.counter.height + 40, 'across from the counter');
  assert.ok(Math.abs(a.y - b.y) < 2, 'the buttons are on one line');
  assert.ok(boxes.counter.x + boxes.counter.width <= a.x, 'the counter is at the left of the buttons');
  assert.ok(a.x + a.width <= b.x, `${first} is left of ${second}`);
  assert.ok(Math.abs(b.x + b.width - (boxes.row.x + boxes.row.width)) < 2, 'the buttons end at the right edge of the row');
});

Then('the {string} button should show the {string} icon and be named only by its text', async function (name, glyph) {
  const button = action(this, name);
  await button.waitFor({ state: 'visible', timeout: 8000 });
  const parts = await button.evaluate((b) => ({ icons: [...b.querySelectorAll('svg')].map((s) => ({ icon: s.getAttribute('data-icon'), hidden: s.getAttribute('aria-hidden'), box: s.getBoundingClientRect().toJSON() })), text: b.textContent.trim(), label: b.getAttribute('aria-label'), rect: b.getBoundingClientRect().toJSON() }));
  assert.equal(parts.icons.length, 1);
  assert.equal(parts.icons[0].icon, glyph);
  assert.equal(parts.icons[0].hidden, 'true');
  assert.ok(parts.icons[0].box.width >= 16 && parts.icons[0].box.x < parts.rect.x + 20, 'the icon sits before the text');
  assert.equal(parts.text, name);
  assert.equal(parts.label, null);
});

Then('the two icons should be different drawings', async function () {
  const drawings = await panel(this).locator('.pics-action svg').evaluateAll((svgs) => svgs.map((s) => [...s.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|')));
  assert.equal(drawings.length, 2);
  assert.notEqual(drawings[0], drawings[1]);
  assert.ok(drawings.every((d) => d.length > 20));
});

Then('both action buttons should be in the tab order and at least 44 pixels tall', async function () {
  await eventually(async () => (await panel(this).locator('.pics-action').count()) === 2, 'both buttons');
  const buttons = await panel(this).locator('.pics-action').evaluateAll((bs) => bs.map((b) => ({ tabIndex: b.tabIndex, disabled: b.disabled, height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width })));
  for (const b of buttons) {
    assert.ok(b.tabIndex >= 0 && !b.disabled);
    assert.ok(b.height >= 44 && b.width >= 44, JSON.stringify(b));
  }
});

Then('both action buttons should be entirely inside the screen', async function () {
  const viewport = page(this).viewportSize();
  for (const box of await panel(this).locator('.pics-action').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().toJSON()))) assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, JSON.stringify(box));
});

When(/^I (click|focus and press Enter on|focus and press Space on) the "([^"]+)" button$/, async function (how, name) {
  const button = action(this, name);
  await button.waitFor({ state: 'visible', timeout: 8000 });
  if (how === 'click') return button.click();
  await button.focus();
  await page(this).keyboard.press(how.endsWith('Enter on') ? 'Enter' : 'Space');
});

Then('the Pics Viewer should offer no Upload Photos or Remove Photos button', async function () {
  assert.equal(await panel(this).locator('.pics-action').count(), 0);
});

// --- Refresh and Sign out at the top of the page ----------------------------------------------------------------------------------

const topButtons = (world) => page(world).locator('[data-admin-actions]');

async function topLayout(world) {
  await topButtons(world).waitFor({ state: 'visible', timeout: 8000 });
  return page(world).evaluate(() => {
    const box = (el) => el.getBoundingClientRect().toJSON();
    const actions = document.querySelector('[data-admin-actions]');
    const content = document.querySelector('.admin');
    return {
      title: box(document.querySelector('.admin h1')),
      content: box(content),
      contentPadding: parseFloat(getComputedStyle(content).paddingRight),
      buttons: [...actions.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...box(b) })),
    };
  });
}

Then('{string} then {string} should sit on the same line as the {string} title, at the right of the page', async function (first, second, title) {
  const layout = await topLayout(this);
  assert.equal(await page(this).locator('.admin h1').innerText(), title);
  assert.deepEqual(layout.buttons.map((b) => b.text), [first, second]);
  const [a, b] = layout.buttons;
  const middleOfTitle = layout.title.y + layout.title.height / 2;
  for (const button of layout.buttons) assert.ok(button.y <= middleOfTitle && button.y + button.height >= middleOfTitle, `${button.text} is across from the title: ${JSON.stringify({ title: layout.title, button })}`);
  assert.ok(layout.title.x + layout.title.width <= a.x, 'the title is at the left of the buttons');
  assert.ok(a.x + a.width <= b.x, 'Refresh comes first');
  const rightEdge = layout.content.x + layout.content.width - layout.contentPadding;
  assert.ok(Math.abs(b.x + b.width - rightEdge) < 2, `the buttons end at the right of the page: ${b.x + b.width} vs ${rightEdge}`);
});

Then('neither tab\'s panel should hold a {string} or {string} button', async function (a, b) {
  for (const name of [a, b]) assert.equal(await page(this).locator('[role="tabpanel"]').getByRole('button', { name, exact: true }).count(), 0, `a ${name} button is inside a panel`);
});

Then('there should be no {string} or {string} button at the top of the page', async function (_first, _second) {
  await eventually(async () => (await topButtons(this).isVisible()) === false, 'the top buttons are hidden');
});

When('I note how many requests the results API has had', async function () {
  await settle(700);
  this.b.results.mark = this.b.results.requests.length;
});

Then(/^the results API should have been asked once more for (.+), and for nothing else$/, async function (list) {
  const paths = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  await eventually(async () => this.b.results.requests.slice(this.b.results.mark).filter((r) => r.method === 'GET').length >= paths.length, 'the requests');
  await settle(500);
  assert.deepEqual(this.b.results.requests.slice(this.b.results.mark).filter((r) => r.method === 'GET').map((r) => r.path).sort(), paths);
});

Then('both top buttons should be in the tab order, before the tabs, and at least 44 pixels tall', async function () {
  await topButtons(this).waitFor({ state: 'visible' });
  const info = await page(this).evaluate(() => {
    const focusable = [...document.querySelectorAll('a[href], button:not([disabled]), input, [tabindex="0"]')].filter((e) => e.offsetParent !== null && e.tabIndex >= 0);
    const index = (e) => focusable.indexOf(e);
    const [refresh, out] = document.querySelectorAll('[data-admin-actions] button');
    const firstTab = document.querySelector('[role="tab"]');
    return { refresh: index(refresh), out: index(out), tab: index(firstTab), heights: [refresh, out].map((b) => b.getBoundingClientRect().height) };
  });
  assert.ok(info.refresh >= 0 && info.out === info.refresh + 1 && info.tab > info.out, JSON.stringify(info));
  for (const height of info.heights) assert.ok(height >= 44, `${height}px tall`);
});

Then('the two top buttons should be entirely inside the screen', async function () {
  const layout = await topLayout(this);
  const viewport = page(this).viewportSize();
  for (const b of layout.buttons) assert.ok(b.x >= 0 && b.x + b.width <= viewport.width, JSON.stringify(b));
});

Then('the Pics Viewer should show no checkbox to select a photo', async function () {
  assert.equal(await panel(this).locator('.pic-check').count(), 0);
});

// --- Paging: a page of rows at a time ------------------------------------------------------------------------------------------

/** The photo ids of the site's sample library (the ones the built page knows by title and thumbnail). */
function siteIds() {
  return readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((category) => readdirSync(join(CONTENT_DIR, category.name, 'images')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')))
    .sort();
}

Given('the originals bucket holds {int} photos: every photo of the site, then others the site does not list', async function (count) {
  const site = siteIds();
  const ids = [...site, ...Array.from({ length: Math.max(0, count - site.length) }, (_, i) => (i + 1).toString(16).padStart(16, '0'))].slice(0, count);
  setUpOriginals(this, await Promise.all(ids.map(async (id, i) => ({ id, body: await sampleFile('nothing', i) }))));
});

When('I wait a moment', async function () {
  await settle(1200);
});

const rows = (world) => panel(world).locator('.pics-list .pic');

Then('the Pics Viewer should draw {int} of its photos', async function (count) {
  await eventually(async () => (await rows(this).count()) === count, `${count} rows drawn (found ${await rows(this).count()})`);
});

Then('the Pics Viewer should say it is showing {int} of {int} photos', async function (shown, total) {
  await eventually(async () => (await panel(this).locator('.pics-shown').innerText()) === `Showing ${shown} of ${total} photos`, 'the paging note');
});

Then('the Pics Viewer should offer the button {string}', async function (name) {
  await panel(this).getByRole('button', { name, exact: true }).waitFor({ state: 'visible', timeout: 8000 });
});

Then('the Pics Viewer should offer no button to show more', async function () {
  await eventually(async () => (await panel(this).locator('[data-action="more"]').count()) === 0, 'no Show more button');
});

Then('the Pics Viewer should offer no paging at all', async function () {
  await settle(300);
  assert.equal(await panel(this).locator('.pics-more').count(), 0);
});

Then('the Pics Viewer should draw no more than {int} thumbnails', async function (max) {
  await settle(500);
  assert.ok((await panel(this).locator('.pic-thumb img').count()) <= max);
  assert.ok(this.b.photoRequests.filter((url) => url.includes('/w400.webp')).length <= max, `${this.b.photoRequests.length} thumbnails requested`);
});

Then('the thumbnail of the 21st photo of the list should not have been requested', async function () {
  const site = siteIds();
  assert.ok(site.length >= 21);
  // The list is sorted by category and title; take the id of the 21st row from the page once it has been drawn (page 2), not from here.
  const drawn = await rows(this).evaluateAll((items) => items.map((item) => item.querySelector('.pic-key').textContent));
  const notDrawn = site.map((id) => `photos/${id}/original.jpg`).filter((key) => !drawn.includes(key));
  assert.equal(notDrawn.length, site.length - 20, 'the site photos beyond the first page are not drawn');
  for (const key of notDrawn) {
    const id = /photos\/([0-9a-f]{16})\//.exec(key)[1];
    assert.equal(this.b.photoRequests.some((url) => url.includes(`/photos/${id}/`)), false, `${id} was requested`);
  }
});

When('I scroll to the end of the list', async function () {
  // Right after signing in, the list is still an async fetch away: scrolling before it (and the sentinel the
  // IntersectionObserver watches) exist would scroll a much shorter page, leaving the real bottom - once the
  // list renders - outside the observer's rootMargin, so it would never fire. Wait for real rows first.
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  const before = await rows(this).count();
  await page(this).evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // The next page is drawn once the end is near; give it a moment (the last scroll of a scenario has nothing more to draw).
  await eventually(async () => (await rows(this).count()) > before || (await panel(this).locator('[data-action="more"]').count()) === 0, 'the next page is drawn', 4000).catch(() => {});
});

Then("every photo of the list should be listed once, site photos first", async function () {
  const keys = await rows(this).evaluateAll((items) => items.map((item) => item.querySelector('.pic-key').textContent));
  assert.equal(new Set(keys).size, keys.length, 'no photo twice');
  const site = new Set(siteIds().map((id) => `photos/${id}/original.jpg`));
  const flags = keys.map((key) => site.has(key));
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), 'the site photos come first');
});

Then('keyboard focus should be on the paging note', async function () {
  await eventually(async () => (await page(this).evaluate(() => document.activeElement?.classList.contains('pics-shown'))) === true, 'focus on the note');
});

