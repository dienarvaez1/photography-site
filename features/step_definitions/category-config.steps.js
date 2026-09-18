import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { loadCategoriesConfig, contentCategoryFolders } from '../support/lib.js';

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

Then('each category should have a non-empty label', function () {
  const violations = this.data.categories
    .filter((c) => typeof c.label !== 'string' || c.label.trim() === '')
    .map((c) => c.slug);
  assert.deepEqual(violations, [], 'Found categories with a missing or empty label');
});

Then('each category should have a non-empty description', function () {
  const violations = this.data.categories
    .filter((c) => typeof c.description !== 'string' || c.description.trim() === '')
    .map((c) => c.slug);
  assert.deepEqual(violations, [], 'Found categories with a missing or empty description');
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
