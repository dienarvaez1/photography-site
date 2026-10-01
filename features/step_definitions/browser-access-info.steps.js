import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setUpAccessLog, signInSettled } from '../support/browser.js';
import { daysFromRows } from '../support/access-fixtures.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-access-info');
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until the check passes (the pages and the viewer answer asynchronously). */
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

Given('the access log holds:', function (table) {
  setUpAccessLog(this, daysFromRows(table.hashes()));
});

Given('the access log holds nothing', function () {
  setUpAccessLog(this, []);
});

Given('the access log also holds, on {string}, one visit each to {string}', function (day, pages) {
  const bucket = this.b.results.env.ACCESS;
  const log = bucket.log(`${day}T00:00:00.000Z`);
  for (const page of pages.split(', ')) log.entries.push({ time: `${day}T12:00:00.000Z`, ip: '192.0.2.50', page, event: 'view' });
  bucket.raw(`logs/${day}T00:00:00.000Z.json`, JSON.stringify(log));
});

// --- What the pages report --------------------------------------------------------------------------------------------

When('I open the first photo in the lightbox', async function () {
  const tiles = page(this).locator('.gallery [data-id]');
  this.galleryIds = await tiles.evaluateAll((all) => all.map((tile) => [tile.dataset.id, tile.dataset.category]));
  await tiles.first().click();
  await page(this).locator('.lightbox:not([hidden])').waitFor({ state: 'visible', timeout: 8000 });
});

When('I switch the gallery to the category {string}', async function (slug) {
  await page(this).locator(`a.filter-pill[data-slug="${slug}"]`).click();
  await page(this).waitForURL(new RegExp(`/work/${slug}/$`), { timeout: 8000 });
});

const views = (world) => world.b.accessReports.filter((r) => r.event === 'view').map((r) => r.page);

Then('the pages should have reported, in order, visits to {string}', async function (list) {
  const expected = list.split(', ');
  await eventually(() => JSON.stringify(views(this)) === JSON.stringify(expected), `visits reported as ${list} (reported: ${JSON.stringify(this.b.accessReports)})`);
  await settle(300);
  assert.deepEqual(views(this), expected, 'each visit reported once');
});

Then("every report should have come from the site's own pages", function () {
  assert.ok(this.b.accessReports.length > 0);
  for (const report of this.b.accessReports) {
    assert.equal(report.origin, this.b.siteOrigin);
    assert.deepEqual(Object.keys(report).sort(), ['event', 'origin', 'page'], JSON.stringify(report));
  }
});

Then('the pages should have reported a visit to {string}, then the first two photos of the gallery opened there', async function (path) {
  const [[first, firstCategory], [second, secondCategory]] = this.galleryIds;
  const expected = [
    { origin: this.b.siteOrigin, page: path, event: 'view' },
    { origin: this.b.siteOrigin, page: path, event: 'photo', photo: { id: first, category: firstCategory } },
    { origin: this.b.siteOrigin, page: path, event: 'photo', photo: { id: second, category: secondCategory } },
  ];
  await eventually(() => this.b.accessReports.length >= 3, `three reports (reported: ${JSON.stringify(this.b.accessReports)})`);
  await settle(300);
  assert.deepEqual(this.b.accessReports, expected);
});

// --- The Access Info tab ----------------------------------------------------------------------------------------------

const gateField = (world) => page(world).locator('#admin-token');

When('I sign in to the Access Info tab with the token {string}', async function (token) {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await gateField(this).fill(token);
  await gateField(this).press('Enter');
  await signInSettled(this);
});

const loaded = (world) => eventually(async () => !(await panel(world).locator('.results-loading').count()) && (await panel(world).locator('.access-summary, .results-empty, .results-error').count()) > 0, 'the Access Info tab loaded');

When('I choose the day {string} in the Access Info tab', async function (label) {
  await panel(this).getByLabel('Day (UTC)').waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).getByLabel('Day (UTC)').selectOption({ label });
  await eventually(async () => (await panel(this).getByLabel('Day (UTC)').inputValue()).startsWith(label) && !(await panel(this).locator('.results-loading').count()), `the day ${label} shown`);
});

Then('the Access Info tab should ask for the admin token', async function () {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await page(this).getByLabel('Admin token').waitFor({ state: 'visible' });
  assert.equal(await page(this).locator('[data-tabs]').isHidden(), true, 'the tabs stay hidden until the token is accepted');
});

Then('the results API should not have been asked for the access log', async function () {
  await settle(300);
  assert.deepEqual(this.b.results.requests.filter((r) => r.path.startsWith('/access')).map((r) => r.path), []);
});

Then('the Access Info tab should show the day {string}, with the days {string} to choose from', async function (day, days) {
  await loaded(this);
  const select = panel(this).getByLabel('Day (UTC)');
  assert.equal((await select.inputValue()).slice(0, 10), day);
  assert.deepEqual(await select.locator('option').allInnerTexts(), days.split(', '));
});

Then('the Access Info tab should add up to {int} page visits, {int} photos opened and {int} different addresses', async function (views_, photos, visitors) {
  await loaded(this);
  // Page visits and photos opened sit under their columns' titles; different addresses above the table.
  const totals = await panel(this).locator('table.access-groups thead .access-group-total').allInnerTexts();
  const spanish = (await page(this).getAttribute('html', 'lang')) === 'es';
  assert.deepEqual(totals, spanish ? [`Visitas a páginas: ${views_}`, `Fotos abiertas: ${photos}`] : [`Page visits: ${views_}`, `Photos opened: ${photos}`]);
  assert.deepEqual((await panel(this).locator('.access-summary dd').allInnerTexts()).map(Number), [visitors]);
});

Then('the table of pies should have no row of counts under the pies', async function () {
  await loaded(this);
  // The legends already give every slice's count and share: the table is the titles, then the pies, and nothing else.
  assert.deepEqual(await panel(this).locator('table.access-groups tbody tr').evaluateAll((rows) => rows.map((tr) => tr.className)), ['access-charts']);
  assert.equal(await panel(this).locator('table.access-groups .access-ranked').count(), 0);
});

Then('the Access Info tab should say {string}', async function (text) {
  // Signed out (a refused token, the idle timeout), the tab is hidden and the page's token box says it instead.
  await panel(this).or(page(this).locator('[data-admin-gate]')).getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8000 });
});

// --- The pies ----------------------------------------------------------------------------------------------------------

const pie = (world, kind) => panel(world).locator(`.access-charts [data-group="${kind}"] .pie-figure`);
const heading = { 'most visited pages': 'pages', 'most opened photos': 'photos' };
// Spanish percentages carry a no-break space ("67 %"): compared as an ordinary one.
const plain = (text) => text.replace(/\s+/g, ' ').trim();

Then(/^under the (most visited pages|most opened photos), a pie should share them out as "(.+)"$/, async function (list, expected) {
  await loaded(this);
  const kind = heading[list];
  // One table, two columns by two rows: the titles, then each pie with its legend.
  const layout = await panel(this).locator('table.access-groups').evaluate((table) => ({
    titles: [...table.tHead.rows[0].cells].map((th) => `${th.tagName.toLowerCase()} ${th.querySelector('.access-group-title').textContent}`),
    rows: [...table.tBodies[0].rows].map((tr) => [...tr.cells].map((td) => `${td.dataset.group}: ${[...td.children].map((child) => child.tagName.toLowerCase()).join(' ')}`)),
  }));
  const spanish = (await page(this).getAttribute('html', 'lang')) === 'es';
  assert.deepEqual(layout.titles, spanish ? ['th Páginas más visitadas', 'th Fotos más abiertas'] : ['th Most visited pages', 'th Most opened photos']);
  assert.equal(layout.rows.length, 1);
  assert.match(layout.rows[0][kind === 'pages' ? 0 : 1], new RegExp(`^${kind}: figure$`));
  const legend = await pie(this, kind).locator('.pie-legend li').evaluateAll((rows) => rows.map((li) => `${li.querySelector('.pie-legend-label').textContent}: ${li.querySelector('.pie-legend-value').textContent}`));
  assert.equal(plain(legend.join(', ')), expected);
  const slices = await pie(this, kind).locator('.pie-slice').evaluateAll((paths) => paths.map((path) => [path.getAttribute('aria-label'), path.getAttribute('class'), path.getAttribute('tabindex')]));
  assert.equal(slices.length, legend.length, 'one slice per legend row');
  // Every slice is named the way its legend row reads, reachable with the keyboard, and colored by its place.
  slices.forEach(([label, className, tabindex], i) => {
    assert.equal(plain(label), plain(legend[i]));
    assert.equal(tabindex, '0');
    assert.match(className, legend[i].startsWith('Other') ? /\bpie-other\b/ : new RegExp(`\\bpie-slot-${i + 1}\\b`));
  });
});

Then('no table of the raw entries should be shown', async function () {
  // The only tables are the pies' and the map's: no times or addresses anywhere on the tab.
  assert.equal(await panel(this).locator('table:not(.access-groups):not(.access-map-table)').count(), 0);
  const text = await panel(this).innerText();
  assert.ok(!/\d{2}:\d{2}:\d{2}|203\.0\.113\.7|2001:db8::1/.test(text), 'no times or addresses shown');
});

Then("the groups' table should have light gray lines", async function () {
  const colors = await panel(this).locator('table.access-groups').evaluate((table) => [table, table.querySelector('th'), table.querySelector('td')].map((node) => getComputedStyle(node).borderTopColor));
  // #c9c8c1: light and gray (equal-ish channels), well above the page's near-black.
  for (const color of colors) {
    const [r, g, b] = color.match(/\d+/g).map(Number);
    assert.ok(Math.min(r, g, b) >= 180 && Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${color} is a light gray`);
  }
});

Then('no pie should be shown', async function () {
  await loaded(this);
  assert.equal(await panel(this).locator('.pie-figure').count(), 0);
});

// A slice by the name its accessible label starts with ("American Buffalo: 1 open · 33%").
const slice = (world, kind, label) => pie(world, kind).locator(`.pie-slice[aria-label^="${label}: "]`);

When(/^I hover over the slice "([^"]+)" of the (pages|photos) pie$/, async function (label, kind) {
  await loaded(this);
  const target = slice(this, kind, label);
  await target.scrollIntoViewIfNeeded();
  // The middle of the slice's own area: a thin slice's bounding box can lie mostly over its neighbors.
  const point = await target.evaluate((path) => {
    const length = path.getTotalLength();
    const edge = path.getPointAtLength(length * 0.5);
    const matrix = path.getScreenCTM();
    const centre = { x: 100, y: 100 };
    const inside = { x: centre.x + (edge.x - centre.x) * 0.6, y: centre.y + (edge.y - centre.y) * 0.6 };
    return { x: matrix.a * inside.x + matrix.e, y: matrix.d * inside.y + matrix.f };
  });
  await page(this).mouse.move(point.x, point.y);
});

When('I move the pointer off the pie', async function () {
  await page(this).mouse.move(1, 1);
});

When(/^I focus the slice "([^"]+)" of the (pages|photos) pie with the keyboard$/, async function (label, kind) {
  await loaded(this);
  // Keyboard focus, as Tab gives it (every slice has tabindex 0; the scenario on the legend checks that).
  await slice(this, kind, label).focus();
  assert.equal(await slice(this, kind, label).evaluate((path) => path === document.activeElement), true);
});

Then(/^the (pages|photos) pie's tooltip should say "([^"]+)" for "([^"]+)"$/, async function (kind, value, label) {
  const tip = pie(this, kind).locator('.pie-tooltip');
  await tip.waitFor({ state: 'visible', timeout: 4000 });
  assert.equal(plain(await tip.locator('strong').innerText()), value, 'the number leads');
  assert.equal(plain(await tip.locator('.pie-tip-label').innerText()), label, 'the name follows');
  assert.equal(await tip.locator('.pie-key').count(), 1, 'keyed by a stroke of the slice color');
});

Then(/^the (pages|photos) pie's tooltip should be hidden$/, async function (kind) {
  await pie(this, kind).locator('.pie-tooltip').waitFor({ state: 'hidden', timeout: 4000 });
});

// --- The world map ------------------------------------------------------------------------------------------------------

const map = (world) => panel(world).locator('.access-map');
const country = (world, name) => map(world).locator(`.map-country[data-country="${name}"]`);

Then('the world map should sit under the pies', async function () {
  await loaded(this);
  const order = await panel(this).locator('.access-map, .access-groups-wrap').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]));
  assert.deepEqual(order, ['access-groups-wrap', 'access-map']);
});

Then('the world map should draw every country, shading only {string}', async function (names) {
  await loaded(this);
  assert.ok((await map(this).locator('.map-country').count()) >= 170, 'the whole world');
  const shaded = await map(this).locator('.map-country:not(.map-none)').evaluateAll((els) => els.map((e) => e.dataset.country).sort());
  assert.deepEqual(shaded, names.split(', ').sort());
});

Then('on the world map, {string} should be in band {int}, {string} in band {int} and {string} in band {int}', async function (a, ba, b, bb, c, bc) {
  for (const [name, band] of [[a, ba], [b, bb], [c, bc]]) assert.match(await country(this, name).getAttribute('class'), new RegExp(`\\bmap-band-${band}\\b`), name);
});

Then("the world map's legend should read {string}", async function (expected) {
  const items = await map(this).locator('.map-legend-item').allInnerTexts();
  assert.deepEqual(items.map((t) => t.trim()), expected.split(', '));
});

Then("the world map's list should read {string}", async function (expected) {
  await loaded(this);
  const rows = await map(this).locator('.map-list li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('.access-name').textContent}: ${li.querySelector('.access-times').textContent}`));
  assert.equal(rows.join(', '), expected);
  // One list down the page: each country under the one before it, in a single column.
  const tops = await map(this).locator('.map-list li').evaluateAll((lis) => lis.map((li) => li.getBoundingClientRect()));
  for (let i = 1; i < tops.length; i++) {
    assert.ok(tops[i].top >= tops[i - 1].bottom - 1 && Math.abs(tops[i].left - tops[i - 1].left) < 1, `country ${i + 1} is under country ${i}`);
  }
});

When('I hover over {string} on the world map', async function (name) {
  await loaded(this);
  const target = country(this, name);
  await target.scrollIntoViewIfNeeded();
  // A point inside the country's own shape (its bounding box can be mostly sea, or another country), on screen.
  const point = await target.evaluate((path) => {
    const box = path.getBBox();
    const svg = path.ownerSVGElement;
    for (let step = 0; step < 400; step++) {
      const fx = (step * 0.618) % 1;
      const fy = (step * 0.381) % 1;
      const p = new DOMPoint(box.x + box.width * fx, box.y + box.height * fy);
      if (path.isPointInFill(p) && document.elementFromPoint(...(() => { const s = p.matrixTransform(svg.getScreenCTM()); return [s.x, s.y]; })()) === path) {
        const s = p.matrixTransform(svg.getScreenCTM());
        return { x: s.x, y: s.y };
      }
    }
    return null;
  });
  assert.ok(point, `a point inside ${name}`);
  await page(this).mouse.move(point.x, point.y);
});

When('I focus {string} on the world map with the keyboard', async function (name) {
  await country(this, name).focus();
});

Then('{string} should be highlighted on the world map', async function (name) {
  // Outlined on top of every other country: the highlight traces exactly that country's shape.
  const [outline, shape] = await Promise.all([map(this).locator('.map-highlight').getAttribute('d'), country(this, name).getAttribute('d')]);
  assert.equal(outline, shape);
  const width = await map(this).locator('.map-highlight').evaluate((path) => parseFloat(getComputedStyle(path).strokeWidth));
  assert.ok(width >= 1.5, `outlined (${width}px)`);
});

Then("the world map's tooltip should say {string} for {string}", async function (value, name) {
  const tip = map(this).locator('.map-tooltip');
  await tip.waitFor({ state: 'visible', timeout: 4000 });
  assert.equal((await tip.locator('strong').innerText()).trim(), value, 'the numbers lead');
  assert.equal((await tip.locator('.pie-tip-label').innerText()).trim(), name, 'the name follows');
});

Then("the world map's tooltip should be hidden", async function () {
  await map(this).locator('.map-tooltip').waitFor({ state: 'hidden', timeout: 4000 });
  assert.equal(await map(this).locator('.map-highlight').getAttribute('d'), null, 'and no country highlighted');
});

Then('only {string} should be in the tab order on the world map', async function (names) {
  await loaded(this);
  const focusable = await map(this).locator('.map-country[tabindex="0"]').evaluateAll((els) => els.map((e) => e.dataset.country).sort());
  assert.deepEqual(focusable, names.split(', ').sort());
});

Then('the world map should be in a table with light gray lines, titled {string} over {string}', async function (title, total) {
  const table = map(this).locator('table.access-map-table');
  assert.equal((await table.locator('thead .access-group-title').innerText()).trim(), title);
  assert.equal((await table.locator('thead .access-group-total').innerText()).trim(), total);
  assert.equal(await table.locator('tbody td .world-map').count(), 1, 'the map is in the table');
  const colors = await table.evaluate((t) => [t, t.querySelector('th'), t.querySelector('td')].map((node) => getComputedStyle(node).borderTopColor));
  for (const color of colors) {
    const [r, g, b] = color.match(/\d+/g).map(Number);
    assert.ok(Math.min(r, g, b) >= 180 && Math.max(r, g, b) - Math.min(r, g, b) <= 12, `${color} is a light gray`);
  }
});

// --- The country list's top cities ---------------------------------------------------------------------------------------

const listItem = (world, name) => map(world).locator(`.map-list li[data-country="${name}"]`);
const cityTip = (world) => map(world).locator('.map-city-tooltip');

When("I hover over {string} in the world map's list", async function (name) {
  await loaded(this);
  await listItem(this, name).hover();
});

When("I focus {string} in the world map's list with the keyboard", async function (name) {
  await listItem(this, name).focus();
});

Then("the list's tooltip should name the top cities of {string}: {string}", async function (name, expected) {
  await cityTip(this).waitFor({ state: 'visible', timeout: 4000 });
  assert.equal((await cityTip(this).locator('strong').innerText()).trim(), `Top cities: ${name}`);
  const cities = await cityTip(this).locator('.map-city-list li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('.access-name').textContent}: ${li.querySelector('.access-times').textContent}`));
  assert.equal(cities.join(', '), expected);
  assert.ok(cities.length <= 5, 'at most five');
});

Then("the list's tooltip should say {string} for {string}", async function (text, name) {
  await cityTip(this).waitFor({ state: 'visible', timeout: 4000 });
  assert.equal((await cityTip(this).locator('strong').innerText()).trim(), `Top cities: ${name}`);
  assert.equal((await cityTip(this).locator('.pie-tip-label').innerText()).trim(), text);
});

Then("the list's tooltip should be hidden", async function () {
  await cityTip(this).waitFor({ state: 'hidden', timeout: 4000 });
});

Then('that note should come under the list of countries, with a blank line before and after the list', async function () {
  // The figure's parts, in order: the map, its legend, the list of countries, then the note.
  const order = await map(this).locator('.map-figure').evaluate((figure) => [...figure.children].map((child) => child.className.split(' ').at(-1)));
  assert.deepEqual(order, ['map-plot', 'map-legend', 'map-list-box', 'map-unplaced']);
  const [legend, list, note] = await Promise.all(['.map-legend', '.map-list', '.map-unplaced'].map((selector) => map(this).locator(selector).boundingBox()));
  assert.ok(note.y >= list.y + list.height - 1, 'under the list');
  // A blank line before and after the list (at least a line of its text tall).
  const line = await map(this).locator('.map-list li').first().evaluate((li) => parseFloat(getComputedStyle(li).lineHeight) || li.getBoundingClientRect().height);
  assert.ok(list.y - (legend.y + legend.height) >= line - 1, `a line before the list (${list.y - (legend.y + legend.height)}px)`);
  assert.ok(note.y - (list.y + list.height) >= line - 1, `a line after the list (${note.y - (list.y + list.height)}px)`);
  // Nothing after the note but the cell's own padding.
  const gap = await map(this).locator('.map-unplaced').evaluate((p) => {
    const cell = p.closest('td');
    return cell.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom - parseFloat(getComputedStyle(cell).paddingBottom);
  });
  assert.ok(gap <= 1, `no blank line after the note (${gap}px)`);
});
