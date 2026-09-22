import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  listBuiltRoutes,
  listNotFoundRoutes,
  listDistRoutes,
  loadCategoriesConfig,
  loadContentEntries,
  loadLocaleConfig,
  loadMessages,
  localizedRoute,
  pageLocale,
  readAllBuiltPages,
  readBuiltPage,
  ROOT,
  effectiveWeb3FormsKey,
} from '../support/lib.js';

const photos = await import(join(ROOT, 'src/config/photos.ts'));

/** The visible category labels for a locale, in that locale's alphabetical order. */
async function expectedNavLabels(locale) {
  const { VISIBLE_CATEGORIES } = await loadCategoriesConfig();
  const { categories } = loadMessages(locale);
  return VISIBLE_CATEGORIES.map((c) => categories[c.slug].label).sort((a, b) => a.localeCompare(b, locale));
}

const navLabels = (root) => root.querySelectorAll('#nav-work-dropdown a').map((a) => a.text.trim());

When('I load the built page {string}', function (route) {
  this.data.route = route;
  this.data.page = readBuiltPage(route);
});

When('I load every built page', async function () {
  this.data.pages = await readAllBuiltPages();
  assert.ok(this.data.pages.length > 0, 'No built pages found');
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

Then('the built pages on disk should exactly match the expected routes in every locale', async function () {
  const expected = [...(await listBuiltRoutes()), ...(await listNotFoundRoutes())].sort();
  assert.deepEqual(
    listDistRoutes(),
    expected,
    'The build produced different pages than features/support/lib.js listBaseRoutes() expects — ' +
      'add new pages/categories to listBaseRoutes() (and the Examples tables) so they are tested in every language'
  );
});

Then(
  'the header {string} menu on every page should list exactly the visible category labels of its language in alphabetical order',
  async function (menuName) {
    assert.equal(menuName, 'Work');
    for (const { route, locale, page } of this.data.pages) {
      assert.deepEqual(
        navLabels(page.root),
        await expectedNavLabels(locale),
        `${route}: header "Work" menu does not match the visible ${locale} category labels`
      );
    }
  }
);

Then('the header {string} menu on every page should not contain a link for any hidden category', async function (menuName) {
  assert.equal(menuName, 'Work');
  const { DEFAULT_LOCALE } = await loadLocaleConfig();
  const hiddenSlugs = this.data.categories.filter((c) => c.hidden).map((c) => c.slug);
  for (const { route, locale, page } of this.data.pages) {
    const hrefs = page.root.querySelectorAll('#nav-work-dropdown a').map((a) => a.getAttribute('href'));
    for (const slug of hiddenSlugs) {
      assert.ok(
        !hrefs.includes(localizedRoute(`/work/${slug}/`, locale, DEFAULT_LOCALE)),
        `${route}: header "Work" menu links to hidden category "${slug}"`
      );
    }
  }
});

Then("every page should show its language's skip link, navigation labels and copyright footer", function () {
  for (const { route, locale, page } of this.data.pages) {
    const m = loadMessages(locale);
    const { root } = page;
    assert.equal(root.querySelector('.skip-link')?.text.trim(), m.nav.skipToContent, `${route}: skip link is not in ${locale}`);
    assert.equal(root.querySelector('#nav-work-toggle')?.text.trim(), m.nav.work, `${route}: "Work" label is not in ${locale}`);
    const topLinks = root.querySelectorAll('#primary-nav > a').map((a) => a.text.trim());
    assert.deepEqual(topLinks, [m.nav.about, m.nav.contact, m.nav.admin], `${route}: About/Contact/Admin nav labels are not in ${locale}`);
    const footer = root.querySelector('.site-footer')?.text ?? '';
    const expected = m.footer.copyright.replace('{year}', String(new Date().getFullYear())).replace('{author}', 'Diego Narvaez');
    assert.ok(footer.includes(expected), `${route}: footer copyright is not "${expected}"`);
  }
});

Then('the homepage category grid should list the same categories as the header {string} menu', function (menuName) {
  assert.equal(menuName, 'Work');
  const gridLabels = this.data.page.root.querySelectorAll('.category-grid h3').map((h) => h.text.trim());
  assert.deepEqual(
    [...gridLabels].sort(),
    [...navLabels(this.data.page.root)].sort(),
    'Homepage category grid and header "Work" menu disagree on which categories exist'
  );
});

When('I load the built page for each hidden category with no photos in locale {string}', async function (locale) {
  const { DEFAULT_LOCALE } = await loadLocaleConfig();
  const entries = loadContentEntries();
  const hidden = this.data.categories.filter((c) => c.hidden);
  const hiddenWithNoPhotos = hidden.filter(
    (c) => entries.filter((e) => e.frontmatter.category === c.slug).length === 0
  );
  // src/config/categories.ts keeps "drafts" permanently hidden and photo-less for exactly this: without at least
  // one such category, "hidden categories still build" would have nothing real to check.
  assert.ok(hiddenWithNoPhotos.length > 0, 'Expected at least one hidden category with no photos to test against');
  this.data.locale = locale;
  this.data.hiddenEmptyPages = hiddenWithNoPhotos.map((c) =>
    readBuiltPage(localizedRoute(`/work/${c.slug}/`, locale, DEFAULT_LOCALE))
  );
});

Then('each of those pages should show the {string} message in its language', function (messageFragment) {
  assert.equal(messageFragment, 'no photos yet');
  const expected = loadMessages(this.data.locale).work.empty;
  for (const page of this.data.hiddenEmptyPages) {
    assert.ok(
      page.root.querySelector('main').text.includes(expected),
      `Hidden category page does not show the ${this.data.locale} empty-state message "${expected}"`
    );
  }
});

Then('the contact page should show the real form only if a Web3Forms access key is configured', function () {
  const key = effectiveWeb3FormsKey(pageLocale(this.data.page));
  const hasForm = this.data.page.root.querySelector('#contact-form') !== null;
  const hasNotice = this.data.page.root.querySelector('.notice') !== null;

  if (key) {
    assert.ok(hasForm, 'PUBLIC_WEB3FORMS_KEY is set but the contact page shows the "not configured" notice');
    assert.ok(!hasNotice, 'PUBLIC_WEB3FORMS_KEY is set but the "not configured" notice is still showing');
  } else {
    assert.ok(!hasForm, 'PUBLIC_WEB3FORMS_KEY is not set but the real contact form is showing anyway');
    assert.ok(hasNotice, 'PUBLIC_WEB3FORMS_KEY is not set and the "not configured" notice is missing');
  }
});

/** Category slug from a built category route like "/es/work/nature/". */
const categoryOfRoute = (route) => route.match(/\/work\/([^/]+)\/$/)?.[1];

/** A photo's title as shown in the given locale. */
const shownTitle = (entry, locale) => entry.frontmatter.titles?.[locale] ?? entry.frontmatter.title;

Then('the page should show a tile for every photo in its category', function () {
  const locale = pageLocale(this.data.page);
  const slug = categoryOfRoute(this.data.route);
  const expected = this.data.entries.filter((e) => e.frontmatter.category === slug).map((e) => shownTitle(e, locale));
  const actual = this.data.page.root.querySelectorAll('.tile').map((t) => t.getAttribute('data-title'));
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${this.data.route}: tiles do not match the category's photos`);
});

Then('every photo on that page with a camera line should show it in its tile, and no tile should show a copyright', function () {
  const locale = pageLocale(this.data.page);
  const slug = categoryOfRoute(this.data.route);
  const entries = this.data.entries.filter((e) => e.frontmatter.category === slug);

  for (const entry of entries) {
    const title = shownTitle(entry, locale);
    const tile = this.data.page.root.querySelectorAll('.tile').find((t) => t.getAttribute('data-title') === title);
    assert.ok(tile, `Expected a tile for "${title}" on its category page`);
    const rows = tile.querySelectorAll('.tile-meta .meta-row').map((r) => r.text.trim());
    if (entry.frontmatter.camera) {
      assert.deepEqual(rows, [entry.frontmatter.camera], `Tile for "${title}" should show exactly its camera line`);
    } else {
      assert.deepEqual(rows, [], `Tile for "${title}" has no camera line, so it should show no metadata`);
    }
  }
});

Then('the footer on every page should show the current year', function () {
  const year = String(new Date().getFullYear());
  for (const { route, page } of this.data.pages) {
    const footerText = page.root.querySelector('.site-footer')?.text ?? '';
    assert.ok(footerText.includes(year), `${route}: footer does not show the current year (${year})`);
  }
});

Then('the homepage should show a {string} section only if a visible photo is marked featured', async function (sectionName) {
  assert.equal(sectionName, 'Featured');
  const { VISIBLE_CATEGORIES } = await loadCategoriesConfig();
  const visibleSlugs = new Set(VISIBLE_CATEGORIES.map((c) => c.slug));
  const hasFeatured = this.data.entries.some(
    (e) => e.frontmatter.featured && visibleSlugs.has(e.frontmatter.category)
  );

  const heading = loadMessages(pageLocale(this.data.page)).home.featured;
  const headings = this.data.page.root.querySelectorAll('h2').map((h) => h.text.trim());
  const hasSection = headings.includes(heading);

  if (hasFeatured) {
    assert.ok(hasSection, `A visible photo is featured, but the homepage has no "${heading}" section`);
  } else {
    assert.ok(!hasSection, `No photo is featured, but the homepage still shows an (empty) "${heading}" section`);
  }
});

Then('each tile should load its photo sizes from the public photo bucket', function () {
  const slug = categoryOfRoute(this.data.route);
  const entries = this.data.entries.filter((e) => e.frontmatter.category === slug);
  const locale = pageLocale(this.data.page);
  const tiles = this.data.page.root.querySelectorAll('.tile');
  assert.equal(tiles.length, entries.length);
  for (const entry of entries) {
    const { photo } = entry.frontmatter;
    const tile = tiles.find((t) => t.getAttribute('data-title') === shownTitle(entry, locale));
    const img = tile.querySelector('img');
    const thumb = photos.photoVariant(photo, 'thumb');
    assert.equal(img.getAttribute('src'), thumb.src, `${entry.relPath}: thumbnail URL`);
    assert.equal(img.getAttribute('width'), String(thumb.width));
    assert.equal(img.getAttribute('height'), String(thumb.height));
    assert.equal(tile.getAttribute('data-full'), photos.photoVariant(photo, 'full').src, `${entry.relPath}: lightbox URL`);
    assert.ok(thumb.src.startsWith(`${photos.PHOTOS_BASE_URL}/photos/${photo.id}/`), 'photo must come from the R2 public URL');
  }
});

Then('each category card should use the first photo of its category as the cover', async function () {
  const { VISIBLE_CATEGORIES } = await loadCategoriesConfig();
  const cards = this.data.page.root.querySelectorAll('.category-card');
  for (const category of VISIBLE_CATEGORIES) {
    const first = this.data.entries
      .filter((e) => e.frontmatter.category === category.slug)
      .sort((a, b) => (a.frontmatter.order ?? 0) - (b.frontmatter.order ?? 0))[0];
    const card = cards.find((c) => c.getAttribute('href').endsWith(`/work/${category.slug}/`));
    assert.ok(card, `No card for ${category.slug}`);
    const src = card.querySelector('img')?.getAttribute('src') ?? null;
    assert.equal(src, first ? photos.photoVariant(first.frontmatter.photo, 'cover').src : null, `${category.slug}: cover image`);
  }
});
