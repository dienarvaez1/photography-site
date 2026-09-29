import { Given, When, Then } from '@cucumber/cucumber';

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

// --- Reopening with the current members already ticked ---------------------------------------------------------------------------

Then('the photo {string} should not be ticked', async function (text) {
  const checked = await row(this, text).locator('.pic-check').isChecked();
  if (checked) throw new Error(`"${text}"'s checkbox is ticked`);
});

// --- Quality --------------------------------------------------------------------------------------------------------------------

When('I show the home background change in its {string} state', async function (name) {
  const field = panel(this).locator('#pics-token');
  await field.fill('browser-test-admin-token');
  await field.press('Enter');
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
  await row(this, 'Half Moon').locator('.pic-check').check();
});

Given('the local photo service takes {int} milliseconds to answer', function (ms) {
  this.b.photoService.delayMs = ms;
});
