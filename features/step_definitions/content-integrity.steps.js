import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  CONTENT_DIR,
  ROOT,
  listPhotoFilesInRepo,
  listSourceFiles,
  loadContentEntries,
  allowedFrontmatterFields,
  loadCategoriesConfig,
  loadLocaleConfig,
} from '../support/lib.js';

Given('all photo content entries', function () {
  this.data.entries = loadContentEntries();
  assert.ok(this.data.entries.length > 0, 'Expected to find at least one photo content entry.');
});

Given('the configured category slugs', async function () {
  const { CATEGORIES } = await loadCategoriesConfig();
  this.data.categorySlugs = new Set(CATEGORIES.map((c) => c.slug));
});

Then('each entry should reference its photo in R2 by a valid content id and size', function () {
  const violations = this.data.entries
    .filter(({ frontmatter: { photo } }) => {
      const validId = typeof photo?.id === 'string' && /^[0-9a-f]{16}$/.test(photo.id);
      const validSize = [photo?.width, photo?.height].every((n) => Number.isInteger(n) && n > 0);
      return !(validId && validSize);
    })
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Entries need photo: { id: <16 hex chars>, width, height } — create them with `npm run photos:add`');
});

Then('no entry should still point at a local image file', function () {
  const violations = this.data.entries.filter((e) => 'image' in e.frontmatter).map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Found entries with a local `image:` field — photos live in R2 now');
});

Then('no category should contain the same photo twice', function () {
  const seen = new Map();
  const duplicates = [];
  for (const entry of this.data.entries) {
    const key = `${entry.frontmatter.category}:${entry.frontmatter.photo?.id}`;
    if (seen.has(key)) duplicates.push(`${seen.get(key)} and ${entry.relPath} use the same photo`);
    else seen.set(key, entry.relPath);
  }
  assert.deepEqual(duplicates, [], 'Found the same photo twice within a category');
});

Then('the repository should contain no photo files', function () {
  assert.deepEqual(listPhotoFilesInRepo(), [], 'Photos belong in R2 — add them with `npm run photos:add`, not into the repo');
});

Then('the site code should not process photos at build time', function () {
  // getImage()/image() read the image bytes (a local file or, for remote images, over the
  // network) during the build; photo URLs must come from the entry's data alone.
  const offenders = listSourceFiles()
    .filter(({ text }) => /\bgetImage\s*\(|\bimage\s*\(\s*\)|astro:assets/.test(text))
    .map((f) => f.path);
  assert.deepEqual(offenders, [], 'These files process images at build time, which would need photos on disk or network access');
});

Then('the photo tooling should be the only code that contacts R2', function () {
  const offenders = listSourceFiles()
    .filter(({ text, path }) => /r2\.dev|r2\.cloudflarestorage/.test(text) && path !== 'src/config/photos.ts')
    .map((f) => f.path);
  assert.deepEqual(offenders, [], 'Only src/config/photos.ts may name the R2 host');
  const fetchers = listSourceFiles()
    .filter(({ text, path }) => /\bfetch\s*\(/.test(text) && !/GeoRedirect|geo\.ts|contact\.astro|results-viewer\.ts|admin-common\.ts|photo-form\.ts|photo-entries\.ts|middleware\.ts|cloudflare\.d\.ts/.test(path))
    .map((f) => f.path);
  assert.deepEqual(fetchers, [], 'Unexpected network calls in site source (only location detection, the contact form, the Admin viewers (through admin-common.ts) the local service of the New Photo form (photo-form.ts), and the Worker reading the manifest and the 404 page (photo-entries.ts, middleware.ts) may fetch, at runtime)');
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

Given('the configured locales', async function () {
  const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
  this.data.locales = LOCALES;
  this.data.defaultLocale = DEFAULT_LOCALE;
});

Then("each entry's translated titles should be non-empty and use configured locales only", function () {
  const violations = this.data.entries.flatMap((e) =>
    Object.entries(e.frontmatter.titles ?? {})
      .filter(([locale, title]) => !this.data.locales.includes(locale) || typeof title !== 'string' || title.trim() === '')
      .map(([locale]) => `${e.relPath} (${locale})`)
  );
  assert.deepEqual(violations, [], 'Found translated titles that are empty or use an unknown locale');
});

Then('each entry should have a translated title for every non-default locale', function () {
  const others = this.data.locales.filter((l) => l !== this.data.defaultLocale);
  const violations = this.data.entries.flatMap((e) =>
    others.filter((l) => !e.frontmatter.titles?.[l]).map((l) => `${e.relPath} (${l})`)
  );
  assert.deepEqual(violations, [], 'Found photos with no translated title — add `titles: { <locale>: "..." }`');
});

Then('each entry should be a .md file inside the {string} folder of its own category', function (folder) {
  const violations = this.data.entries
    .filter((e) => {
      const parts = relative(CONTENT_DIR, e.filePath).split('/');
      return !(parts.length === 3 && parts[0] === e.frontmatter.category && parts[1] === folder);
    })
    .map((e) => `${e.relPath} (category "${e.frontmatter.category}")`);
  assert.deepEqual(violations, [], `Entries must live at src/content/photos/<category>/${folder}/<photo id>.md`);
});

Then("each entry's file name should be its photo id", function () {
  const violations = this.data.entries
    .filter((e) => basename(e.filePath, '.md') !== e.frontmatter.photo?.id)
    .map((e) => `${e.relPath} (photo.id ${e.frontmatter.photo?.id})`);
  assert.deepEqual(violations, [], 'Each file must be named after its photo id, matching photos/<id>/ in R2');
});

Then('no other folders should exist under the photo content', function () {
  const allowed = new Set(['images']);
  const found = [];
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      // depth 0 = category folders; depth 1 = the images folder; nothing deeper.
      if (depth === 1 && !allowed.has(entry)) found.push(relative(CONTENT_DIR, full));
      if (depth >= 2) found.push(relative(CONTENT_DIR, full));
      walk(full, depth + 1);
    }
  };
  walk(CONTENT_DIR, 0);
  assert.deepEqual(found, [], 'Only <category>/images/ folders belong under the photo content');
});

Then(/^no entry should have an? "([^"]+)" field$/, function (field) {
  const violations = this.data.entries.filter((e) => field in e.frontmatter).map((e) => e.relPath);
  assert.deepEqual(violations, [], `Entries must not have a "${field}" field (only "camera" is kept from EXIF)`);
});

Then('no entry should contain GPS or serial-number data', function () {
  const violations = this.data.entries
    .filter((e) => /gps|latitude|longitude|serial/i.test(readFileSync(e.filePath, 'utf-8')))
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'Location and serial numbers must never be stored — the .md files are committed');
});

Then('each camera line should be a non-empty string', function () {
  const violations = this.data.entries
    .filter((e) => 'camera' in e.frontmatter && !(typeof e.frontmatter.camera === 'string' && e.frontmatter.camera.trim()))
    .map((e) => e.relPath);
  assert.deepEqual(violations, [], 'A camera line is either a real line or absent — never empty');
});

Then('the content schema and gallery should not define or read {string} or {string}', function (a, b) {
  // A schema field (`copyright: z...`) or a property read (`data.copyright`) — not a comment that explains the rule.
  const files = ['src/content.config.ts', 'src/components/Gallery.astro'];
  const offenders = files.filter((file) => {
    const text = readFileSync(join(ROOT, file), 'utf-8');
    return [a, b].some((name) => new RegExp(`(^|\\s)${name}\\s*:|\\.${name}\\b`, 'im').test(text));
  });
  assert.deepEqual(offenders, [], `${a} / ${b} are no longer part of an entry, so the site must not define or read them`);
});
