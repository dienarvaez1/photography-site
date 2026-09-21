import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;
const tab = (world, name) => page(world).getByRole('tab', { name, exact: true });
const panelOf = async (world, name) => page(world).locator(`#${await tab(world, name).getAttribute('aria-controls')}`);

Then('the two tabs should sit side by side on one row, the second to the right of the first', async function () {
  const boxes = await page(this).getByRole('tab').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  assert.equal(boxes.length, 2);
  const [first, second] = boxes;
  assert.ok(Math.abs(first.y - second.y) <= 2, `on different rows: ${first.y} vs ${second.y}`);
  assert.ok(second.x >= first.x + first.width - 1, `the second tab is not to the right of the first: ${JSON.stringify(boxes)}`);
  assert.ok(first.width > 40 && second.width > 40 && first.height >= 40, 'tabs should be a comfortable size to tap');
});

Then('the {string} tab should be selected, its panel visible and the other panel hidden', async function (name) {
  assert.equal(await tab(this, name).getAttribute('aria-selected'), 'true');
  const shown = await panelOf(this, name);
  await shown.waitFor({ state: 'visible' });
  const panels = page(this).getByRole('tabpanel', { includeHidden: true });
  assert.equal(await panels.count(), 2);
  const visible = await panels.evaluateAll((els) => els.filter((el) => !el.hidden).map((el) => el.id));
  assert.deepEqual(visible, [await shown.getAttribute('id')], 'exactly the selected tab\'s panel is visible');
  const unselected = await page(this).getByRole('tab').evaluateAll((els) => els.filter((el) => el.getAttribute('aria-selected') === 'false').map((el) => el.tabIndex));
  assert.deepEqual(unselected, [-1], 'the other tab is out of the tab order');
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

Then('both panels should be visible', async function () {
  const panels = page(this).getByRole('tabpanel');
  assert.equal(await panels.count(), 2);
  for (let i = 0; i < 2; i++) assert.ok(await panels.nth(i).isVisible(), `panel ${i} is hidden without JavaScript`);
});

Then('the {string} link should sit to the right of the {string} link in the header', async function (right, left) {
  const box = (name) => page(this).locator('#primary-nav > a', { hasText: name }).first().boundingBox();
  const [l, r] = [await box(left), await box(right)];
  assert.ok(Math.abs(l.y - r.y) <= 4, 'same row');
  assert.ok(r.x >= l.x + l.width - 1, `${right} is not to the right of ${left}`);
});

When('I click the header link {string}', async function (name) {
  await page(this).locator('#primary-nav > a', { hasText: name }).first().click();
  await page(this).waitForLoadState('load');
});
