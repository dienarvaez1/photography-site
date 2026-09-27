// Server-side tests for Category Maintenance (scripts/lib/category-form.mjs): its real request handler, over a
// temporary copy of categories.json/en.json/es.json and a temporary entries folder — never the actual project
// files (see DEFAULT_CATEGORIES_FILE/DEFAULT_LOCALE_FILES's own comment in category-form.mjs for why the
// handler takes them as an override in the first place). The tab's own screens are in
// browser/category-maintenance.feature.
import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../support/lib.js';

const form = await import(join(ROOT, 'scripts/lib/category-form.mjs'));
const { entryPath, writeEntry } = await import(join(ROOT, 'scripts/lib/photos.mjs'));

const SITE = 'http://localhost:4321';

const state = (world) => (world.data.categoryForm ??= {});

After(async function () {
  const dir = this.data.categoryForm?.dir;
  if (dir) await rm(dir, { recursive: true, force: true });
});

Given('an empty category configuration', async function () {
  const dir = await mkdtemp(join(tmpdir(), 'category-form-'));
  const contentDir = join(dir, 'content');
  await mkdir(contentDir, { recursive: true });
  const categoriesFile = pathToFileURL(join(dir, 'categories.json'));
  const localeFiles = { en: pathToFileURL(join(dir, 'en.json')), es: pathToFileURL(join(dir, 'es.json')) };
  await writeFile(categoriesFile, `${JSON.stringify([{ slug: 'nature' }, { slug: 'drafts', hidden: true }], null, 2)}\n`);
  const baseMessages = { categories: { nature: { label: 'Nature', description: 'The outdoors.' }, drafts: { label: 'Drafts', description: 'Not shown.' } } };
  await writeFile(localeFiles.en, `${JSON.stringify(baseMessages, null, 2)}\n`);
  await writeFile(localeFiles.es, `${JSON.stringify({ categories: { nature: { label: 'Naturaleza', description: 'El aire libre.' }, drafts: { label: 'Borradores', description: 'No mostrado.' } } }, null, 2)}\n`);
  Object.assign(state(this), { dir, contentDir, categoriesFile, localeFiles });
});

Given('the category {string} already has a photo in the library', async function (category) {
  const s = state(this);
  await writeEntry(entryPath(s.contentDir, category, '0123456789abcdef'), {
    title: 'A photo', category, photo: { id: '0123456789abcdef', width: 100, height: 100 }, featured: false, order: 1,
  });
});

async function send(world, method, path, body) {
  const s = state(world);
  s.handler ??= form.createCategoryFormHandler({ contentDir: s.contentDir, categoriesFile: s.categoriesFile, localeFiles: s.localeFiles });
  const request = new Request(`${SITE}${form.CATEGORY_FORM_PREFIX}${path}`, {
    method,
    headers: { Origin: SITE, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await s.handler(request);
  s.answer = { status: response.status, body: await response.json() };
  return s.answer;
}

const NEW_CATEGORY = { slug: 'night-sky', label: 'Night Sky', labelEs: 'Cielo nocturno', description: 'Stars.', descriptionEs: 'Estrellas.' };

When('I ask the category service for the current list', async function () {
  await send(this, 'GET', 'status');
});

When('I add the category {string}', async function (slug) {
  await send(this, 'POST', 'add', { ...NEW_CATEGORY, slug });
});

When('I add a category with no {string}', async function (field) {
  const body = { ...NEW_CATEGORY };
  delete body[field];
  await send(this, 'POST', 'add', body);
});

When('I add a category with the slug {string}', async function (slug) {
  await send(this, 'POST', 'add', { ...NEW_CATEGORY, slug });
});

When('I hide the category {string}', async function (slug) {
  await send(this, 'POST', 'edit', { slug, hidden: true });
});

When('I show the category {string}', async function (slug) {
  await send(this, 'POST', 'edit', { slug, hidden: false });
});

When('I rename the category {string} to {string} in English only', async function (slug, label) {
  await send(this, 'POST', 'edit', { slug, label });
});

When('I edit the category {string}', async function (slug) {
  await send(this, 'POST', 'edit', { slug, label: 'Whatever' });
});

When('I remove the category {string}', async function (slug) {
  await send(this, 'POST', 'remove', { slug });
});

When('I ask to remove the category {string} from another site', async function (slug) {
  const s = state(this);
  s.handler ??= form.createCategoryFormHandler({ contentDir: s.contentDir, categoriesFile: s.categoriesFile, localeFiles: s.localeFiles });
  const request = new Request(`${SITE}${form.CATEGORY_FORM_PREFIX}remove`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  const response = await s.handler(request);
  s.answer = { status: response.status, body: await response.json() };
});

Then('the category service should answer with status {int}', function (status) {
  assert.equal(state(this).answer.status, status, JSON.stringify(state(this).answer.body));
});

Then('the category service should report the error {string}', function (code) {
  assert.equal(state(this).answer.body.error, code, JSON.stringify(state(this).answer.body));
});

Then('the category list should include {string} labelled {string} in English and {string} in Spanish', function (slug, label, labelEs) {
  const found = state(this).answer.body.categories.find((c) => c.slug === slug);
  assert.ok(found, `no category "${slug}" in the answer`);
  assert.equal(found.label, label);
  assert.equal(found.labelEs, labelEs);
});

Then('the category list should not include {string}', function (slug) {
  assert.ok(!state(this).answer.body.categories.some((c) => c.slug === slug), `"${slug}" is still listed`);
});

Then('the category {string} should show {int} photos', function (slug, count) {
  const found = state(this).answer.body.categories.find((c) => c.slug === slug);
  assert.ok(found, `no category "${slug}" in the answer`);
  assert.equal(found.photoCount, count);
});

Then('the category {string} should be hidden', function (_slug) {
  assert.equal(state(this).answer.body.hidden, true, JSON.stringify(state(this).answer.body));
});

Then('the category {string} should not be hidden', function (_slug) {
  assert.equal(state(this).answer.body.hidden, false, JSON.stringify(state(this).answer.body));
});

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf-8'));
}

Then('the category configuration files on disk should list {string}', async function (slug) {
  const s = state(this);
  const list = await readJson(s.categoriesFile);
  assert.ok(list.some((c) => c.slug === slug), `${slug} not written to categories.json`);
  for (const locale of ['en', 'es']) {
    const messages = await readJson(s.localeFiles[locale]);
    assert.ok(messages.categories?.[slug], `${slug} not written to ${locale}.json`);
  }
});

Then('the category configuration files on disk should not mention {string}', async function (slug) {
  const s = state(this);
  const list = await readJson(s.categoriesFile);
  assert.ok(!list.some((c) => c.slug === slug), `${slug} is still in categories.json`);
  for (const locale of ['en', 'es']) {
    const messages = await readJson(s.localeFiles[locale]);
    assert.ok(!messages.categories?.[slug], `${slug} is still in ${locale}.json`);
  }
});

Then('the English name of {string} on disk should still be {string}', async function (slug, label) {
  const messages = await readJson(state(this).localeFiles.en);
  assert.equal(messages.categories[slug].label, label);
});

Then('the Spanish name of {string} on disk should still be {string}', async function (slug, label) {
  const messages = await readJson(state(this).localeFiles.es);
  assert.equal(messages.categories[slug].label, label);
});

Then('nothing about {string} should have changed on disk', async function (slug) {
  const s = state(this);
  const list = await readJson(s.categoriesFile);
  assert.ok(list.some((c) => c.slug === slug), `${slug} was removed from categories.json`);
  for (const locale of ['en', 'es']) {
    const messages = await readJson(s.localeFiles[locale]);
    assert.ok(messages.categories?.[slug], `${slug} was removed from ${locale}.json`);
  }
});
