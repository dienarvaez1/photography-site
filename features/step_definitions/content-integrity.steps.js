import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import {
  loadContentEntries,
  allowedFrontmatterFields,
  loadCategoriesConfig,
} from '../support/lib.js';

Given('all photo content entries', function () {
  this.data.entries = loadContentEntries();
  assert.ok(this.data.entries.length > 0, 'Expected to find at least one photo content entry.');
});

Given('the configured category slugs', async function () {
  const { CATEGORIES } = await loadCategoriesConfig();
  this.data.categorySlugs = new Set(CATEGORIES.map((c) => c.slug));
});

Then('each entry\'s declared image file should exist', function () {
  const missing = this.data.entries.filter((e) => !e.imageExists);
  assert.deepEqual(
    missing.map((e) => e.relPath),
    [],
    `These entries reference an image file that does not exist on disk`
  );
});

Then('no category should contain duplicate image files', function () {
  const byCategory = new Map();
  for (const entry of this.data.entries) {
    const category = entry.frontmatter.category;
    const list = byCategory.get(category) ?? [];
    list.push(entry);
    byCategory.set(category, list);
  }

  const duplicates = [];
  for (const [category, entries] of byCategory) {
    const seen = new Map();
    for (const entry of entries) {
      const key = entry.imagePath;
      if (seen.has(key)) {
        duplicates.push(`${category}: ${seen.get(key)} and ${entry.relPath} both use ${basename(key)}`);
      } else {
        seen.set(key, entry.relPath);
      }
    }
  }
  assert.deepEqual(duplicates, [], 'Found duplicate image references within a category');
});

Then('each entry should only use the allowed frontmatter fields', function () {
  const allowed = allowedFrontmatterFields();
  const violations = [];
  for (const entry of this.data.entries) {
    const stray = Object.keys(entry.frontmatter).filter((key) => !allowed.has(key));
    if (stray.length) {
      violations.push(`${entry.relPath} has unexpected field(s): ${stray.join(', ')}`);
    }
  }
  assert.deepEqual(violations, [], 'Found frontmatter fields outside the schema');
});

Then('each entry\'s title should be a non-empty string', function () {
  const violations = this.data.entries
    .filter((e) => typeof e.frontmatter.title !== 'string' || e.frontmatter.title.trim() === '')
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Found entries with a missing or empty title');
});

Then('each entry\'s category should be a configured category slug', function () {
  const slugs = this.data.categorySlugs;
  const violations = this.data.entries
    .filter((e) => !slugs.has(e.frontmatter.category))
    .map((e) => `${e.relPath} declares category "${e.frontmatter.category}"`);
  assert.deepEqual(violations, [], 'Found entries whose category is not a configured category slug');
});

Then('no entry\'s title should look like placeholder content', function () {
  const violations = this.data.entries
    .filter((e) => /placeholder/i.test(e.frontmatter.title ?? ''))
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Found leftover placeholder titles');
});

Then('each entry\'s order should be a number when present', function () {
  const violations = this.data.entries
    .filter((e) => e.frontmatter.order !== undefined && typeof e.frontmatter.order !== 'number')
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Found entries whose order field is not a number');
});

Then('each entry\'s frontmatter category should be a real, defined category', async function () {
  const { CATEGORIES } = await loadCategoriesConfig();
  const slugs = new Set(CATEGORIES.map((c) => c.slug));
  const violations = this.data.entries
    .filter((e) => !slugs.has(e.frontmatter.category))
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Found entries with an undefined category');
});
