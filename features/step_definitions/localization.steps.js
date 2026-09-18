import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIST_DIR,
  loadLocaleConfig,
  loadMessages,
  localizedRoute,
} from '../support/lib.js';

/** Flattens nested messages into { "a.b.c": "text" }; arrays become "a.b.0", "a.b.1", ... */
function flatten(value, prefix = '') {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.entries(value).reduce((acc, [key, child]) => {
    Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key));
    return acc;
  }, {});
}

const pathOf = (href) => new URL(href, 'https://example.test').pathname;

Given('the message files for every locale', async function () {
  const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
  this.data.locales = LOCALES;
  this.data.defaultLocale = DEFAULT_LOCALE;
  this.data.messages = Object.fromEntries(LOCALES.map((l) => [l, flatten(loadMessages(l))]));
});

Then('every locale should define exactly the same message keys as the default locale', function () {
  const expected = Object.keys(this.data.messages[this.data.defaultLocale]).sort();
  for (const locale of this.data.locales) {
    const actual = Object.keys(this.data.messages[locale]).sort();
    assert.deepEqual(
      actual,
      expected,
      `Locale "${locale}" does not define the same message keys as "${this.data.defaultLocale}"`
    );
  }
});

Then('no message in any locale should be empty', function () {
  const empty = this.data.locales.flatMap((locale) =>
    Object.entries(this.data.messages[locale])
      .filter(([, text]) => text.trim() === '')
      .map(([key]) => `${locale}:${key}`)
  );
  assert.deepEqual(empty, [], 'Found empty messages');
});

/** The locale-less path of a built route, e.g. "/es/about/" -> "/about/". */
const { LOCALES: ALL_LOCALES, DEFAULT_LOCALE: DEFAULT } = await loadLocaleConfig();
const basePath = (route) => {
  const prefixed = ALL_LOCALES.find((l) => l !== DEFAULT && route.startsWith(`/${l}/`));
  return prefixed ? route.slice(prefixed.length + 1) : route;
};

function alternates(root) {
  return Object.fromEntries(
    root
      .querySelectorAll('link[rel="alternate"][hreflang]')
      .map((link) => [link.getAttribute('hreflang'), link.getAttribute('href')])
  );
}

Then(
  'every page should declare absolute hreflang alternates for {string}, {string} and {string} pointing at its own twins',
  async function (a, b, c) {
    const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
    assert.deepEqual([a, b].sort(), [...LOCALES].sort(), 'Step should name every configured locale');
    assert.equal(c, 'x-default');
    for (const { route, page } of this.data.pages) {
      const found = alternates(page.root);
      for (const hreflang of [...LOCALES, 'x-default']) {
        assert.ok(/^https:\/\//.test(found[hreflang] ?? ''), `${route}: missing or non-absolute hreflang="${hreflang}"`);
      }
      for (const locale of LOCALES) {
        assert.equal(pathOf(found[locale]), localizedRoute(basePath(route), locale, DEFAULT_LOCALE), `${route}: hreflang="${locale}" points at the wrong page`);
      }
      assert.equal(found['x-default'], found[DEFAULT_LOCALE], `${route}: x-default should point at the default-language page`);
    }
  }
);

Then("every page's canonical URL should equal its own hreflang alternate", function () {
  for (const { route, locale, page } of this.data.pages) {
    const canonical = page.root.querySelector('link[rel="canonical"]')?.getAttribute('href');
    assert.ok(canonical, `${route}: no canonical link`);
    assert.equal(alternates(page.root)[locale], canonical, `${route}: canonical differs from the hreflang alternate for its own language`);
  }
});

Then('every page should declare og:locale for its own language', async function () {
  const { LOCALE_INFO } = await loadLocaleConfig();
  for (const { route, locale, page } of this.data.pages) {
    assert.equal(
      page.root.querySelector('meta[property="og:locale"]')?.getAttribute('content'),
      LOCALE_INFO[locale].ogLocale,
      `${route}: og:locale does not match ${locale}`
    );
  }
});

Then('the language switcher on every page should link only to the equivalent page in the other language', async function () {
  const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
  for (const { route, locale, page } of this.data.pages) {
    const links = page.root.querySelectorAll('.lang-switcher a');
    const expected = LOCALES.filter((l) => l !== locale).map((l) => localizedRoute(basePath(route), l, DEFAULT_LOCALE));
    assert.deepEqual(links.map((a) => a.getAttribute('href')), expected, `${route}: switcher links are wrong`);
    for (const a of links) {
      assert.ok(a.getAttribute('hreflang'), `${route}: switcher link is missing hreflang`);
      assert.equal(a.getAttribute('lang'), a.getAttribute('hreflang'), `${route}: switcher link should carry the target language in lang`);
    }
  }
});

Then('the current language should be marked in the language switcher on every page', function () {
  for (const { route, locale, page } of this.data.pages) {
    const current = page.root.querySelector('.lang-switcher [aria-current]');
    assert.ok(current, `${route}: language switcher does not mark the current language`);
    assert.equal(current.getAttribute('lang'), locale, `${route}: wrong language marked as current`);
  }
});

Then("every internal page link outside the language switcher should stay in its page's language", async function () {
  const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
  const prefixed = LOCALES.filter((l) => l !== DEFAULT_LOCALE);
  for (const { route, locale, page } of this.data.pages) {
    const links = page.root
      .querySelectorAll('a[href^="/"]')
      .filter((a) => !a.closest('.lang-switcher'))
      .map((a) => a.getAttribute('href'));
    assert.ok(links.length > 0, `${route}: expected internal links to test against`);
    const wrong = links.filter((href) => {
      const linkLocale = prefixed.find((l) => href.startsWith(`/${l}/`)) ?? DEFAULT_LOCALE;
      return linkLocale !== locale;
    });
    assert.deepEqual(wrong, [], `${route}: found links into another language`);
  }
});

Then("every Spanish page's title, heading and description should differ from its English twin", async function () {
  const { DEFAULT_LOCALE } = await loadLocaleConfig();
  const byRoute = new Map(this.data.pages.map((p) => [p.route, p.page]));
  const spanishPages = this.data.pages.filter((p) => p.locale !== DEFAULT_LOCALE);
  assert.ok(spanishPages.length > 0, 'Expected Spanish pages to test against');
  const pick = (root) => ({
    title: root.querySelector('title')?.text.trim(),
    heading: root.querySelector('h1')?.text.trim(),
    description: root.querySelector('meta[name="description"]')?.getAttribute('content'),
  });
  for (const { route, page } of spanishPages) {
    const english = byRoute.get(basePath(route));
    assert.ok(english, `${route}: no English twin built`);
    const es = pick(page.root);
    const en = pick(english.root);
    for (const field of ['title', 'heading', 'description']) {
      assert.ok(es[field], `${route}: missing ${field}`);
      assert.notEqual(es[field], en[field], `${route}: ${field} is identical to the English page — untranslated?`);
    }
  }
});

Then('the sitemap should list an hreflang alternate for every locale of every page', async function () {
  const { LOCALES } = await loadLocaleConfig();
  const sitemapFile = readdirSync(DIST_DIR).find((f) => /^sitemap-\d+\.xml$/.test(f));
  assert.ok(sitemapFile, 'No sitemap-N.xml was built');
  const xml = readFileSync(join(DIST_DIR, sitemapFile), 'utf-8');
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0, 'Sitemap has no <url> entries');
  for (const block of blocks) {
    const hreflangs = [...block.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(hreflangs, [...LOCALES].sort(), `Sitemap entry is missing locale alternates: ${block.slice(0, 120)}`);
  }
});
