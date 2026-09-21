import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HtmlValidate } from 'html-validate';
import sharp from 'sharp';
import { DIST_DIR, ROOT, listBuiltRoutes, listNotFoundRoutes, pageLocale, readBuiltPage } from '../support/lib.js';

const photos = await import(join(ROOT, 'src/config/photos.ts'));
const site = (await import(join(ROOT, 'src/config/site.ts'))).SITE;

const kb = (n) => n / 1024;

When('I load every built page and both error pages', async function () {
  const routes = [...(await listBuiltRoutes()), ...(await listNotFoundRoutes())];
  this.data.pages = routes.map((route) => {
    const page = readBuiltPage(route);
    return { route, locale: pageLocale(page), page };
  });
});

// ---------------------------------------------------------------- SEO ---------------------------

const meta = (root, selector) => root.querySelector(selector)?.getAttribute('content');
const shown = (path) => new URL(path, site.url).href;

Then('every page should declare an absolute og:image with its size and description, and a matching twitter:image', function () {
  for (const { route, page } of this.data.pages) {
    const { root } = page;
    const image = meta(root, 'meta[property="og:image"]');
    assert.match(image ?? '', /^https:\/\//, `${route}: og:image must be absolute`);
    assert.equal(meta(root, 'meta[name="twitter:image"]'), image, `${route}: twitter:image differs`);
    assert.ok(Number(meta(root, 'meta[property="og:image:width"]')) > 0, `${route}: og:image:width`);
    assert.ok(Number(meta(root, 'meta[property="og:image:height"]')) > 0, `${route}: og:image:height`);
    assert.ok(meta(root, 'meta[property="og:image:alt"]')?.trim(), `${route}: og:image:alt`);
    assert.equal(meta(root, 'meta[name="twitter:card"]'), 'summary_large_image');
  }
});

const isCategoryPage = (route) => /\/work\/[^/]+\/$/.test(route);

Then('every page except the category pages should share {string} on the site\'s own domain', function (path) {
  for (const { route, page } of this.data.pages.filter((p) => !isCategoryPage(p.route))) {
    assert.equal(meta(page.root, 'meta[property="og:image"]'), shown(path), `${route}: shares the wrong image`);
    assert.equal(meta(page.root, 'meta[property="og:image:width"]'), '1200');
    assert.equal(meta(page.root, 'meta[property="og:image:height"]'), '630');
  }
});

Then('the file {string} should be a 1200 by 630 image under 100 KB', async function (file) {
  const { width, height, format } = await sharp(join(ROOT, file)).metadata();
  assert.deepEqual([width, height, format], [1200, 630, 'png']);
  assert.ok(kb(statSync(join(ROOT, file)).size) < 100);
});

Then("every category page with photos should share the full-size version of its first photo, with that photo's size and title", function () {
  let checked = 0;
  for (const { route, locale, page } of this.data.pages.filter((p) => isCategoryPage(p.route))) {
    const slug = route.match(/\/work\/([^/]+)\//)[1];
    const first = this.data.entries
      .filter((e) => e.frontmatter.category === slug)
      .sort((a, b) => (a.frontmatter.order ?? 0) - (b.frontmatter.order ?? 0))[0];
    if (!first) {
      assert.equal(meta(page.root, 'meta[property="og:image"]'), shown('/og-image.png'), `${route}: an empty category falls back to the branded image`);
      continue;
    }
    const expected = photos.photoVariant(first.frontmatter.photo, 'full');
    const title = first.frontmatter.titles?.[locale] ?? first.frontmatter.title;
    assert.equal(meta(page.root, 'meta[property="og:image"]'), expected.src, `${route}: og:image`);
    assert.equal(meta(page.root, 'meta[property="og:image:width"]'), String(expected.width));
    assert.equal(meta(page.root, 'meta[property="og:image:height"]'), String(expected.height));
    assert.equal(meta(page.root, 'meta[property="og:image:alt"]'), title);
    checked++;
  }
  assert.ok(checked >= 10, 'expected the category pages of both languages');
});

Then('the built error pages should carry no share image, canonical or alternate links', async function () {
  for (const route of await listNotFoundRoutes()) {
    const { root } = readBuiltPage(route);
    assert.equal(root.querySelector('meta[property="og:image"]'), null, `${route}: og:image`);
    assert.equal(root.querySelector('link[rel="canonical"]'), null);
    assert.equal(root.querySelectorAll('link[rel="alternate"]').length, 0);
  }
});

const jsonLd = (page) => page.root.querySelectorAll('script[type="application/ld+json"]').map((s) => JSON.parse(s.text));

Then('the page should publish valid JSON-LD for a {string} and a {string}', function (a, b) {
  const items = jsonLd(this.data.page);
  assert.deepEqual(items.map((i) => i['@type']).sort(), [a, b].sort());
  for (const item of items) assert.equal(item['@context'], 'https://schema.org');
  this.data.jsonLd = Object.fromEntries(items.map((i) => [i['@type'], i]));
});

Then('the structured data should be in {string} and use the page\'s own address', function (language) {
  const canonical = this.data.page.root.querySelector('link[rel="canonical"]').getAttribute('href');
  assert.equal(this.data.jsonLd.WebSite.inLanguage, language);
  assert.equal(this.data.jsonLd.WebSite.url, canonical);
  assert.equal(this.data.jsonLd.ProfessionalService.url, canonical);
  assert.equal(this.data.jsonLd.ProfessionalService.image, shown('/og-image.png'));
});

Then("the structured data description should match the page's meta description", function () {
  const description = meta(this.data.page.root, 'meta[name="description"]');
  for (const item of Object.values(this.data.jsonLd)) assert.equal(item.description, description);
});

Then('the business should have a postal address, an email and contact languages', function () {
  const business = this.data.jsonLd.ProfessionalService;
  assert.deepEqual(business.address, {
    '@type': 'PostalAddress', addressLocality: site.address.locality, addressRegion: site.address.region, addressCountry: site.address.country,
  });
  assert.equal(business.email, site.email);
  assert.deepEqual(business.contactPoint.availableLanguage, ['English', 'Spanish']);
});

Then('only the pages {string} and {string} should contain JSON-LD', function (a, b) {
  const withData = this.data.pages.filter(({ page }) => jsonLd(page).length).map((p) => p.route).sort();
  assert.deepEqual(withData, [a, b].sort());
});

Then("the structured data should contain no phone number, street address or person's name beyond the business name", function () {
  const text = JSON.stringify(jsonLd(this.data.page));
  assert.ok(!/telephone|streetAddress|postalCode|"@type":"Person"/.test(text), 'only facts already public on the site belong here');
});

// -------------------------------------------------------- performance ---------------------------

function referencedBytes(root, pattern, attribute, extraImports = false) {
  const files = new Set(root.querySelectorAll(pattern).map((el) => el.getAttribute(attribute)).filter((u) => u?.startsWith('/_astro/')));
  let total = 0;
  const seen = new Set();
  const add = (file) => {
    if (seen.has(file) || !existsSync(join(DIST_DIR, file))) return;
    seen.add(file);
    const text = readFileSync(join(DIST_DIR, file));
    total += text.length;
    if (extraImports) for (const m of text.toString().matchAll(/from"\.\/([^"]+\.js)"/g)) add(join('_astro', m[1]));
  };
  for (const f of files) add(f.replace(/^\//, ''));
  return total;
}

Then("no page's HTML should exceed 30 KB, its scripts 10 KB, or its styles 25 KB", function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    const html = Buffer.byteLength(page.html);
    const js = referencedBytes(page.root, 'script[src]', 'src', true);
    const inlineCss = page.root.querySelectorAll('style').reduce((n, s) => n + s.text.length, 0);
    const css = referencedBytes(page.root, 'link[rel="stylesheet"]', 'href') + inlineCss;
    if (kb(html) > 30) problems.push(`${route}: HTML ${kb(html).toFixed(1)} KB`);
    if (kb(js) > 10) problems.push(`${route}: scripts ${kb(js).toFixed(1)} KB`);
    if (kb(css) > 25) problems.push(`${route}: styles ${kb(css).toFixed(1)} KB`);
  }
  assert.deepEqual(problems, [], 'A page grew past its budget — check for an oversized script, style or inlined asset');
});

Then('every image on every page should declare a width and a height', function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    // The lightbox's placeholder <img> is swapped by JavaScript inside a fixed-position overlay,
    // so it cannot move the page; every other image must reserve its space.
    for (const img of page.root.querySelectorAll('img:not(#lightbox-img)')) {
      const w = Number(img.getAttribute('width')), h = Number(img.getAttribute('height'));
      if (!(Number.isInteger(w) && w > 0 && Number.isInteger(h) && h > 0)) problems.push(`${route}: ${img.getAttribute('src')?.slice(0, 60)}`);
    }
  }
  assert.deepEqual(problems, [], 'Images without dimensions make the page jump as they load');
});

Then('the file {string} should be under {int} KB and at most {int} pixels wide', async function (file, maxKb, maxWidth) {
  assert.ok(kb(statSync(join(ROOT, file)).size) < maxKb, `${file} is ${kb(statSync(join(ROOT, file)).size).toFixed(0)} KB`);
  assert.ok((await sharp(join(ROOT, file)).metadata()).width <= maxWidth);
});

Then('no image in public should be over {int} KB', function (max) {
  const big = readdirSync(join(ROOT, 'public')).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).filter((f) => kb(statSync(join(ROOT, 'public', f)).size) > max);
  assert.deepEqual(big, []);
});

Then('the header logo should have high fetch priority and the icon should not', function () {
  const logo = this.data.page.root.querySelector('.brand-logo');
  const icon = this.data.page.root.querySelector('.aperture-logo');
  assert.equal(logo.getAttribute('fetchpriority'), 'high');
  assert.equal(icon.getAttribute('fetchpriority') ?? null, null);
  assert.equal(logo.getAttribute('loading') ?? null, null, 'the logo must not be lazy-loaded');
});

function srcsetEntries(img) {
  return (img.getAttribute('srcset') ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [url, w] = s.split(/\s+/); return { url, width: Number(w.replace('w', '')) }; });
}

function assertSizes(img, entry, variants, label) {
  const expected = photos.photoSrcSet(entry.frontmatter.photo, variants).split(', ').map((s) => { const [url, w] = s.split(' '); return { url, width: Number(w.replace('w', '')) }; });
  assert.deepEqual(srcsetEntries(img), expected, `${label}: srcset`);
  const widths = expected.map((e) => e.width);
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b), `${label}: smallest first`);
  assert.ok(img.getAttribute('sizes'), `${label}: sizes hint`);
  for (const { url } of expected) assert.ok(url.includes(`/photos/${entry.frontmatter.photo.id}/`), `${label}: ${url} is not this photo`);
}

Then(/^every gallery image should offer the sizes "([^"]+)" for its own photo, smallest first, with a sizes hint$/, function (list) {
  const variants = list.split(',').map((v) => v.trim());
  const slug = this.data.route.match(/\/work\/([^/]+)\//)[1];
  const entries = this.data.entries.filter((e) => e.frontmatter.category === slug);
  const tiles = this.data.page.root.querySelectorAll('.tile');
  assert.equal(tiles.length, entries.length);
  for (const tile of tiles) {
    const entry = entries.find((e) => tile.querySelector('img').getAttribute('src').includes(`/photos/${e.frontmatter.photo.id}/`));
    assert.ok(entry, 'tile matches an entry');
    assertSizes(tile.querySelector('img'), entry, variants, this.data.route);
  }
});

Then(/^every category card image should offer the sizes "([^"]+)" for its own cover photo, with a sizes hint$/, function (list) {
  const variants = list.split(',').map((v) => v.trim());
  const cards = this.data.page.root.querySelectorAll('.category-card img');
  assert.ok(cards.length >= 5);
  for (const img of cards) {
    const entry = this.data.entries.find((e) => img.getAttribute('src').includes(`/photos/${e.frontmatter.photo.id}/`));
    assert.ok(entry, 'card matches a cover entry');
    assertSizes(img, entry, variants, 'card');
  }
});

Then('the first {int} gallery images should load eagerly and the rest lazily', function (count) {
  const images = this.data.page.root.querySelectorAll('.tile img');
  assert.ok(images.length > count);
  images.forEach((img, i) => assert.equal(img.getAttribute('loading'), i < count ? 'eager' : 'lazy', `image ${i}`));
});

Then('only the very first gallery image should have high fetch priority', function () {
  const priorities = this.data.page.root.querySelectorAll('.tile img').map((img) => img.getAttribute('fetchpriority') ?? null);
  assert.deepEqual(priorities, priorities.map((_, i) => (i === 0 ? 'high' : null)));
});

Then(/^the sizes "([^"]+)" of a (\d+)x(\d+) photo should give the widths "([^"]+)"$/, function (list, w, h, widths) {
  const set = photos.photoSrcSet({ id: 'aaaaaaaaaaaaaaaa', width: Number(w), height: Number(h) }, list.split(',').map((v) => v.trim()));
  assert.deepEqual(set.split(', ').map((s) => Number(s.split(' ')[1].replace('w', ''))), widths.split(',').map(Number));
});

Then('the configured web sizes should have unique widths and cover everything the srcsets use', function () {
  const widths = Object.values(photos.PHOTO_VARIANTS);
  assert.equal(new Set(widths).size, widths.length, 'two variants with one width are wasted storage');
  for (const variant of [...photos.THUMB_SRCSET, ...photos.COVER_SRCSET, 'full']) assert.ok(variant in photos.PHOTO_VARIANTS, `${variant} is not a defined size`);
});

// ------------------------------------------------------ HTML quality --------------------------

Then('no page should have any html-validate problem', async function () {
  const validator = new HtmlValidate({ extends: ['html-validate:recommended'] });
  const problems = [];
  for (const { route, page } of this.data.pages) {
    const report = await validator.validateString(page.html, route);
    for (const message of report.results.flatMap((r) => r.messages)) problems.push(`${route}: ${message.ruleId} — ${message.message}`);
  }
  assert.deepEqual(problems, []);
});

const internal = (ref) => ref && !/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(ref);

function fileFor(ref, route) {
  const path = new URL(ref, `https://x.test${route.replace(/index\.html$/, '')}`).pathname;
  const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}/index.html`, `${path}.html`];
  return candidates.map((c) => join(DIST_DIR, c)).find((c) => existsSync(c) && statSync(c).isFile());
}

Then('every internal reference should resolve to a built file', function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    const refs = [
      ...page.root.querySelectorAll('a[href]').map((a) => a.getAttribute('href')),
      ...page.root.querySelectorAll('img[src], script[src]').map((e) => e.getAttribute('src')),
      ...page.root.querySelectorAll('link[href]').map((l) => l.getAttribute('href')),
    ];
    for (const ref of refs.filter(internal)) if (!fileFor(ref, route)) problems.push(`${route}: ${ref}`);
  }
  assert.deepEqual([...new Set(problems)], [], 'Broken internal references');
});

Then('every {string}, aria-controls, aria-labelledby and label reference should have a target on its page', function (_anchorSyntax) {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    const ids = new Set(page.root.querySelectorAll('[id]').map((e) => e.getAttribute('id')));
    for (const a of page.root.querySelectorAll('a[href^="#"]')) if (a.getAttribute('href').length > 1 && !ids.has(a.getAttribute('href').slice(1))) problems.push(`${route}: anchor ${a.getAttribute('href')}`);
    for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
      for (const el of page.root.querySelectorAll(`[${attr}]`)) for (const id of el.getAttribute(attr).split(/\s+/)) if (!ids.has(id)) problems.push(`${route}: ${attr}="${id}"`);
    }
    for (const label of page.root.querySelectorAll('label[for]')) if (!ids.has(label.getAttribute('for'))) problems.push(`${route}: label for="${label.getAttribute('for')}"`);
  }
  assert.deepEqual(problems, []);
});

Then('no page should repeat an id', function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    const ids = page.root.querySelectorAll('[id]').map((e) => e.getAttribute('id'));
    for (const id of ids.filter((v, i) => ids.indexOf(v) !== i)) problems.push(`${route}: #${id}`);
  }
  assert.deepEqual([...new Set(problems)], []);
});

Then('every page should have exactly one h1 and never skip a heading level', function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    const levels = page.root.querySelectorAll('h1, h2, h3, h4, h5, h6').map((h) => Number(h.tagName[1]));
    if (levels.filter((l) => l === 1).length !== 1) problems.push(`${route}: ${levels.filter((l) => l === 1).length} h1`);
    levels.forEach((level, i) => { if (i > 0 && level > levels[i - 1] + 1) problems.push(`${route}: h${levels[i - 1]} then h${level}`); });
  }
  assert.deepEqual(problems, []);
});

Then('every link and button should have an accessible name', function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    for (const el of page.root.querySelectorAll('a[href], button')) {
      const name =
        el.getAttribute('aria-label')?.trim() ||
        el.text.replace(/\s+/g, ' ').trim() ||
        el.querySelectorAll('img').map((i) => i.getAttribute('alt')?.trim()).filter(Boolean).join(' ');
      if (!name) problems.push(`${route}: <${el.tagName.toLowerCase()} ${el.getAttribute('href') ?? el.getAttribute('id') ?? el.getAttribute('class')}>`);
    }
  }
  assert.deepEqual(problems, []);
});

Then('every external link should be https, and those opening a new tab should say so to screen readers', function () {
  const problems = [];
  for (const { route, page } of this.data.pages) {
    for (const a of page.root.querySelectorAll('a[href^="http"], a[href^="//"]')) {
      if (!a.getAttribute('href').startsWith('https://')) problems.push(`${route}: ${a.getAttribute('href')} is not https`);
      if (a.getAttribute('target') === '_blank' && !a.querySelector('.visually-hidden')) problems.push(`${route}: new-tab link without a hint: ${a.getAttribute('href')}`);
    }
  }
  assert.deepEqual(problems, []);
});

Then('every sitemap URL should be a built page, and every built page except the error pages should be in the sitemap', async function () {
  const xml = readdirSync(DIST_DIR).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => readFileSync(join(DIST_DIR, f), 'utf-8')).join('');
  const listed = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).sort();
  const built = (await listBuiltRoutes()).sort();
  assert.deepEqual(listed, built);
  for (const m of xml.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)) assert.ok(built.includes(new URL(m[1]).pathname), `${m[1]} is not a built page`);
});
