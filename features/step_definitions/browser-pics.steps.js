import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setUpOriginals, signInSettled } from '../support/browser.js';
import { sampleFile } from '../support/originals-fixtures.js';
import { PHOTOS_BASE_URL } from '../../src/config/photos.ts';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR } from '../support/lib.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-pics-viewer');
const file = (world, name) => panel(world).locator('.pic-link', { hasText: name }).first();
const detailsOf = (world, name) => file(world, name).locator('.pic-details');
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
  const field = page(this).locator('#admin-token');
  await field.fill(token);
  await field.press('Enter');
  await signInSettled(this);
});

Then('the Pics Viewer should ask for the admin token', async function () {
  await page(this).locator('#admin-token').waitFor({ state: 'visible', timeout: 8000 });
  await page(this).getByLabel('Admin token').waitFor({ state: 'visible' });
  assert.equal(await page(this).locator('[data-tabs]').isHidden(), true, 'the tabs stay hidden until the token is accepted');
});

Then('the Pics Viewer should ask for the token in Spanish', async function () {
  await page(this).locator('[data-admin-gate]').getByLabel('Token de administrador').waitFor({ state: 'visible', timeout: 8000 });
});

Then('the Pics Viewer should say {string}', async function (text) {
  // Signed out (a refused token, the idle timeout), the tab is hidden and the page's token box says it instead.
  await panel(this).or(page(this).locator('[data-admin-gate]')).getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8000 });
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

Then("no file's row should be a link or in the tab order", async function () {
  await eventually(async () => (await panel(this).locator('.pic-link').count()) === 4, 'the list is shown');
  assert.equal(await panel(this).locator('.pics-list a').count(), 0);
  const tabbable = await panel(this).locator('.pic-link').evaluateAll((rows) => rows.filter((row) => row.tabIndex >= 0 || row.querySelector('[tabindex]:not([tabindex="-1"])')).length);
  assert.equal(tabbable, 0);
});

// --- Each file's details --------------------------------------------------------------------------------------------------------

When('I hover over the file {string}', async function (name) {
  await file(this, name).hover();
});

When('I move the pointer away from the files', async function () {
  await page(this).mouse.move(2, 2);
});

/** { label: value } of one file's details, once they have arrived. */
async function factsOf(world, name) {
  const dl = detailsOf(world, name).locator('dl');
  await dl.waitFor({ state: 'visible', timeout: 8000 });
  return dl.evaluate((node) => Object.fromEntries([...node.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])));
}

Then('the details of {string} should show these facts:', async function (name, table) {
  const facts = await factsOf(this, name);
  for (const [label, value] of table.raw()) assert.equal(facts[label], value, `${label}: ${JSON.stringify(facts)}`);
});

// The browser's own date format (its ICU data) decides the exact spacing and time, so this checks the date part only.
Then('the details of {string} should say it was taken on {string}', async function (name, date) {
  const facts = await factsOf(this, name);
  const taken = facts.Taken ?? facts.Tomada;
  assert.ok(taken?.replace(/\s+/g, ' ').includes(date), `taken: ${JSON.stringify(taken)}`);
});

Then('the details of {string} should say {string}', async function (name, text) {
  await detailsOf(this, name).getByText(text, { exact: false }).waitFor({ state: 'visible', timeout: 8000 });
});

Then(/^the details of "([^"]+)" should show the stored size of "([0-9a-f]+)", which is about (.+)$/, async function (name, id, about) {
  const size = this.b.results.originals.objects.get(`photos/${id}/original.jpg`).body.length;
  const exact = new Intl.NumberFormat(about.includes(',') ? 'es' : 'en').format(size);
  const facts = Object.values(await factsOf(this, name));
  assert.ok(facts.includes(`${about} (${exact} bytes)`), `${JSON.stringify(facts)} should include ${about} (${exact} bytes)`);
});

Then('the details of {string} should sit at the right of its thumbnail, title and category, inside its row', async function (name) {
  await factsOf(this, name);
  const boxes = await file(this, name).evaluate((row) => {
    const box = (sel) => row.querySelector(sel).getBoundingClientRect().toJSON();
    return { row: row.getBoundingClientRect().toJSON(), thumb: box('.pic-thumb'), title: box('.pic-title'), category: box('.pic-category'), details: box('.pic-details') };
  });
  for (const part of ['thumb', 'title', 'category']) assert.ok(boxes.details.x >= boxes[part].x + boxes[part].width, `details right of the ${part}: ${JSON.stringify(boxes)}`);
  assert.ok(boxes.details.x + boxes.details.width <= boxes.row.x + boxes.row.width + 0.5, 'inside the row');
  assert.ok(boxes.details.y >= boxes.row.y - 0.5 && boxes.details.y + boxes.details.height <= boxes.row.y + boxes.row.height + 0.5, 'inside the row');
});

Then('the details of {string} should be under its title and entirely inside the screen', async function (name) {
  const boxes = await file(this, name).evaluate((row) => ({ title: row.querySelector('.pic-title').getBoundingClientRect().toJSON(), details: row.querySelector('.pic-details').getBoundingClientRect().toJSON() }));
  const viewport = page(this).viewportSize();
  assert.ok(boxes.details.y >= boxes.title.y + boxes.title.height, JSON.stringify(boxes));
  assert.ok(boxes.details.x >= 0 && boxes.details.x + boxes.details.width <= viewport.width, JSON.stringify({ boxes, viewport }));
});

/** Where these parts of a row are, in page order and on screen. */
const rowParts = (world, name, selectors) => file(world, name).evaluate((row, sels) => sels.map((sel) => ({ sel, index: [...row.children].indexOf(row.querySelector(sel)), top: row.querySelector(sel).getBoundingClientRect().top })), selectors);

function assertTopToBottom(parts) {
  for (let i = 1; i < parts.length; i++) {
    assert.ok(parts[i - 1].index < parts[i].index, `in that order in the page: ${JSON.stringify(parts)}`);
    assert.ok(parts[i - 1].top < parts[i].top, `in that order on screen: ${JSON.stringify(parts)}`);
  }
}

Then('the row for {string} should read, top to bottom: its title, its category, its path', async function (name) {
  await file(this, name).waitFor({ state: 'visible', timeout: 8000 });
  assertTopToBottom(await rowParts(this, name, ['.pic-title', '.pic-category', '.pic-key']));
});

Then('the row for {string} should read, top to bottom: its title, the Home background badge, its category, its path', async function (name) {
  await file(this, name).locator('.results-badge').waitFor({ state: 'visible', timeout: 8000 });
  assertTopToBottom(await rowParts(this, name, ['.pic-title', '.pic-badges', '.pic-category', '.pic-key']));
  assert.equal(await file(this, name).locator('.pic-title .results-badge').count(), 0, 'the badge is not on the title line');
});

Then("every row's details should start at the same place, the same distance from its text, and reach the end of the row", async function () {
  await eventually(async () => (await panel(this).locator('.pic-link .pic-details dl').count()) === 4, 'every row shows its facts');
  const rows = await panel(this).locator('.pic-link').evaluateAll((all) => all.map((row) => {
    const box = (sel) => row.querySelector(sel).getBoundingClientRect();
    const style = getComputedStyle(row);
    return {
      textRight: Math.max(...['.pic-title', '.pic-category', '.pic-key'].map((sel) => box(sel).right)),
      textColumnRight: box('.pic-key').left + parseFloat(getComputedStyle(row).gridTemplateColumns.split(' ')[1]),
      details: box('.pic-details').toJSON(),
      rowRight: row.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      gap: parseFloat(style.columnGap),
      // Under two lines' worth of height: the path fits on one line.
      keyOnOneLine: box('.pic-key').height < parseFloat(getComputedStyle(row.querySelector('.pic-key')).fontSize) * 2,
    };
  }));
  const lefts = rows.map((r) => Math.round(r.details.left));
  assert.equal(new Set(lefts).size, 1, `every divider at the same place: ${JSON.stringify(lefts)}`);
  for (const r of rows) {
    assert.ok(r.details.left >= r.textRight - 0.5, `not over the text: ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.details.left - r.textColumnRight - r.gap) <= 1, `one gap after the text column: ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.details.right - r.rowRight) <= 1, `to the end of the row: ${JSON.stringify(r)}`);
    assert.ok(r.keyOnOneLine, `the path fits on one line: ${JSON.stringify(r)}`);
  }
});

Then("every file's details should be showing", async function () {
  await eventually(async () => {
    const rows = await panel(this).locator('.pic-link').count();
    return rows > 0 && (await panel(this).locator('.pic-link .pic-details dl').count()) === rows;
  }, 'every row shows its facts');
});

Then("no file's details should be showing", async function () {
  assert.equal(await panel(this).locator('.pic-details').count(), 0);
});

Then("no file's details should hold a picture", async function () {
  assert.equal(await panel(this).locator('.pic-details').locator('img, canvas, video').count(), 0);
});

// What a bulk-action button or the form may cost the API: nothing of its own. The list is read once, and each drawn row
// looks its own file up once (its details column); any other request — a second list, a delete — fails this.
Then("the results API should have been asked only for the list and each shown file's details", function () {
  const paths = this.b.results.requests.map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(paths.filter((p) => !/^GET \/pics\/[0-9a-f]{16}$/.test(p)), ['GET /pics'], JSON.stringify(paths));
  const lookups = paths.filter((p) => p !== 'GET /pics');
  assert.equal(new Set(lookups).size, lookups.length, 'each file once');
});

Then(/^the results API should have been asked for the list and for the details of the (\d+) files shown, and nothing else$/, async function (count) {
  await eventually(async () => this.b.results.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/pics/')).length >= Number(count), `${count} lookups`);
  const shown = await panel(this).locator('.pic-link').count();
  assert.equal(shown, Number(count));
  const paths = this.b.results.requests.filter((r) => r.method === 'GET').map((r) => r.path);
  assert.deepEqual(paths.filter((p) => p === '/pics'), ['/pics']);
  const lookups = paths.filter((p) => p !== '/pics');
  assert.equal(lookups.length, Number(count), JSON.stringify(lookups));
  assert.equal(new Set(lookups).size, Number(count), 'each file once');
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
  await eventually(async () => (await panel(this).locator('.pics-list img').count()) === 3, 'the list is drawn');
  const images = await panel(this).locator('.pics-list img').evaluateAll((imgs) => imgs.map((i) => ({ loading: i.getAttribute('loading'), alt: i.getAttribute('alt') })));
  assert.equal(images.length, 3);
  for (const image of images) assert.deepEqual(image, { loading: 'lazy', alt: '' });
});

Given('the results API takes {int} milliseconds to answer', function (ms) {
  this.b.results.delayMs = ms;
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
  const field = page(this).locator('#admin-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
  await signInSettled(this);
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  if (state === 'details shown') await detailsOf(this, 'Orion Nebula').locator('dl').waitFor({ state: 'visible', timeout: 8000 });
});

// --- The Upload Photos and Remove Photos buttons ----------------------------------------------------------------------------------

const action = (world, name) => panel(world).getByRole('button', { name, exact: true });

Then(/^the photo counter should be at the left of its row, with ((?:"[^"]+"(?:, | and )?)+) across from it at the right, in that order and all on one line$/, async function (list) {
  const names = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  await eventually(async () => (await panel(this).locator('.pics-summary').count()) === 1, 'the summary row');
  const boxes = await panel(this).locator('.pics-summary').evaluate((row) => ({
    row: row.getBoundingClientRect().toJSON(),
    counter: row.querySelector('.results-count').getBoundingClientRect().toJSON(),
    buttons: [...row.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...b.getBoundingClientRect().toJSON() })),
  }));
  assert.deepEqual(boxes.buttons.map((b) => b.text), names, 'the buttons, in this order');
  const first = boxes.buttons[0];
  const last = boxes.buttons[boxes.buttons.length - 1];
  assert.ok(Math.abs(first.y - boxes.counter.y) < boxes.counter.height + 40 && first.y < boxes.counter.y + boxes.counter.height + 40, 'across from the counter');
  assert.ok(boxes.buttons.every((b) => Math.abs(b.y - first.y) < 2), 'the buttons are on one line');
  assert.ok(boxes.counter.x + boxes.counter.width <= first.x, 'the counter is at the left of the buttons');
  for (let i = 0; i < boxes.buttons.length - 1; i++) assert.ok(boxes.buttons[i].x + boxes.buttons[i].width <= boxes.buttons[i + 1].x, `${boxes.buttons[i].text} is left of ${boxes.buttons[i + 1].text}`);
  assert.ok(Math.abs(last.x + last.width - (boxes.row.x + boxes.row.width)) < 2, 'the buttons end at the right edge of the row');
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

Then('the four icons should be different drawings', async function () {
  const drawings = await panel(this).locator('.pics-action svg').evaluateAll((svgs) => svgs.map((s) => [...s.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|')));
  assert.equal(drawings.length, 4);
  assert.equal(new Set(drawings).size, 4, 'every icon must be a distinct drawing');
  assert.ok(drawings.every((d) => d.length > 20));
});

Then('every action button should be in the tab order and at least 44 pixels tall', async function () {
  await eventually(async () => (await panel(this).locator('.pics-action').count()) === 4, 'every button');
  const buttons = await panel(this).locator('.pics-action').evaluateAll((bs) => bs.map((b) => ({ tabIndex: b.tabIndex, disabled: b.disabled, height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width })));
  for (const b of buttons) {
    assert.ok(b.tabIndex >= 0 && !b.disabled);
    assert.ok(b.height >= 44 && b.width >= 44, JSON.stringify(b));
  }
});

Then('every action button should be entirely inside the screen', async function () {
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

Then('the Pics Viewer should offer no Upload Photos, Edit Photos, Remove Photos or Home Background button', async function () {
  assert.equal(await panel(this).locator('.pics-action').count(), 0);
});

// --- Refresh and Sign out at the top of the page ----------------------------------------------------------------------------------

const topButtons = (world) => page(world).locator('[data-admin-actions]');

async function topLayout(world) {
  await topButtons(world).waitFor({ state: 'attached', timeout: 8000 });
  await page(world).waitForFunction(() => !document.querySelector('[data-admin-actions]').hidden);
  return page(world).evaluate(() => {
    const box = (el) => el.getBoundingClientRect().toJSON();
    const actions = document.querySelector('[data-admin-actions]');
    const nav = document.getElementById('primary-nav');
    const look = (el) => { const css = getComputedStyle(el); return { size: css.fontSize, family: css.fontFamily, color: css.color, border: css.borderTopStyle, background: css.backgroundColor }; };
    const items = [...nav.querySelectorAll(':scope > a, :scope > .nav-group > .nav-label, [data-admin-actions] button')];
    return {
      inNav: nav.contains(actions),
      order: items.map((el) => el.textContent.trim()),
      contact: { ...box([...nav.querySelectorAll(':scope > a')].at(-1)), look: look([...nav.querySelectorAll(':scope > a')].at(-1)) },
      buttons: [...actions.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...box(b), look: look(b) })),
    };
  });
}

Then('{string} then {string} should sit in the top menu right after {string}, styled like it', async function (first, second, contact) {
  const layout = await topLayout(this);
  assert.ok(layout.inNav, 'the buttons are in the top menu');
  const at = layout.order.indexOf(contact);
  assert.deepEqual(layout.order.slice(at, at + 3), [contact, first, second], `the menu reads ${layout.order.join(', ')}`);
  const [a, b] = layout.buttons;
  for (const button of layout.buttons) {
    assert.deepEqual([button.look.size, button.look.family, button.look.color], [layout.contact.look.size, layout.contact.look.family, layout.contact.look.color], `${button.text} looks like ${contact}`);
    assert.equal(button.look.border, 'none', 'no button border');
    assert.ok(Math.abs(button.y + button.height / 2 - (layout.contact.y + layout.contact.height / 2)) <= 2, `${button.text} is on ${contact}'s line`);
  }
  assert.ok(layout.contact.x + layout.contact.width <= a.x && a.x + a.width <= b.x, 'Contact, then Refresh, then Sign out');
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
    // The tabs are reached through the selected one (the only tab in the tab order, per the WAI-ARIA tabs pattern).
    const firstTab = document.querySelector('[role="tab"][aria-selected="true"]');
    return { refresh: index(refresh), out: index(out), tab: index(firstTab), heights: [refresh, out].map((b) => b.getBoundingClientRect().height) };
  });
  assert.ok(info.refresh >= 0 && info.out === info.refresh + 1 && info.tab > info.out, JSON.stringify(info));
  for (const height of info.heights) assert.ok(height >= 44, `${height}px tall`);
});

Then('the two top buttons should be entirely inside the screen, after {string} in the menu', async function (contact) {
  const layout = await topLayout(this);
  const viewport = page(this).viewportSize();
  for (const b of layout.buttons) assert.ok(b.x >= 0 && b.x + b.width <= viewport.width && b.height >= 44, JSON.stringify(b));
  const at = layout.order.indexOf(contact);
  assert.deepEqual(layout.order.slice(at, at + 3), [contact, ...layout.buttons.map((b) => b.text)]);
  for (const b of layout.buttons) assert.ok(b.y >= layout.contact.y + layout.contact.height - 1, `${b.text} comes under ${contact}`);
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

