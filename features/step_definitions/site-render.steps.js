import { AfterAll, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import { PRODUCTION_BUILD_DIR, ROOT } from '../support/lib.js';
import { buildProduction, startSite } from '../support/site-worker.js';

const { MANIFEST_KEY, buildManifest } = await import(join(ROOT, 'src/config/photo-manifest.ts'));
const { PHOTOS_BASE_URL, photoVariant } = await import(join(ROOT, 'src/config/photos.ts'));
const { CATEGORIES } = await import(join(ROOT, 'src/config/categories.ts'));
const { SITE } = await import(join(ROOT, 'src/config/site.ts'));
const { headersFor, parseHeadersFile } = await import(join(ROOT, 'src/lib/headers-file.ts'));
const PROD = join(PRODUCTION_BUILD_DIR, 'client');
const ACCESS = await import(join(ROOT, 'src/config/access-log.ts'));

// One site (one workerd) for the whole run: each scenario puts the entries it needs into the bucket.
let site = null;
AfterAll(async function () {
  await site?.stop();
});

const idFor = (category, title) => createHash('sha256').update(`${category}/${title}`).digest('hex').slice(0, 16);

function toEntry({ category, title, titleEs, order, featured }) {
  const id = idFor(category, title);
  const data = { title, ...(titleEs ? { titles: { es: titleEs } } : {}), category, photo: { id, width: 1200, height: 800 }, featured: featured === 'true', order: Number(order) };
  return { category, id, data };
}

const manifestText = (entries) => JSON.stringify(buildManifest(entries, '2026-09-21T00:00:00Z'));

async function setEntries(world, entries) {
  world.site = { entries };
  await site.put(MANIFEST_KEY, manifestText(entries));
}

// --- The build and the running site -----------------------------------------------------------------------------------------

Given('the production build of the site', { timeout: 300_000 }, function () {
  buildProduction();
});

Given('the site is running over a web bucket holding these entries:', { timeout: 300_000 }, async function (table) {
  const entries = table.hashes().map(toEntry);
  if (site) return setEntries(this, entries);
  site = await startSite({ objects: new Map([[MANIFEST_KEY, manifestText(entries)]]), cacheSeconds: 0 });
  this.site = { entries };
});

When('this entry is published to the bucket:', async function (table) {
  await setEntries(this, [...this.site.entries, ...table.hashes().map(toEntry)]);
});

When('{string} is removed from the bucket\'s manifest', async function (title) {
  await setEntries(this, this.site.entries.filter((e) => e.data.title !== title));
});

Given("the bucket's manifest is missing", async function () {
  await site.remove(MANIFEST_KEY);
});

Given("the bucket's manifest is not JSON", async function () {
  await site.put(MANIFEST_KEY, '<html>not a manifest</html>');
});

Given("the bucket's manifest is of another version", async function () {
  await site.put(MANIFEST_KEY, JSON.stringify({ version: 99, updatedAt: 'x', entries: [] }));
});

Given('the bucket\'s manifest holds a good entry {string} and an entry with no title', async function (title) {
  const good = toEntry({ category: 'astro', title, order: '1', featured: 'false' });
  const bad = toEntry({ category: 'astro', title: 'Nameless', order: '2', featured: 'false' });
  delete bad.data.title;
  await site.put(MANIFEST_KEY, JSON.stringify({ version: 1, updatedAt: 'x', entries: [good, bad] }));
});

// --- Requests ---------------------------------------------------------------------------------------------------------------------

// Sent as a browser sends it when a person follows a link or types an address. Cloudflare treats such
// "navigation" requests differently from a plain fetch: with `not_found_handling` set it answers a navigation to
// any address that is not a file with its 404 page and never runs the Worker (the pages the Worker renders were
// all "Page not found" in browsers, and fine for curl). Node's fetch drops Sec-Fetch-* headers, so use http.
const NAVIGATION = { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1' };

function get(path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(site.base + path, { headers: NAVIGATION }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(Object.entries(res.headers).map(([k, v]) => [k, String(v)])), text: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function request(world, path, follow) {
  let response = await get(path);
  for (let hops = 0; follow && [301, 302, 307, 308].includes(response.status) && hops < 5; hops++) {
    const target = new URL(response.headers.get('location'), site.base);
    path = target.pathname + target.search;
    response = await get(path);
  }
  const text = response.text;
  world.response = { status: response.status, headers: response.headers, text, doc: parse(text), path };
}

When('I request {string}', async function (path) {
  await request(this, path, true);
});

When('I request {string} without following redirects', async function (path) {
  await request(this, path, false);
});

Then('the site should answer {int}', function (status) {
  assert.equal(this.response.status, status, this.response.text.slice(0, 300));
});

Then('the site should answer {int} and send the visitor to {string}', function (status, target) {
  assert.equal(this.response.status, status);
  assert.equal(this.response.headers.get('location'), target);
});

// --- The pages -----------------------------------------------------------------------------------------------------------------------

const tiles = (world) => world.response.doc.querySelectorAll('.tile');

Then('the page should list these photos, in this order: {string}', function (list) {
  assert.deepEqual(tiles(this).map((tile) => tile.getAttribute('data-title')), list.split(', '));
});

Then('the page should not list any photos', function () {
  assert.equal(tiles(this).length, 0);
});

Then('the page should not say the address does not exist', function () {
  assert.doesNotMatch(this.response.text, /not found|no encontrada|doesn't exist/i);
});

Then('the page should say {string}', function (text) {
  assert.ok(this.response.doc.text.includes(text), `the page does not say "${text}"`);
});

Then('the page title should be {string}', function (title) {
  assert.equal(this.response.doc.querySelector('title').text.trim(), title);
});

Then('the page should be in the language {string}', function (locale) {
  assert.equal(this.response.doc.querySelector('html').getAttribute('lang'), locale);
});

Then('every photo should be shown from the public photo address by its id, in the sizes the gallery offers', function () {
  const all = tiles(this);
  assert.ok(all.length > 0);
  for (const tile of all) {
    const img = tile.querySelector('img');
    const id = /\/photos\/([0-9a-f]{16})\//.exec(img.getAttribute('src'))[1];
    assert.ok(img.getAttribute('src').startsWith(`${PHOTOS_BASE_URL}/photos/${id}/`), img.getAttribute('src'));
    assert.match(img.getAttribute('srcset'), new RegExp(`${id}/w400\\.webp 400w.*${id}/w1000\\.webp 1000w`));
    assert.equal(tile.getAttribute('data-full'), `${PHOTOS_BASE_URL}/photos/${id}/full.webp`);
  }
});

Then('the category cards should show these covers: {string}', function (list) {
  const covers = this.response.doc.querySelectorAll('.category-card').filter((card) => card.querySelector('img')).map((card) => `${card.querySelector('h3').text.trim()}: ${card.querySelector('img').getAttribute('alt')}`);
  assert.deepEqual(covers, list.split(', '));
});

Then('the page should share its first photo, {string}, at full size', function (title) {
  const { id } = this.site.entries.find((e) => e.data.title === title);
  const meta = (property) => this.response.doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content');
  assert.equal(meta('og:image'), photoVariant({ id, width: 1200, height: 800 }, 'full').src);
  assert.equal(meta('og:image:alt'), title);
});

Then('the Admin page should know these photos by title: {string}', function (list) {
  const known = JSON.parse(this.response.doc.querySelector('[data-pics]').getAttribute('data-photos'));
  assert.deepEqual(Object.values(known).map((photo) => photo.title).sort(), list.split(', ').sort());
  for (const [id, photo] of Object.entries(known)) assert.ok(photo.thumb.src.startsWith(`${PHOTOS_BASE_URL}/photos/${id}/`));
});

Then('the Admin page should hide the buttons inside exactly these tabs: {string}', function (list) {
  const hiding = this.response.doc.querySelectorAll('[role="tabpanel"][data-buttons-hidden]').map((panel) => panel.id.replace(/^panel-/, ''));
  assert.deepEqual(hiding.sort(), list.split(', ').sort());
});

// --- What is built ---------------------------------------------------------------------------------------------------------------------

Then('the production build should hold static pages for {string} in both languages', function (list) {
  for (const name of list.split(', ')) {
    const files = name === '404' ? ['404.html', 'es/404.html'] : [`${name}/index.html`, `es/${name}/index.html`];
    for (const file of files) assert.ok(existsSync(join(PROD, file)), `${file} should be built`);
  }
});

Then('the production build should hold no static page for the home page, the categories or the Admin page', function () {
  for (const file of ['index.html', 'es/index.html', 'work', 'es/work', 'admin', 'es/admin']) assert.equal(existsSync(join(PROD, file)), false, `${file} must be left to the Worker`);
});

Then('the production build should hold a Worker that renders them', function () {
  assert.ok(existsSync(join(PRODUCTION_BUILD_DIR, 'server/entry.mjs')));
  assert.match(readFileSync(join(PRODUCTION_BUILD_DIR, 'server/wrangler.json'), 'utf-8'), /"binding":"WEB"/);
});

Then("the production build's sitemap should list the home page and every category's page in both languages", function () {
  const listed = new Set([...readFileSync(join(PROD, 'sitemap-0.xml'), 'utf-8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const expected = ['/', '/es/', ...CATEGORIES.flatMap((c) => [`/work/${c.slug}/`, `/es/work/${c.slug}/`])].map((path) => new URL(path, SITE.url).href);
  assert.deepEqual(expected.filter((url) => !listed.has(url)), []);
});

// --- What Cloudflare does for files ------------------------------------------------------------------------------------

Then(/^the response should carry every header that public\/_headers gives all pages, including the Content-Security-Policy$/, function () {
  const wanted = headersFor(parseHeadersFile(readFileSync(join(ROOT, 'public/_headers'), 'utf-8')), this.response.path);
  assert.ok(wanted['Content-Security-Policy'], 'the headers file has a Content-Security-Policy');
  for (const [name, value] of Object.entries(wanted)) assert.equal(this.response.headers.get(name), value, name);
});

Then('the response should not be kept by any cache', function () {
  assert.equal(this.response.headers.get('cache-control'), 'no-cache');
});

Then('every page rendered on request should be valid HTML with a language, a title, a canonical link and its translations, and no inline script', async function () {
  for (const [path, locale] of [['/', 'en'], ['/es/', 'es'], ['/work/astro/', 'en'], ['/es/work/astro/', 'es'], ['/admin/', 'en']]) {
    await request(this, path, true);
    const doc = this.response.doc;
    assert.equal(this.response.status, 200, path);
    assert.equal(doc.querySelector('html').getAttribute('lang'), locale, path);
    assert.ok(doc.querySelector('title').text.trim(), `${path} has a title`);
    assert.match(this.response.text, /^<!DOCTYPE html>/i, path);
    if (path !== '/admin/') {
      assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), new URL(path, SITE.url).href, path);
      const langs = doc.querySelectorAll('link[rel="alternate"][hreflang]').map((l) => l.getAttribute('hreflang')).sort();
      assert.deepEqual(langs, ['en', 'es', 'x-default'], path);
    }
    assert.deepEqual(doc.querySelectorAll('script').filter((s) => !s.getAttribute('src') && !/^\s*$/.test(s.text) && s.getAttribute('type') !== 'application/ld+json').map((s) => s.text.slice(0, 40)), [], `${path} has an inline script`);
  }
});

// --- The access log (/api/access) ----------------------------------------------------------------------------------------

/** Today's access log as the site wrote it (empty when there is none yet). */
async function todaysLog() {
  const day = ACCESS.dayOf(new Date().toISOString());
  const text = await site.read(ACCESS.ACCESS_BUCKET, ACCESS.dayKey(day));
  return { key: ACCESS.dayKey(day), day, log: text ? JSON.parse(text) : { day, entries: [] } };
}

/** Sends a report the way a page does (same origin unless `origin` says otherwise), noting the log's size first. */
async function report(world, body, { origin, ip } = {}) {
  world.accessBefore = (await todaysLog()).log.entries.length;
  world.accessSentAt = new Date();
  const response = await fetch(`${site.base}/api/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin ?? site.base, ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  world.accessStatus = response.status;
}

When('a page at {string} reports a visit from the address {string}', async function (page, ip) {
  await report(this, { page, event: 'view' }, { ip });
});

When('a page at {string} reports opening the photo {string} of {string} from the address {string}', async function (page, id, category, ip) {
  await report(this, { page, event: 'photo', photo: { id, category } }, { ip });
});

When("another site's page {string} reports a visit to {string}", async function (origin, page) {
  await report(this, { page, event: 'view' }, { origin });
});

When('a page sends the report {string}', async function (body) {
  await report(this, body);
});

When('a page sends a report of {int} bytes', async function (bytes) {
  await report(this, JSON.stringify({ page: `/${'a'.repeat(bytes)}`, event: 'view' }));
});

When('{int} pages report visits at the same moment', async function (count) {
  this.accessBefore = (await todaysLog()).log.entries.length;
  this.accessPages = Array.from({ length: count }, (_, i) => `/race/${i}/`);
  const responses = await Promise.all(this.accessPages.map((page) =>
    fetch(`${site.base}/api/access`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: site.base }, body: JSON.stringify({ page, event: 'view' }) })));
  this.accessStatuses = responses.map((r) => r.status);
});

Then('the site should answer the report with {int}', function (status) {
  assert.equal(this.accessStatus, status);
});

Then('every one of them should be answered with {int}', function (status) {
  assert.deepEqual(this.accessStatuses, this.accessStatuses.map(() => status));
});

Then("today's access log should be named by today's first instant in UTC", async function () {
  const { key, log } = await todaysLog();
  assert.match(key, /^logs\/\d{4}-\d{2}-\d{2}T00:00:00\.000Z\.json$/);
  assert.equal(key, `logs/${new Date().toISOString().slice(0, 10)}T00:00:00.000Z.json`);
  assert.equal(log.day, key.slice('logs/'.length, -'.json'.length));
});

Then(/^today's access log should end with a "(view|photo)" of "([^"]+)" from "([^"]+)"(?:, timed by the Worker in UTC| for the photo "([^"]+)" in "([^"]+)")$/, async function (event, page, ip, id, category) {
  const { log } = await todaysLog();
  const last = log.entries.at(-1);
  assert.equal(log.entries.length, this.accessBefore + 1);
  assert.deepEqual({ ...last, time: undefined, geo: undefined }, { time: undefined, geo: undefined, ip, page, event, ...(id ? { photo: { id, category } } : {}) });
  assert.match(last.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const time = Date.parse(last.time);
  assert.ok(time >= this.accessSentAt.getTime() - 1000 && time <= Date.now() + 1000, `${last.time} is when it was sent`);
});

Then("today's access log should have as many entries as before", async function () {
  assert.equal((await todaysLog()).log.entries.length, this.accessBefore);
});

Then("today's access log should hold all {int} of them", async function (count) {
  const { log } = await todaysLog();
  assert.equal(log.entries.length, this.accessBefore + count);
  assert.deepEqual(log.entries.map((e) => e.page).filter((p) => p.startsWith('/race/')).sort(), [...this.accessPages].sort());
});

Then("its place should be recorded from Cloudflare's own data, by name", async function () {
  // wrangler dev gives the Worker a request.cf like Cloudflare's (this computer's place, or its stand-in offline).
  const { geo } = (await todaysLog()).log.entries.at(-1);
  assert.ok(geo && typeof geo === 'object', 'the entry has a geo');
  assert.deepEqual(Object.keys(geo).filter((key) => !['city', 'country', 'continent', 'timezone'].includes(key)), []);
  for (const value of Object.values(geo)) assert.equal(typeof value, 'string');
  assert.ok(geo.country && !/^[A-Z]{2}$/.test(geo.country), `the country by name, not code: ${geo.country}`);
  if (geo.continent) assert.ok(['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'].includes(geo.continent), geo.continent);
});
