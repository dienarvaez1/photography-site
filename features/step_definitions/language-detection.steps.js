import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, ROOT, loadLocaleConfig } from '../support/lib.js';

const geo = await import(join(ROOT, 'src/i18n/geo.ts'));

// Gherkin tables can't hold empty cells meaningfully or literal newlines, so
// "none" stands for "absent" and "\n" is expanded here.
const orNull = (value) => (value === 'none' || value === '' ? null : value);

Then('the country {string} should map to the language {string}', function (country, language) {
  assert.equal(geo.localeForCountry(country), language);
});

Then('every listed country should be an uppercase ISO 3166-1 alpha-2 code', function () {
  const all = Object.values(geo.LOCALE_COUNTRIES).flat();
  assert.ok(all.length > 0, 'No countries are listed');
  assert.deepEqual(all.filter((c) => !/^[A-Z]{2}$/.test(c)), []);
});

Then('every listed country should belong to exactly one language', function () {
  const all = Object.values(geo.LOCALE_COUNTRIES).flat();
  assert.deepEqual([...new Set(all.filter((c, i) => all.indexOf(c) !== i))], [], 'Countries listed under more than one language');
});

Then('every language with listed countries should be a configured locale', async function () {
  const { LOCALES } = await loadLocaleConfig();
  assert.deepEqual(Object.keys(geo.LOCALE_COUNTRIES).filter((l) => !LOCALES.includes(l)), []);
});

Then(
  'a visitor with remembered choice {string} in country {string} should get the language {string}',
  function (stored, country, language) {
    assert.equal(geo.pickLocale({ stored: orNull(stored), country: orNull(country) }), language);
  }
);

const list = (text) => (orNull(text) ? text.split(',').map((l) => l.trim()) : []);

Then(
  'a visitor with remembered choice {string}, country {string} and browser languages {string} should get the language {string}',
  function (stored, country, languages, language) {
    assert.equal(geo.pickLocale({ stored: orNull(stored), country: orNull(country), languages: list(languages) }), language);
  }
);

Given(/^the visitor came from "([^"]*)" on the site "([^"]*)"$/, function (referrer, origin) {
  this.data.geo.env.referrer = orNull(referrer) ?? undefined;
  this.data.geo.env.origin = origin;
});

Then(/^the referrer "([^"]*)" on the site "([^"]*)" should count as navigating within the site: "(yes|no)"$/, function (referrer, origin, same) {
  assert.equal(geo.isSameSiteNavigation(orNull(referrer) ?? undefined, orNull(origin) ?? undefined), same === 'yes');
});

Given("the visitor's browser languages are {string}", function (languages) {
  this.data.geo.env.languages = list(languages);
});

Then('the trace text {string} should give the country {string}', function (trace, country) {
  assert.equal(geo.parseTraceCountry(trace.replaceAll('\\n', '\n')), orNull(country));
});

// --- Full redirect flow with a fake browser ---------------------------------

function fakeStorage(stored) {
  const store = new Map(stored ? [[geo.LOCALE_STORAGE_KEY, stored]] : []);
  return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), store };
}

function fakeFetch(trace, calls) {
  return (url, init) => {
    calls.push(url);
    if (trace === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
    if (trace === 'http-error') return Promise.resolve({ ok: false, text: async () => 'Not found' });
    if (trace === 'timeout') {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    return Promise.resolve({ ok: true, text: async () => `fl=1\n${trace}\ntls=TLSv1.3\n` });
  };
}

function setUpVisitor(world, { path, stored, agent, trace, blockedStorage = false }) {
  const redirects = [];
  const fetchCalls = [];
  const storage = blockedStorage
    ? {
        getItem() { throw new DOMException('Blocked', 'SecurityError'); },
        setItem() { throw new DOMException('Blocked', 'SecurityError'); },
      }
    : fakeStorage(orNull(stored));
  world.data.geo = {
    redirects,
    fetchCalls,
    storage,
    env: {
      storage,
      fetch: fakeFetch(trace, fetchCalls),
      location: { pathname: path, search: '', hash: '', replace: (url) => redirects.push(url) },
      userAgent: agent,
      countryOverride: null,
    },
  };
}

Given(
  'a visitor on the English home page with remembered choice {string}, user agent {string} and a trace response of {string}',
  function (stored, agent, trace) {
    setUpVisitor(this, { path: '/', stored, agent, trace });
  }
);

Given(
  'a visitor on the page {string} with remembered choice {string}, user agent {string} and a trace response of {string}',
  function (path, stored, agent, trace) {
    setUpVisitor(this, { path, stored, agent, trace });
  }
);

Given('a visitor on the English home page whose browser blocks storage and whose trace response is {string}', function (trace) {
  setUpVisitor(this, { path: '/', stored: 'none', agent: 'Mozilla/5.0', trace, blockedStorage: true });
});

Given('the visitor arrived with the query {string} and the hash {string}', function (search, hash) {
  Object.assign(this.data.geo.env.location, { search, hash });
});

Given('the development country override is {string}', function (country) {
  this.data.geo.env.countryOverride = country;
});

When('the location detection runs', { timeout: 10_000 }, async function () {
  this.data.geo.result = await geo.runGeoRedirect(this.data.geo.env);
});

Then('the visitor should be redirected to {string}', function (target) {
  assert.deepEqual(this.data.geo.redirects, orNull(target) ? [target] : []);
});

Then("Cloudflare's trace endpoint should be asked {string}", function (asked) {
  const expected = asked === 'yes' ? [geo.TRACE_URL] : [];
  assert.deepEqual(this.data.geo.fetchCalls, expected);
});

Then('remembering a language choice should not throw', function () {
  assert.doesNotThrow(() => geo.storeLocale(this.data.geo.storage, 'es'));
});

Then('remembering the language {string} should store nothing', function (locale) {
  const storage = fakeStorage(null);
  geo.storeLocale(storage, locale);
  assert.equal(storage.store.size, 0);
});

Then('remembering the language {string} should store {string}', function (locale, expected) {
  const storage = fakeStorage(null);
  geo.storeLocale(storage, locale);
  assert.equal(storage.getItem(geo.LOCALE_STORAGE_KEY), expected);
});

// --- Built pages ------------------------------------------------------------

function moduleScriptFiles(root) {
  return root
    .querySelectorAll('script[src]')
    .map((s) => s.getAttribute('src'))
    .filter((src) => src.startsWith('/_astro/'))
    .map((src) => src.slice('/_astro/'.length));
}

Then('the location-detection script should be present only on the page {string}', function (route) {
  const withScript = this.data.pages
    .filter(({ page }) => moduleScriptFiles(page.root).some((f) => f.startsWith('GeoRedirect.')))
    .map((p) => p.route);
  assert.deepEqual(withScript, [route], 'Location detection must only run on the English home page');
});

Then('every page should load the script that remembers the language switcher choice', function () {
  for (const { route, page } of this.data.pages) {
    const headerScript = moduleScriptFiles(page.root).find((f) => f.startsWith('Header.'));
    assert.ok(headerScript, `${route}: header script is missing`);
    const code = readFileSync(join(DIST_DIR, '_astro', headerScript), 'utf-8');
    // The script imports the shared geo chunk, which holds the storage key.
    const chunk = code.match(/from"\.\/(geo\.[^"]+\.js)"/)?.[1];
    assert.ok(chunk, `${route}: header script does not use the shared language-preference code`);
    assert.ok(readFileSync(join(DIST_DIR, '_astro', chunk), 'utf-8').includes(geo.LOCALE_STORAGE_KEY), `${route}: preference key missing`);
  }
});
