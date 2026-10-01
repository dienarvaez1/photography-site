import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { signInSettled } from '../support/browser.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-pics-viewer');
const editBar = (world) => panel(world).locator('[data-edit-bar]');
const row = (world, text) => panel(world).locator('.pic', { hasText: text }).first();

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// --- The checkboxes and the bar -------------------------------------------------------------------------------------------------

Then('the Pics Viewer should show a checkbox on each of its {int} listed photos, none ticked', async function (count) {
  await eventually(async () => (await panel(this).locator('.pic-check').count()) === count, `${count} checkboxes`);
  assert.equal(await panel(this).locator('.pic-check:checked').count(), 0);
});

Then('the photo {string} should have no checkbox', async function (text) {
  assert.equal(await row(this, text).locator('.pic-check').count(), 0);
});

Then('the edit bar should say {string}', async function (text) {
  await eventually(async () => (await editBar(this).innerText()).includes(text), `the edit bar says "${text}"`);
});

Then('the {string} button of the edit bar should be disabled', async function (name) {
  assert.equal(await editBar(this).getByRole('button', { name, exact: true }).isDisabled(), true);
});

Then('the {string} button of the edit bar should be enabled', async function (name) {
  assert.equal(await editBar(this).getByRole('button', { name, exact: true }).isDisabled(), false);
});

When('I click the {string} button of the edit bar', async function (name) {
  await editBar(this).getByRole('button', { name, exact: true }).click();
});

When("I choose {string} from the edit bar's category select", async function (label) {
  await editBar(this).locator('select').selectOption({ label });
});

Then('the {string} button should not be pressed', async function (name) {
  await eventually(async () => (await panel(this).getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'false', `"${name}" not pressed`);
});

Then('no removal bar should be showing', async function () {
  assert.equal(await panel(this).locator('[data-remove-bar]').count(), 0);
});

Then('every photo with a checkbox should be ticked', async function () {
  const total = await panel(this).locator('.pic-check').count();
  assert.ok(total > 0);
  assert.equal(await panel(this).locator('.pic-check:checked').count(), total);
});

Then('the photo {string} should show the category {string}', async function (text, category) {
  await eventually(async () => (await row(this, text).locator('.pic-category').innerText()) === category, `${text} shows category "${category}"`);
});

// --- Quality --------------------------------------------------------------------------------------------------------------------

When('I show the category change in its {string} state', async function (name) {
  const field = page(this).locator('#admin-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
  await signInSettled(this);
  await panel(this).locator('.pics-list').waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'not available') {
    this.b.photoService = null;
    await panel(this).getByRole('button', { name: 'Edit Photos', exact: true }).click();
    await panel(this).getByText('only works while the site runs on your computer', { exact: false }).waitFor({ state: 'visible', timeout: 8000 });
    return;
  }
  await panel(this).getByRole('button', { name: 'Edit Photos', exact: true }).click();
  await editBar(this).waitFor({ state: 'visible', timeout: 8000 });
  if (name === 'choosing') return;
  await row(this, 'Half Moon').locator('.pic-check').check();
  if (name === 'photos ticked') return;
  await editBar(this).locator('select').selectOption({ label: 'Pets' });
});
