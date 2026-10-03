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

Given('today is {string} in UTC', function (day) {
  this.b.today = `${day}T12:00:00Z`;
});

const toggle = (world) => panel(world).locator('#access-range');
const calendar = (world) => panel(world).locator('#access-calendar');

/** Opens the calendar and clicks a day; `months` goes back that many months first. */
async function clickDay(world, day) {
  if (!(await calendar(world).isVisible())) await toggle(world).click();
  for (let i = 0; i < 24 && !(await calendar(world).locator(`button[data-day="${day}"]`).count()); i++) await calendar(world).getByRole('button', { name: /Previous month|Mes anterior/ }).click();
  await calendar(world).locator(`button[data-day="${day}"]`).click();
}

const settled = (world, text) => eventually(async () => (await toggle(world).innerText()).includes(text) && !(await panel(world).locator('.results-loading').count()), `the days ${text} shown`);

When('I choose the day {string} in the Access Info tab', async function (day) {
  await toggle(this).waitFor({ state: 'visible', timeout: 8000 });
  await clickDay(this, day);
  await clickDay(this, day);
  await eventually(async () => !(await calendar(this).isVisible()) && !(await panel(this).locator('.results-loading').count()), `the day ${day} shown`);
});

When('I choose the days from {string} to {string} in the Access Info tab', async function (from, to) {
  await toggle(this).waitFor({ state: 'visible', timeout: 8000 });
  await clickDay(this, from);
  await clickDay(this, to);
  await eventually(async () => !(await calendar(this).isVisible()) && !(await panel(this).locator('.results-loading').count()), 'the days shown');
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

Then('the day button should read {string}, and the calendar should mark the days {string} as having visits', async function (label, days) {
  await loaded(this);
  await settled(this, label);
  assert.equal((await toggle(this).innerText()).trim(), label);
  await toggle(this).click();
  const marked = await calendar(this).locator('button.logged').evaluateAll((buttons) => buttons.map((b) => b.dataset.day));
  // The calendar shows one month at a time: check the marked days of this month, then the month before.
  const seen = new Set(marked);
  await calendar(this).getByRole('button', { name: /Previous month|Mes anterior/ }).click();
  for (const day of await calendar(this).locator('button.logged').evaluateAll((buttons) => buttons.map((b) => b.dataset.day))) seen.add(day);
  assert.deepEqual([...seen].sort().reverse(), days.split(', '));
  await this.b.page.keyboard.press('Escape');
});

Then('the calendar should not let me choose a day after today, {string}', async function (today) {
  await toggle(this).click();
  const after = await calendar(this).locator('button[data-day]').evaluateAll((buttons, t) => buttons.filter((b) => b.dataset.day > t).map((b) => b.disabled), today);
  assert.ok(after.length > 0 && after.every(Boolean), 'every day after today is unavailable');
  assert.equal(await calendar(this).locator(`button[data-day="${today}"]`).getAttribute('aria-current'), 'date');
  await this.b.page.keyboard.press('Escape');
  assert.equal(await calendar(this).isVisible(), false, 'Escape closes the calendar');
});

Then('the Access Info tab should add up to {int} page visits, {int} photos opened and {int} different addresses', async function (views_, photos, visitors) {
  await loaded(this);
  // Page visits and photos opened sit under their columns' titles; the different addresses in the IP table's title (and
  // nowhere else: there is no separate line for them under the calendar).
  const totals = await panel(this).locator('table.access-groups thead .access-group-total').allInnerTexts();
  const spanish = (await page(this).getAttribute('html', 'lang')) === 'es';
  assert.deepEqual(totals, spanish ? [`Visitas a páginas: ${views_}`, `Fotos abiertas: ${photos}`] : [`Page visits: ${views_}`, `Photos opened: ${photos}`]);
  const addresses = (await panel(this).locator('.access-ip-table thead .access-group-total').innerText()).trim();
  assert.equal(addresses, `${spanish ? 'Direcciones' : 'Addresses'}: ${visitors}`);
  assert.equal(await panel(this).locator('.access-summary dl').count(), 0, 'no separate count of addresses');
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
  // The only tables are the pies', the map's, the addresses' (one row per address, never per visit) and the calendar's
  // month grid: no visit times
  // anywhere, and the addresses only in their own table.
  assert.equal(await panel(this).locator('table:not(.access-groups):not(.access-map-table):not(.access-calendar-grid)').count(), 0);
  const text = await panel(this).innerText();
  assert.ok(!/\d{2}:\d{2}:\d{2}/.test(text), 'no times shown');
  const outside = await panel(this).evaluate((root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('.access-ip-table').forEach((t) => t.remove());
    return clone.textContent;
  });
  assert.ok(!/203\.0\.113\.7|2001:db8::1/.test(outside), 'addresses only in the IP address table');
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

// --- Visits by IP address ---------------------------------------------------------------------------------------------

Then('the IP address table should sit under the world map, titled {string} over {string}', async function (title, total) {
  const table = panel(this).locator('.access-ip-table');
  await table.waitFor({ state: 'visible', timeout: 8000 });
  assert.equal((await table.locator('thead .access-group-title').innerText()).trim(), title);
  assert.equal((await table.locator('thead .access-group-total').innerText()).trim(), total);
  const [map, ips] = await Promise.all([panel(this).locator('.access-map').boundingBox(), table.boundingBox()]);
  assert.ok(ips.y >= map.y + map.height - 1, 'the table comes after the map');
});

Then('the IP address table should list, in order:', async function (table) {
  const ipTable = panel(this).locator('.access-ip-table');
  const heads = (await ipTable.locator('thead tr').nth(1).locator('th').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(heads, table.raw()[0]);
  const rows = await ipTable.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
  assert.deepEqual(rows, table.rows());
});

When('I open the calendar in the Access Info tab', async function () {
  await toggle(this).waitFor({ state: 'visible', timeout: 8000 });
  await toggle(this).click();
  await calendar(this).waitFor({ state: 'visible', timeout: 8000 });
});

// --- Ready-made ranges and long lists ----------------------------------------------------------------------------------

When('I choose the ready-made range {string} in the Access Info tab', async function (name) {
  const quick = panel(this).locator('#access-quick');
  await quick.waitFor({ state: 'visible', timeout: 8000 });
  await quick.selectOption({ label: name });
  await eventually(async () => !(await panel(this).locator('.results-loading').count()) && (await panel(this).locator('#access-quick option:checked').innerText()) === name, `the ${name} range shown`);
});

Then('the Quick range dropdown should offer {string}', async function (names) {
  // Its first option, "Custom", names a range chosen in the calendar and can't be picked itself.
  const options = await panel(this).locator('#access-quick option:not([disabled])').allInnerTexts();
  assert.deepEqual(options, names.split(', '));
});

Given('the access log also holds, on {string}, a visit from each of {int} addresses in {int} countries', function (day, count, countries) {
  const bucket = this.b.results.env.ACCESS;
  const log = bucket.log(`${day}T00:00:00.000Z`);
  for (let i = 0; i < count; i++) log.entries.push({ time: `${day}T13:00:00.000Z`, ip: `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`, page: '/', event: 'view', geo: { country: `Country ${String((i % countries) + 1).padStart(2, '0')}` } });
  bucket.raw(`logs/${day}T00:00:00.000Z.json`, JSON.stringify(log));
});

const ipPager = (world) => panel(world).locator('.access-ips .pager');

Then(/^the IP address table should show (\d+) rows and say "([^"]+)"(, with no next arrow)?$/, async function (rows, status, noNext) {
  await eventually(async () => (await ipPager(this).locator('.pager-status').innerText()).trim() === status, `the pager says ${status}`);
  assert.equal(await panel(this).locator('.access-ip-table tbody tr').count(), Number(rows));
  if (noNext) assert.equal(await ipPager(this).getByRole('button', { name: 'Next 50' }).isDisabled(), true);
});

When(/^I press the (next|previous) arrow of the IP address table$/, async function (which) {
  await ipPager(this).getByRole('button', { name: which === 'next' ? 'Next 50' : 'Previous 50' }).click();
});

Then("the map's list of countries should show {int} countries and say {string}", async function (count, status) {
  const box = panel(this).locator('.access-map');
  assert.equal((await box.locator('.pager .pager-status').innerText()).trim(), status);
  assert.equal(await box.locator('ol.map-list > li').count(), count);
});

// --- The calendar's size, on a laptop and a phone ------------------------------------------------------------------------

Then('the calendar should open under its button, at most {int} px wide and {int} px tall', async function (width, height) {
  const [button, box] = await Promise.all([toggle(this).boundingBox(), calendar(this).boundingBox()]);
  assert.ok(box.y >= button.y + button.height - 1, 'under its button');
  assert.ok(box.width <= width, `${box.width} px wide`);
  assert.ok(box.height <= height, `${box.height} px tall`);
});

Then('the calendar should sit at the bottom of the screen, across its whole width, inside the screen', async function () {
  const box = await calendar(this).boundingBox();
  const { width, height } = this.b.page.viewportSize();
  assert.ok(Math.abs(box.x) <= 1 && Math.abs(box.width - width) <= 1, `across the screen: x ${box.x}, ${box.width} of ${width} px`);
  assert.ok(Math.abs(box.y + box.height - height) <= 1, `at the bottom: ends at ${box.y + box.height} of ${height} px`);
  assert.ok(box.y >= 0, 'starts inside the screen');
});

Then('every day, arrow and button in the calendar should be at least {int} px tall', async function (min) {
  const heights = await calendar(this).locator('.access-calendar-day, .access-calendar-nav, .access-calendar-foot button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height));
  assert.ok(heights.length > 30);
  assert.ok(heights.every((h) => h >= min - 0.5), `smallest: ${Math.min(...heights)} px`);
});

Then('the date field and the Quick range dropdown should be at least {int} px tall', async function (min) {
  for (const control of [toggle(this), panel(this).locator('#access-quick')]) {
    const box = await control.boundingBox();
    assert.ok(box.height >= min - 0.5, `${box.height} px tall`);
  }
});

When('I tap {string} in the calendar', async function (name) {
  await calendar(this).getByRole('button', { name, exact: true }).tap();
});

When('I click outside the calendar', async function () {
  // The tab's heading: away from the calendar and its button.
  await panel(this).locator('h2').first().click();
});

Then('the calendar should be closed', async function () {
  await eventually(async () => !(await calendar(this).isVisible()), 'the calendar closed');
  assert.equal(await toggle(this).getAttribute('aria-expanded'), 'false');
});

// --- The pies on a phone ------------------------------------------------------------------------------------------------

/** The middle of a slice's own area, on screen (a thin slice's bounding box can lie mostly over its neighbours). */
const sliceMiddle = (target) =>
  target.evaluate((path) => {
    const edge = path.getPointAtLength(path.getTotalLength() * 0.5);
    const matrix = path.getScreenCTM();
    const inside = { x: 100 + (edge.x - 100) * 0.6, y: 100 + (edge.y - 100) * 0.6 };
    return { x: matrix.a * inside.x + matrix.e, y: matrix.d * inside.y + matrix.f };
  });

When(/^I tap the slice "([^"]+)" of the (pages|photos) pie$/, async function (label, kind) {
  await loaded(this);
  const target = slice(this, kind, label);
  await target.scrollIntoViewIfNeeded();
  const point = await sliceMiddle(target);
  await page(this).touchscreen.tap(point.x, point.y);
});

When('I tap outside the pies', async function () {
  const heading = panel(this).locator('h2').first();
  await heading.scrollIntoViewIfNeeded();
  const box = await heading.boundingBox();
  await page(this).touchscreen.tap(box.x + 5, box.y + box.height / 2);
});

Then("no pie's tooltip should be shown", async function () {
  await eventually(async () => (await panel(this).locator('.pie-tooltip:visible').count()) === 0, 'every tooltip hidden');
});

Then('the two pies should sit side by side, each at most {int} px wide, inside the screen', async function (max) {
  await loaded(this);
  const [a, b] = await Promise.all([pie(this, 'pages').locator('.pie-plot').boundingBox(), pie(this, 'photos').locator('.pie-plot').boundingBox()]);
  const { width } = page(this).viewportSize();
  assert.ok(Math.abs(a.y - b.y) <= 2, `side by side: tops at ${a.y} and ${b.y}`);
  for (const box of [a, b]) {
    assert.ok(box.width <= max, `${box.width} px wide`);
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'inside the screen');
  }
});

Then('the pies\' legends should be hidden, with {string} under them', async function (hint) {
  await loaded(this);
  for (const kind of ['pages', 'photos']) {
    const legend = pie(this, kind).locator('.pie-legend');
    const box = await legend.boundingBox();
    assert.ok(!box || box.width <= 1, 'the legend takes no room on screen');
    // Still there for a screen reader, and every slice is named too.
    assert.ok((await legend.locator('li').count()) > 0);
  }
  const shown = panel(this).locator('.pie-touch-hint');
  assert.equal(await shown.isVisible(), true);
  assert.equal((await shown.innerText()).trim(), hint);
});

Then('the pies\' legends should be shown under them, with no tap hint', async function () {
  await loaded(this);
  for (const kind of ['pages', 'photos']) {
    const [plot, legend] = await Promise.all([pie(this, kind).locator('.pie-plot').boundingBox(), pie(this, kind).locator('.pie-legend').boundingBox()]);
    assert.ok(legend.width > 50 && legend.y >= plot.y + plot.height - 1, 'a visible legend under the pie');
  }
  assert.equal(await panel(this).locator('.pie-touch-hint').isVisible(), false);
});

Then("the IP address table's rows and column headers should be smaller than the page's text, and its title should not", async function () {
  await loaded(this);
  const sizes = await panel(this).locator('.access-ip-table').evaluate((table) => {
    const px = (node) => parseFloat(getComputedStyle(node).fontSize);
    return {
      body: px(document.body),
      cell: px(table.querySelector('tbody td')),
      address: px(table.querySelector('tbody th')),
      column: px(table.querySelector('thead tr + tr th')),
      title: px(table.querySelector('thead .access-group-title')),
    };
  });
  for (const key of ['cell', 'address', 'column']) assert.ok(sizes[key] < sizes.body, `${key}: ${sizes[key]} px, page ${sizes.body} px`);
  assert.ok(sizes.title >= sizes.body, `title: ${sizes.title} px`);
});

Then("the country list, the map's legend and the pies' legends should be the same size as the IP address table's rows", async function () {
  await loaded(this);
  const sizes = await panel(this).evaluate((root) => {
    const px = (selector) => parseFloat(getComputedStyle(root.querySelector(selector)).fontSize);
    return { ip: px('.access-ip-table tbody td'), countries: px('.map-list li'), legend: px('.map-legend'), pies: px('.pie-legend li'), title: px('.access-map-table thead .access-group-title') };
  });
  for (const key of ['countries', 'legend', 'pies']) assert.equal(sizes[key], sizes.ip, `${key}: ${sizes[key]} px, IP rows ${sizes.ip} px`);
  assert.ok(sizes.title > sizes.ip, `the map's title stays larger: ${sizes.title} px`);
});

Then('"Days \\(UTC)", the date field, the Quick range dropdown and the calendar should be the same size as the IP address table\'s rows', async function () {
  await loaded(this);
  await toggle(this).click();
  await calendar(this).waitFor({ state: 'visible', timeout: 8000 });
  const sizes = await panel(this).evaluate((root) => {
    const px = (selector) => parseFloat(getComputedStyle(root.querySelector(selector)).fontSize);
    return {
      ip: px('.access-ip-table tbody td'),
      label: px('.access-range-label'),
      field: px('#access-range'),
      quick: px('#access-quick'),
      month: px('.access-calendar-select'),
      weekday: px('.access-calendar-grid th'),
      day: px('.access-calendar-day'),
      hint: px('.access-calendar-hint'),
      close: px('.access-calendar-close'),
    };
  });
  for (const [key, size] of Object.entries(sizes)) assert.equal(size, sizes.ip, `${key}: ${size} px, IP rows ${sizes.ip} px`);
  await page(this).keyboard.press('Escape');
});

Then("the date field and the dropdowns should be 16 px, so iOS doesn't zoom the page when one is tapped", async function () {
  const sizes = await panel(this).evaluate((root) => [...root.querySelectorAll('#access-range, #access-quick, .access-calendar-select')].map((node) => parseFloat(getComputedStyle(node).fontSize)));
  assert.equal(sizes.length, 4);
  assert.ok(sizes.every((size) => size >= 16), `sizes: ${sizes.join(', ')} px`);
});

Then("the world map's list of countries should be flush left, under the start of its legend", async function () {
  const box = panel(this).locator('.access-map');
  const legend = await box.locator('.map-legend').boundingBox();
  const names = await box.locator('ol.map-list > li .access-name').evaluateAll((spans) => spans.map((s) => s.getBoundingClientRect().left));
  assert.ok(names.length > 0);
  for (const left of names) assert.ok(Math.abs(left - legend.x) <= 1, `a name starts at ${left} px, the legend at ${legend.x} px`);
});

Then("the world map's counts should line up in one column, starting at most {int} px after the longest country name", async function (max) {
  const rows = await panel(this).locator('.access-map ol.map-list > li').evaluateAll((items) =>
    items.map((li) => ({ nameEnd: li.querySelector('.access-name').getBoundingClientRect().right, countStart: li.querySelector('.access-times').getBoundingClientRect().left })));
  assert.ok(rows.length > 1);
  const starts = new Set(rows.map((r) => Math.round(r.countStart)));
  assert.equal(starts.size, 1, `counts start at ${[...starts].join(', ')} px`);
  const gap = rows[0].countStart - Math.max(...rows.map((r) => r.nameEnd));
  assert.ok(gap > 0 && gap <= max, `${gap} px between the longest name and the counts`);
});
