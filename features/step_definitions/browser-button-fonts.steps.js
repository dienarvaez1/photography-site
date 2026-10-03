import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;
const look = (el) => { const css = getComputedStyle(el); return { family: css.fontFamily, size: css.fontSize, weight: css.fontWeight }; };

When('I note the font of the Access Info date-range field', async function () {
  const field = page(this).locator('#access-range');
  await field.waitFor({ state: 'visible', timeout: 10000 });
  this.b.controlFont = await field.evaluate(look);
});

Then('the buttons of these tabs should wear exactly that font: {string}', async function (list) {
  for (const name of list.split(', ')) {
    await page(this).getByRole('tab', { name, exact: true }).click();
    const panel = page(this).locator('[role="tabpanel"]:not([hidden])');
    const buttons = panel.locator(':is(.pics-actions, .results-remove-toolbar) button');
    await buttons.first().waitFor({ state: 'attached', timeout: 10000 });
    const fonts = await buttons.evaluateAll((els, source) => els.map((el) => ({ text: el.textContent.trim(), ...new Function(`return (${source})`)()(el) })), look.toString());
    assert.ok(fonts.length > 0, `${name} has buttons`);
    for (const { text, ...font } of fonts) assert.deepEqual(font, this.b.controlFont, `"${text}" on ${name}`);
  }
});

Then('these buttons should wear exactly that font: {string}', async function (list) {
  for (const item of list.split(', ')) {
    const [path, ...selector] = item.split(' ');
    await page(this).goto(`${this.b.siteOrigin}${path}`, { waitUntil: 'load' });
    const button = page(this).locator(selector.join(' ')).first();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    assert.deepEqual(await button.evaluate(look), this.b.controlFont, item);
  }
});

Then('after signing out on {string} the token box\'s Sign in button should wear exactly that font', async function (path) {
  // Signed out where the token box shows (the scenario's own sign-in comes back with every page load).
  await page(this).goto(`${this.b.siteOrigin}${path}`, { waitUntil: 'load' });
  if (await page(this).locator('#nav-toggle').isVisible()) await page(this).locator('#nav-toggle').click(); // a phone: Sign out is in the ☰ menu
  await page(this).locator('[data-action="sign-out"]').click();
  const button = page(this).locator('.results-gate button');
  await button.waitFor({ state: 'visible', timeout: 10000 });
  assert.deepEqual(await button.evaluate(look), this.b.controlFont);
});

Then('the main menu\'s links should be 16px and the category buttons 13.6px, in the site\'s font', async function () {
  const r = await page(this).evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, menu: [...document.querySelectorAll('#primary-nav > a, #primary-nav .nav-label')].map((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontFamily]), pills: [...document.querySelectorAll('.filter-pill')].map((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontFamily]) }));
  for (const [size, family] of r.menu) assert.deepEqual([size, family], ['16px', r.body]);
  for (const [size, family] of r.pills) assert.deepEqual([size, family], ['13.6px', r.body]);
});
