import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, ROOT } from '../support/lib.js';
import { startStaticServer } from '../support/static-server.js';

const { runSmoke } = await import(join(ROOT, 'scripts/lib/smoke.mjs'));
const R2_PHOTO = /https:\/\/[a-z0-9.-]+\.r2\.dev\/photos\/[0-9a-f]{16}\/[A-Za-z0-9]+\.webp/g;

const smoke = (world) => world.data.smoke;

After(async function () {
  if (smoke(this)?.server) await smoke(this).server.close().catch(() => {});
});

/** Every R2 photo URL that appears in the built pages (what the checker must go and verify). */
function photoUrlsInBuild() {
  const urls = new Set();
  const walk = (dir) => {
    for (const entry of readFileSyncDir(dir)) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.html')) for (const u of readFileSync(join(dir, entry.name), 'utf-8').match(R2_PHOTO) ?? []) urls.add(u);
    }
  };
  walk(DIST_DIR);
  return urls;
}
import { readdirSync } from 'node:fs';
const readFileSyncDir = (dir) => readdirSync(dir, { withFileTypes: true });

/** Starts the server with a break applied, and a fetch that answers R2 requests from a fake bucket. */
async function start(world, options = {}) {
  const missingPhotos = new Set();
  const server = await startStaticServer(options);
  const requestedPhotos = [];
  const fetchFn = async (url, init) => {
    if (/\.r2\.dev\//.test(url)) {
      requestedPhotos.push(url);
      return new Response(null, { status: missingPhotos.has(url) ? 404 : 200, headers: { 'content-type': 'image/webp' } });
    }
    return fetch(url, init);
  };
  world.data.smoke = { server, fetchFn, missingPhotos, requestedPhotos, options };
  return world.data.smoke;
}

Given('the built site is served locally and R2 has every photo the pages reference', async function () {
  await start(this);
});

const restart = async (world, options) => {
  await smoke(world).server.close();
  const { missingPhotos, requestedPhotos } = smoke(world);
  const fresh = await start(world, options);
  fresh.missingPhotos = missingPhotos;
  fresh.requestedPhotos = requestedPhotos;
};

const CONTACT_NOTICE = '<p class="notice">The contact form isn\'t configured yet.</p>';
const withoutForm = (html) => html.replace(/<form id="contact-form"[\s\S]*?<\/form>/, CONTACT_NOTICE);

const BREAKS = {
  'the English contact page shows the "not configured" notice': { transform: (p, b) => (p === '/contact/' ? withoutForm(b) : undefined) },
  'the Spanish contact page shows the "not configured" notice': { transform: (p, b) => (p === '/es/contact/' ? withoutForm(b) : undefined) },
  'a contact form has lost its endpoint': { transform: (p, b) => (p === '/contact/' ? b.replaceAll('https://api.web3forms.com/submit', '/dev/null') : undefined) },
  'unknown URLs get a blank 404 instead of the 404 page': { blank404: true },
  'robots.txt points at the old pages.dev sitemap': { transform: (p, b) => (p === '/robots.txt' ? b.replace(/Sitemap:.*/, 'Sitemap: https://photography-site.pages.dev/sitemap-index.xml') : undefined) },
  'the Content-Security-Policy header is missing': { stripHeaders: ['Content-Security-Policy'] },
  'the home page lost its hreflang alternates': { transform: (p, b) => (p === '/' ? b.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*">/g, '') : undefined) },
  'the home page is accidentally noindex': { transform: (p, b) => (p === '/' ? b.replace('</head>', '<meta name="robots" content="noindex"></head>') : undefined) },
};

const ESCAPE = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BREAKAGES = [...Object.keys(BREAKS), 'one photo in R2 is missing', 'the Spanish form uses the English key'];

Given(new RegExp(`^(${BREAKAGES.map(ESCAPE).join('|')})$`), async function (breakage) {
  if (breakage === 'one photo in R2 is missing') {
    smoke(this).missingPhotos.add([...photoUrlsInBuild()][0]);
    return;
  }
  if (breakage === 'the Spanish form uses the English key') {
    const english = readFileSync(join(DIST_DIR, 'contact/index.html'), 'utf-8').match(/name="access_key"[^>]*value="([^"]+)"/)[1];
    const spanish = readFileSync(join(DIST_DIR, 'es/contact/index.html'), 'utf-8').match(/name="access_key"[^>]*value="([^"]+)"/)[1];
    return restart(this, { transform: (p, b) => (p === '/es/contact/' ? b.replace(spanish, english) : undefined) });
  }
  const options = BREAKS[breakage];
  assert.ok(options, `Unknown breakage: ${breakage}`);
  await restart(this, options);
});

Given('nothing is listening at the site address', async function () {
  await smoke(this).server.close();
});

When('the smoke check runs', async function () {
  const { server, fetchFn } = smoke(this);
  smoke(this).result = await runSmoke({ baseUrl: server.url, fetchFn });
});

function pageKeys() {
  const key = (file) => readFileSync(join(DIST_DIR, file), 'utf-8').match(/name="access_key"[^>]*value="([^"]+)"/)[1];
  return { en: key('contact/index.html'), es: key('es/contact/index.html') };
}

When('the smoke check runs expecting the keys that are in the pages', async function () {
  const { server, fetchFn } = smoke(this);
  smoke(this).result = await runSmoke({ baseUrl: server.url, fetchFn, expectedKeys: pageKeys() });
});

When('the smoke check runs expecting different keys', async function () {
  const { server, fetchFn } = smoke(this);
  smoke(this).result = await runSmoke({ baseUrl: server.url, fetchFn, expectedKeys: { en: '99999999-9999-4999-8999-999999999999', es: pageKeys().es } });
});

Then('the smoke check should pass', function () {
  const failed = smoke(this).result.checks.filter((c) => !c.ok);
  assert.deepEqual(failed, [], 'These checks failed');
  assert.equal(smoke(this).result.ok, true);
});

Then('the smoke check should fail', function () {
  assert.equal(smoke(this).result.ok, false, 'Expected the smoke check to fail');
});

Then('the smoke check should have verified all of these:', function (table) {
  const names = smoke(this).result.checks.map((c) => c.name);
  for (const [name] of table.raw()) assert.ok(names.includes(name), `Missing check "${name}". Have: ${names.join(' | ')}`);
});

Then('the smoke check should have requested every R2 photo URL used by the pages', function () {
  const expected = photoUrlsInBuild();
  const asked = new Set(smoke(this).requestedPhotos);
  assert.ok(expected.size > 20);
  assert.deepEqual([...expected].filter((u) => !asked.has(u)), [], 'photo URLs the checker never verified');
});

Then('the failing check should be {string} mentioning {string}', function (check, detail) {
  const failed = smoke(this).result.checks.filter((c) => !c.ok);
  const match = failed.filter((c) => (check === 'all' || c.name === check) && c.detail.toLowerCase().includes(detail.toLowerCase()));
  assert.ok(match.length > 0, `No failing check "${check}" mentioning "${detail}". Failures: ${JSON.stringify(failed)}`);
});

// --- Command line --------------------------------------------------------------------------

When('I run the smoke command against an address where nothing is listening', function () {
  this.data.smokeCli = spawnSync(process.execPath, [join(ROOT, 'scripts/smoke.mjs'), 'http://127.0.0.1:9'], { encoding: 'utf-8' });
});

Then('the smoke command should exit with code 1 and say the checks failed', function () {
  const { status, stdout, stderr } = this.data.smokeCli;
  assert.equal(status, 1, `${stdout}${stderr}`);
  assert.match(stderr, /checks failed/);
});
