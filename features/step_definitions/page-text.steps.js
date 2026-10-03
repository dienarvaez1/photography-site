// The page editor's save service (scripts/lib/page-text-form.mjs): the real handler, and the dev-server middleware, over
// temporary copies of the site's text files.
import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../support/lib.js';

const form = await import(join(ROOT, 'scripts/lib/page-text-form.mjs'));
const { pageTextMiddleware } = await import(join(ROOT, 'scripts/lib/page-text-form-server.mjs'));
const SITE = 'http://localhost:4321';
const state = (world) => world.data.pageText;
const unescape = (text) => text.replaceAll('\\n', '\n');

const EN = {
  nav: { about: 'About' },
  admin: { heading: 'Admin' },
  categories: { nature: { label: 'Nature', description: 'The outdoors.' }, drafts: { label: 'Drafts', description: 'Not shown.' } },
  home: { heroTitle: 'Hello.', heroCopy: 'Copy.', exploreByCategory: 'Explore' },
  work: { allLabel: 'All', allDescription: 'Everything.' },
  about: { heading: 'Real moments.', intro: ['One.', 'Two.'], curiosityHeading: 'Curious', curiosity: ['C.'], ctaHeading: 'Call', cta: ['Go.'] },
  contact: { heading: 'Contact me.', intro: 'Email me at {email}.' },
};
const ES = {
  nav: { about: 'Sobre mí' },
  admin: { heading: 'Administración' },
  categories: { nature: { label: 'Naturaleza', description: 'El aire libre.' }, drafts: { label: 'Borradores', description: 'No mostrado.' } },
  home: { heroTitle: 'Hola.', heroCopy: 'Texto.', exploreByCategory: 'Explora' },
  work: { allLabel: 'Todo', allDescription: 'Todo.' },
  about: { heading: 'Momentos reales.', intro: ['Uno.', 'Dos.'], curiosityHeading: 'Curioso', curiosity: ['C.'], ctaHeading: 'Llamada', cta: ['Ve.'] },
  contact: { heading: 'Contáctame.', intro: 'Escríbeme a {email}.' },
};

After(async function () {
  if (this.data.pageText?.dir) await rm(this.data.pageText.dir, { recursive: true, force: true });
  await new Promise((resolve) => (this.data.pageText?.server ? this.data.pageText.server.close(resolve) : resolve()));
});

Given("temporary copies of the site's text files", async function () {
  const dir = await mkdtemp(join(tmpdir(), 'page-text-'));
  const categoriesFile = pathToFileURL(join(dir, 'categories.json'));
  const localeFiles = { en: pathToFileURL(join(dir, 'en.json')), es: pathToFileURL(join(dir, 'es.json')) };
  await writeFile(categoriesFile, `${JSON.stringify([{ slug: 'nature' }, { slug: 'drafts', hidden: true }], null, 2)}\n`);
  await writeFile(localeFiles.en, `${JSON.stringify(EN, null, 2)}\n`);
  await writeFile(localeFiles.es, `${JSON.stringify(ES, null, 2)}\n`);
  this.data.pageText = { dir, categoriesFile, localeFiles, handler: form.createPageTextHandler({ categoriesFile, localeFiles }) };
});

Given('the page text service runs where SITE_ENV is not development', async function () {
  const s = state(this);
  const middleware = await pageTextMiddleware({ categoriesFile: s.categoriesFile, localeFiles: s.localeFiles, allowWrites: false });
  s.server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => s.server.listen(0, '127.0.0.1', resolve));
});

async function send(world, method, path, body, origin = SITE) {
  const request = new Request(`${SITE}${form.PAGE_TEXT_PREFIX}${path}`, {
    method,
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await state(world).handler(request);
  state(world).answer = { status: response.status, body: await response.json() };
}

When('I ask the page text service for {string}', async function (keys) {
  await send(this, 'GET', `status?keys=${encodeURIComponent(keys)}`);
});

When('I save {string} as {string} in English and {string} in Spanish', async function (key, en, es) {
  await send(this, 'POST', 'save', { texts: { [key]: { en: unescape(en), es: unescape(es) } } });
});

When('I save {string} from another site', async function (key) {
  await send(this, 'POST', 'save', { texts: { [key]: { en: 'X', es: 'Y' } } }, 'https://evil.example');
});

When('I save {string} through the dev server as {string} in English and {string} in Spanish', async function (key, en, es) {
  const { port } = state(this).server.address();
  const response = await fetch(`http://127.0.0.1:${port}${form.PAGE_TEXT_PREFIX}save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ texts: { [key]: { en, es } } }) });
  state(this).answer = { status: response.status, body: await response.json() };
});

Then('the page text service should answer with status {int}', function (status) {
  assert.equal(state(this).answer.status, status, JSON.stringify(state(this).answer.body));
});

Then('the page text service should answer with status {int} and the error {string}', function (status, error) {
  assert.equal(state(this).answer.status, status);
  assert.equal(state(this).answer.body.error, error);
});

Then('it should give {string} as {string} in English and {string} in Spanish', function (key, en, es) {
  assert.deepEqual(state(this).answer.body.texts[key], { en: unescape(en), es: unescape(es) });
});

const file = async (world, locale) => JSON.parse(await readFile(state(world).localeFiles[locale], 'utf-8'));
const at = (messages, key) => key.split('.').reduce((node, part) => node?.[part], messages);

Then('the {word} file should have {string} as {string}', async function (language, key, text) {
  assert.equal(at(await file(this, language === 'English' ? 'en' : 'es'), key), text);
});

Then('the {word} file should have {string} as the paragraphs {string}, {string}, {string}', async function (language, key, a, b, c) {
  assert.deepEqual(at(await file(this, language === 'English' ? 'en' : 'es'), key), [a, b, c]);
});

Then('everything else in both files should be as it was', async function () {
  const en = await file(this, 'en');
  const es = await file(this, 'es');
  assert.deepEqual({ ...en, about: { ...en.about, heading: EN.about.heading } }, EN);
  assert.deepEqual({ ...es, about: { ...es.about, heading: ES.about.heading } }, ES);
  assert.ok((await readFile(state(this).localeFiles.en, 'utf-8')).endsWith('}\n'), 'still pretty-printed with a final newline');
});

Then('both files should be untouched', async function () {
  assert.deepEqual(await file(this, 'en'), EN);
  assert.deepEqual(await file(this, 'es'), ES);
});

Then('astro.config.mjs should add the page text service to the dev server', function () {
  const config = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf-8');
  assert.match(config, /import \{ pageTextForm \} from '\.\/scripts\/lib\/page-text-form-server\.mjs'/);
  assert.match(config, /^\s+pageTextForm\(\),/m);
});
