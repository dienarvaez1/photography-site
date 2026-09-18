import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { loadCategoriesConfig, loadLocaleConfig, loadMessages, contentCategoryFolders } from '../support/lib.js';

Given('the configured categories', async function () {
  const { CATEGORIES, VISIBLE_CATEGORIES } = await loadCategoriesConfig();
  this.data.categories = CATEGORIES;
  this.data.visibleCategories = VISIBLE_CATEGORIES;
});

Given('the category content folders on disk', function () {
  this.data.contentFolders = contentCategoryFolders();
});

Then('no two categories should share the same slug', function () {
  const slugs = this.data.categories.map((c) => c.slug);
  const duplicates = slugs.filter((slug, i) => slugs.indexOf(slug) !== i);
  assert.deepEqual([...new Set(duplicates)], [], 'Found duplicate category slugs');
});

// Category text lives in the locale files (src/i18n/<locale>.json), not in the category config.
async function categoryTextViolations(categories, field) {
  const { LOCALES } = await loadLocaleConfig();
  return LOCALES.flatMap((locale) => {
    const text = loadMessages(locale).categories ?? {};
    return categories
      .filter((c) => typeof text[c.slug]?.[field] !== 'string' || text[c.slug][field].trim() === '')
      .map((c) => `${locale}:${c.slug}`);
  });
}

Then('each category should have a non-empty label', async function () {
  const violations = await categoryTextViolations(this.data.categories, 'label');
  assert.deepEqual(violations, [], 'Found categories with a missing or empty label in a locale file');
});

Then('each category should have a non-empty description', async function () {
  const violations = await categoryTextViolations(this.data.categories, 'description');
  assert.deepEqual(violations, [], 'Found categories with a missing or empty description in a locale file');
});

Then('every category marked hidden should be absent from the visible categories', function () {
  const visibleSlugs = new Set(this.data.visibleCategories.map((c) => c.slug));
  const violations = this.data.categories
    .filter((c) => c.hidden)
    .filter((c) => visibleSlugs.has(c.slug))
    .map((c) => c.slug);
  assert.deepEqual(violations, [], 'Found hidden categories that still appear in VISIBLE_CATEGORIES');
});

Then('every category not marked hidden should be present in the visible categories', function () {
  const visibleSlugs = new Set(this.data.visibleCategories.map((c) => c.slug));
  const violations = this.data.categories
    .filter((c) => !c.hidden)
    .filter((c) => !visibleSlugs.has(c.slug))
    .map((c) => c.slug);
  assert.deepEqual(violations, [], 'Found non-hidden categories missing from VISIBLE_CATEGORIES');
});

Then('every content folder name should match a configured category slug', function () {
  const slugs = new Set(this.data.categories.map((c) => c.slug));
  const violations = this.data.contentFolders.filter((folder) => !slugs.has(folder));
  assert.deepEqual(violations, [], 'Found content folders with no matching category config');
});
