// Server side of the page editor (src/lib/page-editor.ts): the Admin, signed in on the dev box, edits a page's headings
// and descriptions in place and saves them in both languages at once. Web-standard (Request -> Response), like
// category-form.mjs; the dev server wires it in (page-text-form-server.mjs), tests point it at temporary copies.
//
//   GET  /__page-text/status?keys=<key>,<key>   -> { texts: { <key>: { en, es }, … } }
//   POST /__page-text/save   JSON { texts: { <key>: { en, es }, … } }  -> the same shape, as saved
//
// The text is the site's own source (each locale's src/i18n/*.json), so this only writes local files: the change reaches
// the live site with a commit and a deploy, like any other. Only the keys below can be read or written — the headings and
// descriptions the editable pages show — never anything else in the files. A paragraph list (about.intro…) travels as
// one text with a blank line between paragraphs. Text must be plain (some of it is rendered as HTML, e.g. contact.intro)
// and keep the {placeholders} the site fills in.
import { readFile, writeFile } from 'node:fs/promises';

export const PAGE_TEXT_PREFIX = '/__page-text/';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_TEXT_LENGTH = 4000;
const MAX_KEYS = 12;

/** Single texts, and paragraph lists, the editable pages show (categories add their own; see editableKeys). */
const FIXED_KEYS = {
  'home.heroTitle': 'text',
  'home.heroCopy': 'text',
  'home.exploreByCategory': 'text',
  'work.allLabel': 'text',
  'work.allDescription': 'text',
  'about.heading': 'text',
  'about.intro': 'paragraphs',
  'about.curiosityHeading': 'text',
  'about.curiosity': 'paragraphs',
  'about.ctaHeading': 'text',
  'about.cta': 'paragraphs',
  'contact.heading': 'text',
  'contact.intro': 'text',
};

export const DEFAULT_CATEGORIES_FILE = new URL('../../src/config/categories.json', import.meta.url);
export const DEFAULT_LOCALE_FILES = { en: new URL('../../src/i18n/en.json', import.meta.url), es: new URL('../../src/i18n/es.json', import.meta.url) };

class FormError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const readJsonFile = async (file) => JSON.parse(await readFile(file, 'utf-8'));
const writeJsonFile = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
export const placeholders = (text) => [...String(text).matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0]).sort();

/** Every key the editor may touch: the fixed ones, and each visible category's label and description. */
export async function editableKeys(categoriesFile = DEFAULT_CATEGORIES_FILE) {
  const keys = { ...FIXED_KEYS };
  for (const { slug, hidden } of await readJsonFile(categoriesFile)) {
    if (hidden) continue;
    keys[`categories.${slug}.label`] = 'text';
    keys[`categories.${slug}.description`] = 'text';
  }
  return keys;
}

const getPath = (messages, key) => key.split('.').reduce((node, part) => node?.[part], messages);
function setPath(messages, key, value) {
  const parts = key.split('.');
  const parent = parts.slice(0, -1).reduce((node, part) => node[part], messages);
  parent[parts.at(-1)] = value;
}

/** As the editor shows it: a paragraph list joined with blank lines. */
const asText = (value) => (Array.isArray(value) ? value.join('\n\n') : String(value ?? ''));
const asStored = (kind, text) => (kind === 'paragraphs' ? text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean) : text.replace(/\s+/g, ' ').trim());

/** Refuses anything but the owner's own page on localhost — the same check category-form.mjs makes. */
function assertOwnPage(request, url) {
  if (!LOCAL_HOSTS.has(url.hostname)) throw new FormError(403, 'not-local', 'The page editor only answers on localhost.');
  const origin = request.headers.get('Origin');
  if (request.method === 'POST' ? origin !== url.origin : origin !== null && origin !== url.origin) {
    throw new FormError(403, 'not-local', 'The page editor only takes requests from its own pages.');
  }
}

export function createPageTextHandler({ log = () => {}, categoriesFile = DEFAULT_CATEGORIES_FILE, localeFiles = DEFAULT_LOCALE_FILES } = {}) {
  const read = () => Promise.all([readJsonFile(localeFiles.en), readJsonFile(localeFiles.es)]);

  function knownKeys(requested, allowed) {
    if (!requested.length || requested.length > MAX_KEYS) throw new FormError(400, 'bad-request', `Name 1 to ${MAX_KEYS} texts.`);
    for (const key of requested) if (!allowed[key]) throw new FormError(400, 'bad-request', `"${key}" is not a text the page editor can change.`);
    return requested;
  }

  async function status(url) {
    const keys = knownKeys((url.searchParams.get('keys') ?? '').split(',').filter(Boolean), await editableKeys(categoriesFile));
    const [en, es] = await read();
    return json(200, { texts: Object.fromEntries(keys.map((key) => [key, { en: asText(getPath(en, key)), es: asText(getPath(es, key)) }])) });
  }

  async function save(request) {
    const body = await request.json().catch(() => {
      throw new FormError(400, 'bad-request', 'Send the request as JSON.');
    });
    const texts = body?.texts;
    if (!texts || typeof texts !== 'object' || Array.isArray(texts)) throw new FormError(400, 'bad-request', 'Send { texts: { key: { en, es } } }.');
    const allowed = await editableKeys(categoriesFile);
    const keys = knownKeys(Object.keys(texts), allowed);
    const [en, es] = await read();
    const files = { en, es };
    for (const key of keys) {
      if (getPath(en, key) === undefined || getPath(es, key) === undefined) throw new FormError(400, 'bad-request', `"${key}" is missing from the locale files.`);
      const expected = placeholders(asText(getPath(en, key))).join();
      for (const locale of ['en', 'es']) {
        const text = texts[key]?.[locale];
        if (typeof text !== 'string' || !text.trim()) throw new FormError(400, 'bad-request', `"${key}" needs its ${locale === 'en' ? 'English' : 'Spanish'} text.`);
        if (text.length > MAX_TEXT_LENGTH) throw new FormError(400, 'bad-request', `"${key}" is longer than ${MAX_TEXT_LENGTH} characters.`);
        if (/[<>]/.test(text)) throw new FormError(400, 'bad-request', `"${key}" must be plain text (no < or >).`);
        if (placeholders(text).join() !== expected) throw new FormError(400, 'bad-request', `"${key}" must keep ${expected ? expected.replaceAll(',', ', ') : 'no {placeholders}'} exactly.`);
      }
    }
    for (const key of keys) for (const locale of ['en', 'es']) setPath(files[locale], key, asStored(allowed[key], texts[key][locale]));
    await writeJsonFile(localeFiles.en, en);
    await writeJsonFile(localeFiles.es, es);
    log(`Page editor: saved ${keys.join(', ')} in English and Spanish.`);
    return json(200, { texts: Object.fromEntries(keys.map((key) => [key, { en: asText(getPath(en, key)), es: asText(getPath(es, key)) }])) });
  }

  // One at a time, so two quick saves can never interleave their reads and writes of the same files.
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work, work);
    queue = turn.catch(() => {});
    return turn;
  };

  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PAGE_TEXT_PREFIX)) return null;
    const route = `${request.method} ${url.pathname.slice(PAGE_TEXT_PREFIX.length)}`;
    try {
      assertOwnPage(request, url);
      if (route === 'GET status') return await inTurn(() => status(url));
      if (route === 'POST save') return await inTurn(() => save(request));
      throw new FormError(404, 'not-found', 'Not found.');
    } catch (error) {
      if (error instanceof FormError) return json(error.status, { error: error.code, message: error.message });
      log(`Page editor: ${error.message}`);
      return json(500, { error: 'failed', message: error.message });
    }
  };
}
