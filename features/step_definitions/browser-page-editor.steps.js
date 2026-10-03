// The page editor in a real browser: the built pages, the real save service over copies of the site's text files, and
// the real results API's POST /translate with a stand-in translator (features/support/browser.js).
import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadMessages } from '../support/lib.js';
import { open, setUpResultsApi, startPageTextService, useTranslator } from '../support/browser.js';

const page = (world) => world.b.page;
const bar = (world) => page(world).locator('.page-editor');
const field = (world, key) => page(world).locator(`textarea[data-edit-field="${key}"]`);
const unescape = (text) => text.replaceAll('\\n', '\n');
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

After(async function () {
  if (this.b?.pageText?.dir) await rm(this.b.pageText.dir, { recursive: true, force: true });
});

async function copies(world) {
  const dir = await mkdtemp(join(tmpdir(), 'page-editor-'));
  const files = { categoriesFile: join(dir, 'categories.json'), en: join(dir, 'en.json'), es: join(dir, 'es.json') };
  await copyFile(join(ROOT, 'src/config/categories.json'), files.categoriesFile);
  await copyFile(join(ROOT, 'src/i18n/en.json'), files.en);
  await copyFile(join(ROOT, 'src/i18n/es.json'), files.es);
  world.b.pageText = { dir, files, before: { en: await readFile(files.en, 'utf-8'), es: await readFile(files.es, 'utf-8') } };
  return { categoriesFile: pathToFileURL(files.categoriesFile), localeFiles: { en: pathToFileURL(files.en), es: pathToFileURL(files.es) } };
}

Given("the page editor saves into copies of the site's text files", async function () {
  await startPageTextService(this, await copies(this));
});

Given("the page editor's service runs where SITE_ENV is not development", async function () {
  const { categoriesFile, localeFiles } = { categoriesFile: pathToFileURL(this.b.pageText.files.categoriesFile), localeFiles: { en: pathToFileURL(this.b.pageText.files.en), es: pathToFileURL(this.b.pageText.files.es) } };
  await startPageTextService(this, { categoriesFile, localeFiles, allowWrites: false });
});

Given('the translation service translates', function () {
  useTranslator(this);
});

Given('the translation service stops answering', function () {
  useTranslator(this, 'down');
});

Given('I am signed in to the Admin page with a token the API no longer accepts', async function () {
  await setUpResultsApi(this, 'browser-test-admin-token', []);
  this.b.initScripts.push(`try { sessionStorage.setItem('admin-token', 'an-old-token-the-api-refuses'); sessionStorage.setItem('admin-token-seen', String(Date.now())); } catch {}`);
});

When('I click {string} in the page editor', async function (name) {
  await bar(this).getByRole('button', { name, exact: true }).click();
});

When('I change {string} to {string}', async function (key, text) {
  await field(this, key).fill(unescape(text));
});

Then('there should be no {string} button', async function (name) {
  await page(this).waitForLoadState('networkidle');
  assert.equal(await page(this).getByRole('button', { name, exact: true }).count(), 0);
  assert.equal(await bar(this).count(), 0);
});

Then('these texts should be open for editing: {}', async function (list) {
  const keys = list.split(', ');
  await field(this, keys[0]).waitFor({ state: 'visible', timeout: 8000 });
  const open = await page(this).locator('textarea[data-edit-field]').evaluateAll((els) => els.map((e) => e.dataset.editField));
  assert.deepEqual(open, keys);
  for (const key of keys) {
    assert.ok((await field(this, key).inputValue()).trim().length > 0, `${key} holds its current text`);
    assert.equal(await page(this).locator(`[data-edit-key="${key}"]`).isHidden(), true, `${key}'s own text is replaced while editing`);
  }
  assert.ok(await bar(this).getByRole('button', { name: /^(Update|Actualizar)$/ }).isVisible());
});

Then("each of the Portfolio menu's pages should offer {string}, for its own heading and description", async function (name) {
  const { categories } = loadMessages('en');
  const { VISIBLE_CATEGORIES } = await import(join(ROOT, 'src/config/categories.ts'));
  await open(this);
  for (const slug of ['all', ...VISIBLE_CATEGORIES.map((c) => c.slug)]) {
    await page(this).goto(`${this.b.siteOrigin}/work/${slug}/`, { waitUntil: 'networkidle' });
    await bar(this).getByRole('button', { name, exact: true }).click();
    const keys = slug === 'all' ? ['work.allLabel', 'work.allDescription'] : [`categories.${slug}.label`, `categories.${slug}.description`];
    await field(this, keys[0]).waitFor({ state: 'visible', timeout: 8000 });
    if (slug !== 'all') assert.equal(await field(this, keys[0]).inputValue(), categories[slug].label);
    assert.deepEqual(await page(this).locator('textarea[data-edit-field]').evaluateAll((els) => els.map((e) => e.dataset.editField)), keys);
  }
});

Then('the page editor should say {string}', async function (text) {
  await page(this).waitForFunction((t) => document.querySelector('.page-editor-status')?.textContent === t, text, { timeout: 10000 });
});

Then('the page editor should report an error starting {string}', async function (text) {
  await page(this).waitForFunction((t) => { const s = document.querySelector('.page-editor-status'); return s?.dataset.kind === 'error' && s.textContent.startsWith(t); }, text, { timeout: 10000 });
});

Then("the page's {string} should read {string}", async function (key, text) {
  const element = page(this).locator(`[data-edit-key="${key}"]`);
  await element.waitFor({ state: 'visible' });
  assert.equal((await element.innerText()).trim(), text);
});

Then("the page's {string} should read {string} with the email still a link", async function (key, text) {
  const { SITE } = await import(join(ROOT, 'src/config/site.ts'));
  const element = page(this).locator(`[data-edit-key="${key}"]`);
  await element.waitFor({ state: 'visible' });
  assert.equal((await element.innerText()).trim(), text.replace("<the site's email>", SITE.email));
  assert.equal(await element.locator('a[href^="mailto:"]').count(), 1);
});

Then("the page's {string} should show the paragraphs {string}, {string}", async function (key, a, b) {
  assert.deepEqual(await page(this).locator(`[data-edit-key="${key}"] > p`).allInnerTexts(), [a, b]);
});

const saved = async (world, language) => JSON.parse(await readFile(world.b.pageText.files[language === 'English' ? 'en' : 'es'], 'utf-8'));
const at = (messages, key) => key.split('.').reduce((node, part) => node?.[part], messages);

Then('the {word} file should now have {string} as {string}', async function (language, key, text) {
  assert.equal(at(await saved(this, language), key), text);
});

Then('the {word} file should now have {string} as the paragraphs {string}, {string}', async function (language, key, a, b) {
  // The stand-in translates the whole text at once, so only the first paragraph carries its "[es] " mark.
  assert.deepEqual(at(await saved(this, language), key), [a, b]);
});

Then('only {string} should have been sent for translation', function (text) {
  assert.deepEqual(this.b.translations, [text]);
});

Then('nothing should have been sent for translation', function () {
  assert.deepEqual(this.b.translations, []);
});

Then('nothing should be open for editing any more', async function () {
  assert.equal(await page(this).locator('textarea[data-edit-field]').count(), 0);
  assert.ok(await bar(this).getByRole('button', { name: /^(Edit page|Editar página)$/ }).isVisible());
});

Then('both text files should be as they were', async function () {
  const { files, before } = this.b.pageText;
  assert.equal(await readFile(files.en, 'utf-8'), before.en);
  assert.equal(await readFile(files.es, 'utf-8'), before.es);
});

Then('{string} should still be open for editing, holding {string}', async function (key, text) {
  assert.equal(await field(this, key).inputValue(), text);
});

Then('the page editor should be entirely on screen, with buttons at least 44 pixels tall', async function () {
  await page(this).locator('textarea[data-edit-field]').first().waitFor({ state: 'visible' });
  const { box, buttons, width } = await page(this).evaluate(() => ({
    box: document.querySelector('.page-editor').getBoundingClientRect().toJSON(),
    buttons: [...document.querySelectorAll('.page-editor button:not([hidden])')].map((b) => b.getBoundingClientRect().height),
    width: innerWidth,
  }));
  assert.ok(box.x >= 0 && box.right <= width, JSON.stringify(box));
  for (const height of buttons) assert.ok(height >= 44, `${height}px`);
});

// --- Where the controls sit, their red edit mode, and the footer's way back to the Admin page -------------------------

const RED = 'rgb(229, 72, 77)';
const barLook = (world) =>
  page(world).evaluate(() => {
    const bar = document.querySelector('.page-editor');
    const update = [...bar.querySelectorAll('.btn-primary')].find((b) => !b.hidden);
    return { border: getComputedStyle(bar).borderTopColor, update: update ? getComputedStyle(update).backgroundColor : null, right: innerWidth - bar.getBoundingClientRect().right, width: innerWidth };
  });

Then("the page editor's controls should sit at least {int} pixels in from the right edge of the window and {int} up from the bottom", async function (right, bottom) {
  await bar(this).waitFor({ state: 'visible' });
  const box = await bar(this).evaluate((el) => { const r = el.getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom }; });
  assert.ok(box.right >= right, `${box.right}px from the right edge`);
  assert.ok(box.bottom >= bottom, `${box.bottom}px from the bottom`);
});

Then("the page editor's controls should not be red", async function () {
  await bar(this).waitFor({ state: 'visible' });
  await settle(400);
  assert.notEqual((await barLook(this)).border, RED);
});

Then("the page editor's controls should be red, with a red Update button", async function () {
  await page(this).locator('textarea[data-edit-field]').first().waitFor({ state: 'visible' });
  await settle(400); // the buttons' colours fade over 0.15s
  const look = await barLook(this);
  assert.equal(look.border, RED);
  assert.equal(look.update, 'rgb(198, 42, 47)', 'a deeper red behind white text, for contrast');
});

Then("the footer's build should be a link to {string}", async function (path) {
  const link = page(this).locator('.site-footer .build-info a');
  await link.waitFor({ state: 'attached', timeout: 8000 });
  assert.equal(await link.getAttribute('href'), path);
  assert.match(await link.innerText(), /^(Build|Versión|Compilación)\b|v\d|[0-9a-f]{7}/);
});

When("I click the footer's build", async function () {
  await page(this).locator('.site-footer .build-info a').click();
  await page(this).waitForLoadState('load');
});

Then("the footer's build should not be a link", async function () {
  await page(this).waitForLoadState('networkidle');
  assert.equal(await page(this).locator('.site-footer .build-info a').count(), 0);
  assert.ok((await page(this).locator('.site-footer .build-info').innerText()).trim().length > 0);
});

Then('the page editor should show only the buttons {string}', async function (list) {
  const shown = await bar(this).locator('button').evaluateAll((buttons) => buttons.filter((b) => b.getClientRects().length > 0).map((b) => b.textContent.trim()));
  assert.deepEqual(shown, list.split(', '));
});
