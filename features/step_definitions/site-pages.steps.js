import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readBuiltPage, loadContentEntries, readWeb3FormsKeyFromEnv, loadCategoriesConfig } from '../support/lib.js';

When('I load the built page {string}', function (route) {
  this.data.page = readBuiltPage(route);
});

Then('the page should not be an error page', function () {
  const { html } = this.data.page;
  assert.ok(/^<!doctype html>/i.test(html), 'Page is missing a doctype — likely not a real rendered page');
  assert.ok(html.length > 500, 'Page content is suspiciously short — likely an error page');
  assert.ok(!/<title>\s*Error\s*<\/title>/i.test(html), 'Page title indicates an error page');
});

Then('the page should have a non-empty title', function () {
  const title = this.data.page.root.querySelector('title')?.text?.trim();
  assert.ok(title, 'Page has no non-empty <title>');
});

Then('the header {string} menu should list exactly the visible category labels in alphabetical order', function (menuName) {
  assert.equal(menuName, 'Work');
  const links = this.data.page.root.querySelectorAll('#nav-work-dropdown a');
  const actual = links.map((a) => a.text.trim());
  const expected = [...this.data.visibleCategories]
    .map((c) => c.label)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(actual, expected, 'Header "Work" menu does not match the expected visible categories');
});

Then('the header {string} menu should not contain a link for any hidden category', function (menuName) {
  assert.equal(menuName, 'Work');
  const hiddenSlugs = this.data.categories.filter((c) => c.hidden).map((c) => c.slug);
  const hrefs = this.data.page.root.querySelectorAll('#nav-work-dropdown a').map((a) => a.getAttribute('href'));
  for (const slug of hiddenSlugs) {
    assert.ok(
      !hrefs.includes(`/work/${slug}/`),
      `Header "Work" menu links to hidden category "${slug}"`
    );
  }
});

Then('the homepage category grid should list the same categories as the header {string} menu', function (menuName) {
  assert.equal(menuName, 'Work');
  const navLabels = this.data.page.root.querySelectorAll('#nav-work-dropdown a').map((a) => a.text.trim());
  const gridLabels = this.data.page.root.querySelectorAll('.category-grid h3').map((h) => h.text.trim());
  assert.deepEqual(
    [...gridLabels].sort(),
    [...navLabels].sort(),
    'Homepage category grid and header "Work" menu disagree on which categories exist'
  );
});

When('I load the built page for each hidden category with no photos', function () {
  const entries = loadContentEntries();
  const hidden = this.data.categories.filter((c) => c.hidden);
  const hiddenWithNoPhotos = hidden.filter(
    (c) => entries.filter((e) => e.frontmatter.category === c.slug).length === 0
  );
  assert.ok(hiddenWithNoPhotos.length > 0, 'Expected at least one hidden category with no photos to test against');
  this.data.hiddenEmptyPages = hiddenWithNoPhotos.map((c) => readBuiltPage(`/work/${c.slug}/`));
});

Then('each of those pages should show the {string} message', function (messageFragment) {
  assert.equal(messageFragment, 'no photos yet');
  for (const page of this.data.hiddenEmptyPages) {
    assert.ok(
      /no photos in this category yet/i.test(page.html),
      'Hidden category page does not show the expected empty-state message'
    );
  }
});

Then('the contact page should show the real form only if a Web3Forms access key is configured', function () {
  const key = readWeb3FormsKeyFromEnv();
  const hasForm = this.data.page.root.querySelector('#contact-form') !== null;
  const hasNotice = /isn.t configured yet/i.test(this.data.page.html);

  if (key) {
    assert.ok(hasForm, 'PUBLIC_WEB3FORMS_KEY is set but the contact page shows the "not configured" notice');
    assert.ok(!hasNotice, 'PUBLIC_WEB3FORMS_KEY is set but the "not configured" notice is still showing');
  } else {
    assert.ok(!hasForm, 'PUBLIC_WEB3FORMS_KEY is not set but the real contact form is showing anyway');
    assert.ok(hasNotice, 'PUBLIC_WEB3FORMS_KEY is not set and the "not configured" notice is missing');
  }
});

Then('every photo on that page with camera or copyright info should show that info in its tile', function () {
  const withInfo = this.data.entries.filter(
    (e) => e.frontmatter.category === 'astro' && (e.frontmatter.camera || e.frontmatter.copyright)
  );
  assert.ok(withInfo.length > 0, 'Expected at least one astro photo with camera/copyright info to test against');

  for (const entry of withInfo) {
    const title = entry.frontmatter.title;
    const tile = this.data.page.root.querySelector(`.tile[data-title="${title}"]`);
    assert.ok(tile, `Expected a tile for "${title}" on its category page`);
    const metaText = tile.querySelector('.tile-meta')?.text ?? '';
    if (entry.frontmatter.camera) {
      assert.ok(metaText.includes(entry.frontmatter.camera), `Tile for "${title}" is missing its camera info`);
    }
    if (entry.frontmatter.copyright) {
      assert.ok(metaText.includes(entry.frontmatter.copyright), `Tile for "${title}" is missing its copyright info`);
    }
  }
});

Then('the footer should show the current year', function () {
  const year = String(new Date().getFullYear());
  const footerText = this.data.page.root.querySelector('.site-footer')?.text ?? '';
  assert.ok(footerText.includes(year), `Footer does not show the current year (${year})`);
});

Then('the homepage should show a {string} section only if a visible photo is marked featured', async function (sectionName) {
  assert.equal(sectionName, 'Featured');
  const { VISIBLE_CATEGORIES } = await loadCategoriesConfig();
  const visibleSlugs = new Set(VISIBLE_CATEGORIES.map((c) => c.slug));
  const hasFeatured = this.data.entries.some(
    (e) => e.frontmatter.featured && visibleSlugs.has(e.frontmatter.category)
  );

  const headings = this.data.page.root.querySelectorAll('h2').map((h) => h.text.trim());
  const hasSection = headings.includes('Featured');

  if (hasFeatured) {
    assert.ok(hasSection, 'A visible photo is featured, but the homepage has no "Featured" section');
  } else {
    assert.ok(
      !hasSection,
      'No photo is featured, but the homepage still shows an (empty) "Featured" section'
    );
  }
});
