import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { signInSettled } from '../support/browser.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-pics-viewer');
const heroBar = (world) => panel(world).locator('[data-hero-bar]');
const row = (world, text) => panel(world).locator('.pic', { hasText: text }).first();

// --- The checkboxes and the bar -------------------------------------------------------------------------------------------------

Then('the home background bar should say {string}', async function (text) {
  await heroBar(this).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
});

Then('the {string} button of the home background bar should be disabled', async function (name) {
  const disabled = await heroBar(this).getByRole('button', { name, exact: true }).isDisabled();
  if (!disabled) throw new Error(`"${name}" is not disabled`);
});

Then('the {string} button of the home background bar should be enabled', async function (name) {
  const disabled = await heroBar(this).getByRole('button', { name, exact: true }).isDisabled();
  if (disabled) throw new Error(`"${name}" is disabled`);
});

When('I click the {string} button of the home background bar', async function (name) {
  await heroBar(this).getByRole('button', { name, exact: true }).click();
});

// --- What the badge says ----------------------------------------------------------------------------------------------------------

Then('the photo {string} should be marked Home background', async function (text) {
  await row(this, text).locator('.results-badge', { hasText: 'Home background' }).waitFor({ state: 'visible', timeout: 8000 });
});

Then('the photo {string} should not be marked Home background', async function (text) {
  const count = await row(this, text).locator('.results-badge', { hasText: 'Home background' }).count();
  if (count !== 0) throw new Error(`"${text}" is still marked Home background`);
});

Then('the photo {string} should not be ticked', async function (text) {
  const checked = await row(this, text).locator('.pic-check').isChecked();
  if (checked) throw new Error(`"${text}"'s checkbox is ticked`);
});

// --- The on/off switches ------------------------------------------------------------------------------------------------------------

const toggle = (world, text) => row(world, text).locator('.pic-switch');

Then('the Pics Viewer should show an on\\/off switch on each of its {int} listed photos, all off', async function (count) {
  await panel(this).locator('.pic-switch').nth(count - 1).waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await panel(this).locator('.pic-switch').count(), count);
  assert.equal(await panel(this).locator('.pic-switch:checked').count(), 0);
  assert.equal(await panel(this).locator('.pic-check:not(.pic-switch)').count(), 0, 'no checkboxes');
});

Then('the photo {string} should have no switch', async function (text) {
  assert.equal(await toggle(this, text).count(), 0);
});

Then('the Pics Viewer should show no switch', async function () {
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await panel(this).locator('.pic-switch').count(), 0);
});

When(/^I switch the photo "([^"]+)" (on|off)$/, async function (text, state) {
  await toggle(this, text).setChecked(state === 'on');
});

Then(/^the switch for "([^"]+)" should be (on|off)$/, async function (text, state) {
  await toggle(this, text).waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await toggle(this, text).isChecked(), state === 'on');
});

Then(/^the row for "([^"]+)" should show (an|no) unsaved change$/, async function (text, which) {
  assert.equal(await row(this, text).evaluate((el) => el.classList.contains('changed')), which === 'an');
});

Then('the home background bar should offer only the buttons {string}', async function (list) {
  assert.deepEqual(await heroBar(this).locator('button').allInnerTexts(), list.split(', '));
});

Then('each switch should be announced as a switch named {string}, at least 44 pixels to tap', async function (pattern) {
  await panel(this).locator('.pic-switch').first().waitFor({ state: 'visible', timeout: 8000 });
  const switches = await panel(this).locator('.pic-switch').evaluateAll((els) =>
    els.map((el) => {
      const target = el.closest('label').getBoundingClientRect();
      return { role: el.getAttribute('role'), name: el.getAttribute('aria-label'), width: target.width, height: target.height };
    }));
  const [before] = pattern.split('<the photo>');
  for (const s of switches) {
    assert.equal(s.role, 'switch');
    assert.ok(s.name.startsWith(before) && s.name.length > before.length, s.name);
    assert.ok(s.width >= 44 && s.height >= 44, JSON.stringify(s));
  }
  const names = await panel(this).getByRole('switch').count();
  assert.equal(names, switches.length, 'reachable by role');
});

Then('every switch and button of the home background bar should be disabled', async function () {
  assert.equal(await panel(this).locator('.pic-switch:not(:disabled)').count(), 0);
  assert.equal(await heroBar(this).locator('button:not(:disabled)').count(), 0);
});

// --- Quality --------------------------------------------------------------------------------------------------------------------

When('I show the home background change in its {string} state', async function (name) {
  const field = page(this).locator('#admin-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
  await signInSettled(this);
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'not available') {
    this.b.photoService = null;
    await panel(this).getByRole('button', { name: 'Home Background', exact: true }).click();
    await panel(this).getByText('only works while the site runs on your computer', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });
    return;
  }
  await panel(this).getByRole('button', { name: 'Home Background', exact: true }).click();
  await heroBar(this).waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'choosing') return;
  await row(this, 'Half Moon').locator('.pic-switch').check();
});

Given('the local photo service takes {int} milliseconds to answer', function (ms) {
  this.b.photoService.delayMs = ms;
});
