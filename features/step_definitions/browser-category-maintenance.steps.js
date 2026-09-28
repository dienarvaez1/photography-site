import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryPath, writeEntry } from '../../scripts/lib/photos.mjs';
import { startCategoryService } from '../support/browser.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-category-maintenance');
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

After(async function () {
  if (this.b?.categoryFixtureDir) await rm(this.b.categoryFixtureDir, { recursive: true, force: true });
});

// --- Setting the scene ------------------------------------------------------------------------------------------------

Given('a category service is running over a fresh configuration with {string} and a hidden {string}', async function (visible, hidden) {
  const dir = await mkdtemp(join(tmpdir(), 'category-browser-'));
  const contentDir = join(dir, 'content');
  await mkdir(contentDir, { recursive: true });
  const categoriesFile = pathToFileURL(join(dir, 'categories.json'));
  const localeFiles = { en: pathToFileURL(join(dir, 'en.json')), es: pathToFileURL(join(dir, 'es.json')) };
  await writeFile(categoriesFile, `${JSON.stringify([{ slug: visible }, { slug: hidden, hidden: true }], null, 2)}\n`);
  await writeFile(localeFiles.en, `${JSON.stringify({ categories: { [visible]: { label: 'Nature', description: 'The outdoors.' }, [hidden]: { label: 'Drafts', description: 'Not shown.' } } }, null, 2)}\n`);
  await writeFile(localeFiles.es, `${JSON.stringify({ categories: { [visible]: { label: 'Naturaleza', description: 'El aire libre.' }, [hidden]: { label: 'Borradores', description: 'No mostrado.' } } }, null, 2)}\n`);
  this.b.categoryFixtureDir = dir;
  this.b.categoryFixtureContentDir = contentDir;
  await startCategoryService(this, { contentDir, categoriesFile, localeFiles, sync: false });
});

Given('the local category service is not running', function () {
  this.b.categoryService = null;
});

Given('the category {string} in the browser fixture already has a photo', async function (category) {
  await writeEntry(entryPath(this.b.categoryFixtureContentDir, category, '0123456789abcdef'), {
    title: 'A photo', category, photo: { id: '0123456789abcdef', width: 100, height: 100 }, featured: false, order: 1,
  });
});

// --- Signing in --------------------------------------------------------------------------------------------------------------

Then('Category Maintenance should ask for the admin token', async function () {
  await panel(this).locator('#categories-token').waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).getByLabel('Admin token').waitFor({ state: 'visible' });
});

When('I sign in to Category Maintenance with the token {string}', async function (token) {
  const field = panel(this).locator('#categories-token');
  await field.fill(token);
  await field.press('Enter');
  await settle(200);
});

// --- Viewing the list --------------------------------------------------------------------------------------------------

// .category-name specifically, not the whole row: a row's .category-meta also shows its slug (e.g.
// "/work/nature/"), a substring match on the row would still find "Nature" there even after its own
// name changed to something else entirely.
Then('the Category Maintenance list should show a row for {string}', async function (name) {
  await panel(this).locator('.category-name', { hasText: name }).first().waitFor();
});

Then('the Category Maintenance list should not show a row for {string}', async function (name) {
  assert.equal(await panel(this).locator('.category-name', { hasText: name }).count(), 0, `a row for "${name}" is still there`);
});

Then('the Category Maintenance row for {string} should be marked Hidden', async function (name) {
  const row = panel(this).locator('.category-row', { hasText: name }).first();
  await row.locator('.results-badge', { hasText: 'Hidden' }).waitFor();
});

Then('the Category Maintenance row for {string} should show the URL {string}', async function (name, url) {
  const row = panel(this).locator('.category-row', { hasText: name }).first();
  await row.locator('.category-meta', { hasText: url }).waitFor();
});

Then('the Category Maintenance row for {string} should show {int} photo', async function (name, count) {
  const row = panel(this).locator('.category-row', { hasText: name }).first();
  await row.locator('.category-meta', { hasText: count === 1 ? '1 photo' : `${count} photos` }).waitFor();
});

// --- Adding --------------------------------------------------------------------------------------------------------------

When('I open the Add Category form', async function () {
  await panel(this).locator('[data-action="add"]').click();
});

When('I fill in the new category {string}, named {string} and {string}, described as {string} and {string}', async function (slug, label, labelEs, description, descriptionEs) {
  const form = panel(this).locator('.photo-form');
  await form.locator('#category-slug').fill(slug);
  await form.locator('#category-label').fill(label);
  await form.locator('#category-label-es').fill(labelEs);
  await form.locator('#category-description').fill(description);
  await form.locator('#category-description-es').fill(descriptionEs);
});

When('I submit the new category form', async function () {
  await panel(this).locator('.photo-form button[type="submit"]').click();
  await settle(300);
});

Then('the new category form should confirm {string} was added', async function (label) {
  await panel(this).locator('.results-notice', { hasText: label }).waitFor();
});

Then('the new category form should show an error mentioning {string}', async function (text) {
  await panel(this).locator('.photo-form .results-error', { hasText: text }).waitFor();
});

// --- Editing ---------------------------------------------------------------------------------------------------------------

When('I click the Category Maintenance {string} button', async function (label) {
  await panel(this).locator('button', { hasText: label }).first().click();
  await settle(200);
});

When('I tick the Hidden box for {string} and save it', async function (name) {
  const row = panel(this).locator('.category-row', { hasText: name }).first();
  await row.locator('.category-edit-fields input[type="checkbox"]').check();
  await row.locator('.category-edit-fields button', { hasText: 'Save' }).click();
  await settle(300);
});

When('I change the English name of {string} to {string} and save it', async function (name, newName) {
  const row = panel(this).locator('.category-row', { hasText: name }).first();
  await row.getByLabel('Name (English)').fill(newName);
  await row.locator('.category-edit-fields button', { hasText: 'Save' }).click();
  await settle(300);
});

When('I change the slug of {string} to {string} and save it', async function (name, newSlug) {
  const row = panel(this).locator('.category-row', { hasText: name }).first();
  await row.getByLabel('Slug').fill(newSlug);
  await row.locator('.category-edit-fields button', { hasText: 'Save' }).click();
  await settle(300);
});

// --- Removing --------------------------------------------------------------------------------------------------------------

When('I tick the checkbox for {string}', async function (name) {
  await panel(this).locator('.category-row', { hasText: name }).first().locator('.pic-check').check();
});

When('I click {string}', async function (label) {
  await panel(this).locator('button', { hasText: label }).first().click();
  await settle(200);
});

Then('the Category Maintenance page should report that {string} could not be removed', async function (name) {
  await panel(this).locator('.pics-status', { hasText: name }).waitFor();
});

// --- The local service being unavailable ------------------------------------------------------------------------------------

Then("the Category Maintenance page should say Category Maintenance only works on the owner's computer", async function () {
  await panel(this).locator('.pics-status', { hasText: 'only works while the site runs on your computer' }).waitFor();
});
