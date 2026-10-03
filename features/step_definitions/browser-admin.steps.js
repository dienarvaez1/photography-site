import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setUpResultsApi } from '../support/browser.js';

const page = (world) => world.b.page;
const tab = (world, name) => page(world).getByRole('tab', { name, exact: true });
const panelOf = async (world, name) => page(world).locator(`#${await tab(world, name).getAttribute('aria-controls')}`);

Then('the tabs should sit side by side on one row, left to right', async function () {
  const boxes = await page(this).getByRole('tab').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  assert.ok(boxes.length >= 2, 'expected more than one tab');
  for (const box of boxes) assert.ok(box.width > 40 && box.height >= 40, `tabs should be a comfortable size to tap: ${JSON.stringify(box)}`);
  for (let i = 1; i < boxes.length; i++) {
    const [prev, curr] = [boxes[i - 1], boxes[i]];
    assert.ok(Math.abs(prev.y - curr.y) <= 2, `on different rows: ${prev.y} vs ${curr.y}`);
    assert.ok(curr.x >= prev.x + prev.width - 1, `tab ${i} is not to the right of tab ${i - 1}: ${JSON.stringify(boxes)}`);
  }
});

Then('the tabs should stack in two rows of three, left to right and top to bottom, all on screen', async function () {
  const { boxes, width, listScrolls } = await page(this).evaluate(() => ({
    boxes: [...document.querySelectorAll('[role="tab"]')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height, lines: el.scrollWidth > el.clientWidth }; }),
    width: document.documentElement.clientWidth,
    listScrolls: (() => { const l = document.querySelector('[role="tablist"]'); return l.scrollWidth > l.clientWidth + 1; })(),
  }));
  assert.equal(boxes.length, 6);
  const rows = [boxes.slice(0, 3), boxes.slice(3)];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      assert.ok(Math.abs(row[i].y - row[0].y) <= 1, `tabs on one row share a top: ${JSON.stringify(row)}`);
      assert.ok(row[i].x >= row[i - 1].right - 1, 'left to right');
    }
  }
  assert.ok(rows[1][0].y >= rows[0][0].y + rows[0][0].height - 1, 'the second three are under the first three');
  for (const box of boxes) {
    assert.ok(box.x >= 0 && box.right <= width + 0.5, `on screen: ${JSON.stringify(box)}`);
    assert.ok(box.height >= 44, `easy to tap: ${box.height}px`);
    assert.equal(box.lines, false, 'no label is cut off');
  }
  assert.equal(listScrolls, false, 'the row of tabs no longer scrolls sideways');
});

Then('the {string} tab should be selected, its panel visible and every other panel hidden', async function (name) {
  assert.equal(await tab(this, name).getAttribute('aria-selected'), 'true');
  const shown = await panelOf(this, name);
  await shown.waitFor({ state: 'visible' });
  const panels = page(this).getByRole('tabpanel', { includeHidden: true });
  assert.ok((await panels.count()) >= 2, 'expected more than one panel');
  const visible = await panels.evaluateAll((els) => els.filter((el) => !el.hidden).map((el) => el.id));
  assert.deepEqual(visible, [await shown.getAttribute('id')], 'exactly the selected tab\'s panel is visible');
  const unselected = await page(this).getByRole('tab').evaluateAll((els) => els.filter((el) => el.getAttribute('aria-selected') === 'false').map((el) => el.tabIndex));
  assert.deepEqual(unselected, unselected.map(() => -1), 'every other tab is out of the tab order');
});

When('I click the {string} tab', async function (name) {
  await tab(this, name).click();
});

When('I focus the {string} tab', async function (name) {
  await tab(this, name).focus();
});

Then('the {string} tab should be selected and focused', async function (name) {
  assert.equal(await tab(this, name).getAttribute('aria-selected'), 'true');
  assert.equal(await page(this).evaluate(() => document.activeElement.getAttribute('role')), 'tab');
  assert.equal(await page(this).evaluate(() => document.activeElement.textContent.trim()), name);
});

Then('keyboard focus should be on the {string} panel', async function (name) {
  const panelId = await tab(this, name).getAttribute('aria-controls');
  assert.equal(await page(this).evaluate(() => document.activeElement.id), panelId);
});

Then('every panel should be visible', async function () {
  const panels = page(this).getByRole('tabpanel');
  const count = await panels.count();
  assert.ok(count >= 2, 'expected more than one panel');
  for (let i = 0; i < count; i++) assert.ok(await panels.nth(i).isVisible(), `panel ${i} is hidden without JavaScript`);
});

Then('the {string} link should sit to the right of the {string} link in the header', async function (right, left) {
  const box = (name) => page(this).locator('#primary-nav > a', { hasText: name }).first().boundingBox();
  const [l, r] = [await box(left), await box(right)];
  assert.ok(Math.abs(l.y - r.y) <= 4, 'same row');
  assert.ok(r.x >= l.x + l.width - 1, `${right} is not to the right of ${left}`);
});

Then('the header should offer no {string} link', async function (name) {
  assert.equal(await page(this).locator('#primary-nav > a', { hasText: name }).count(), 0, `an "${name}" link is in the header`);
});

When('I click the header link {string}', async function (name) {
  await page(this).locator('#primary-nav > a', { hasText: name }).first().click();
  await page(this).waitForLoadState('load');
});

Then('the page should offer only the admin token box and its button', async function () {
  await page(this).locator('#admin-token').waitFor({ state: 'visible', timeout: 8000 });
  // Everything in the page's main part that can be seen or used: the heading, the gate's text, the box and the button.
  const usable = await page(this).locator('main').locator('input, button, select, textarea, a[href], [tabindex="0"], [role="tab"], [role="tabpanel"]').evaluateAll((els) => els
    .filter((e) => e.offsetParent)
    .map((e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}`));
  assert.deepEqual(usable, ['input#admin-token', 'button'], 'only the token box and its button');
  assert.equal(await page(this).locator('[data-tabs]').isHidden(), true, 'no tabs');
  assert.equal(await page(this).locator('main h2, main .results-intro').evaluateAll((els) => els.filter((e) => e.offsetParent).length), 0, 'no tab titles or descriptions');
});

Then('no local service or API should have been asked for anything', async function () {
  const asked = await page(this).evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name)).filter((u) => u.pathname.startsWith('/__') || u.pathname.startsWith('/api/photos')).map((u) => u.pathname));
  assert.deepEqual(asked, []);
});

Then('the token box should say {string}', async function (text) {
  // The rendered text (innerText), which includes a <noscript> message when JavaScript is off: Playwright's own text
  // search never looks inside <noscript>.
  const box = page(this).locator('[data-admin-gate]');
  const end = Date.now() + 8000;
  while (!(await box.innerText()).replace(/\s+/g, ' ').includes(text)) {
    if (Date.now() > end) assert.fail(`the token box says "${(await box.innerText()).trim()}", not "${text}"`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

// Signed in as the token box leaves it: an accepted token kept for the browser tab (admin-common.ts `remembered`),
// with the results API knowing it. For scenarios about what the tabs do, not about signing in (admin-gate.feature).
Given('I am signed in to the Admin page', async function () {
  if (!this.b.results.env.ADMIN_TOKEN) await setUpResultsApi(this, 'browser-test-admin-token', []);
  const token = this.b.results.env.ADMIN_TOKEN;
  this.b.results.token = token;
  this.b.initScripts.push(`try { sessionStorage.setItem('admin-token', ${JSON.stringify(token)}); sessionStorage.setItem('admin-token-seen', String(Date.now())); } catch {}`);
});

Then('no tab, tab title or tab description should be shown', async function () {
  assert.equal(await page(this).locator('[data-tabs]').isHidden(), true);
  assert.equal(await page(this).locator('main').locator('[role="tab"], [role="tabpanel"], h2, .results-intro').evaluateAll((els) => els.filter((e) => e.offsetParent).length), 0);
});

Given('the results API has no sign-in route yet', function () {
  this.b.results.noAuthRoute = true;
});

// --- Hovering over a tab --------------------------------------------------------------------------------------------------

const look = (world, name) =>
  tab(world, name).evaluate((el) => {
    const css = getComputedStyle(el);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    // The accent as the browser writes colors, for comparing borders and bars.
    const probe = document.createElement('span');
    probe.style.color = accent;
    document.body.append(probe);
    const gold = getComputedStyle(probe).color;
    probe.remove();
    return { background: css.backgroundColor, border: css.borderTopColor, shadow: css.boxShadow, gold };
  });

When('I hover over the {string} tab', async function (name) {
  await tab(this, name).hover();
  await new Promise((resolve) => setTimeout(resolve, 250)); // the highlight fades in
});

Then('the {string} tab should be highlighted: a gold-tinted face, a gold border and a gold bar along its bottom', async function (name) {
  const hovered = await look(this, name);
  await page(this).mouse.move(1, 1);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const resting = await look(this, name);
  assert.notEqual(hovered.background, resting.background, 'the face changes');
  assert.equal(hovered.border, hovered.gold, 'a gold border');
  assert.match(hovered.shadow, /inset/, 'a bar');
  assert.ok(hovered.shadow.includes(hovered.gold) && /-3px/.test(hovered.shadow), `a gold bar along the bottom: ${hovered.shadow}`);
  assert.notEqual(resting.border, resting.gold, 'no gold border at rest');
});

Then('the {string} tab should still look chosen: its dark face and its bar on top', async function (name) {
  const chosen = await look(this, name);
  assert.ok(chosen.shadow.includes(chosen.gold) && /\b3px\b/.test(chosen.shadow) && !/-3px/.test(chosen.shadow), `its bar on top: ${chosen.shadow}`);
});

Then('the {string} tab should not take the hover highlight', async function (name) {
  const hovered = await look(this, name);
  assert.ok(!/-3px/.test(hovered.shadow), `no bottom bar on the chosen tab: ${hovered.shadow}`);
  assert.notEqual(hovered.border, hovered.gold, 'no gold border on the chosen tab');
});

Then('the {string} tab\'s highlight should be the same color as {string} when highlighted', async function (name, link) {
  await tab(this, name).hover();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const face = (await look(this, name)).background;
  await page(this).locator(`.primary-nav > a:text-is("${link}")`).first().hover();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const about = await page(this).locator(`.primary-nav > a:text-is("${link}")`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(face, about, `the tab ${face}, ${link} ${about}`);
});

// --- The token page, centred ------------------------------------------------------------------------------------------

Then('the token box should be centred across the page, between the header and the footer, with "ADMIN" and the title flush with its left edge', async function () {
  await page(this).locator('.results-gate').waitFor({ state: 'visible' });
  const r = await page(this).evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const textLeft = (sel) => { const range = document.createRange(); range.selectNodeContents(document.querySelector(sel)); return range.getBoundingClientRect().left; };
    const middle = document.documentElement.clientWidth / 2;
    const [form, header, footer, title] = ['.results-gate', '.site-header', '.site-footer', '.admin h1'].map(box);
    return { form: form.x + form.width / 2 - middle, formLeft: form.left, eyebrow: textLeft('.admin .eyebrow'), title: textLeft('.admin h1'), above: title.top - header.bottom, below: footer.top - form.bottom };
  });
  assert.ok(Math.abs(r.form) <= 2, `the form is off centre by ${r.form}px`);
  assert.ok(Math.abs(r.eyebrow - r.formLeft) <= 2 && Math.abs(r.title - r.formLeft) <= 2, `ADMIN starts at ${r.eyebrow}px and the title at ${r.title}px; the form at ${r.formLeft}px`);
  assert.ok(r.above > 40 && r.below > 40 && Math.abs(r.above - r.below) < 80, `room above ${r.above}px and below ${r.below}px`);
});

Then('the title should be back at the left of the page', async function () {
  await page(this).locator('[data-tabs]').waitFor({ state: 'visible' });
  const r = await page(this).evaluate(() => ({ title: document.querySelector('.admin h1').getBoundingClientRect().x, content: document.querySelector('.admin').getBoundingClientRect().x + parseFloat(getComputedStyle(document.querySelector('.admin')).paddingLeft) }));
  assert.ok(Math.abs(r.title - r.content) <= 2, `title at ${r.title}px, content starts at ${r.content}px`);
});
