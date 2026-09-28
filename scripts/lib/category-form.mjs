// Server side of the Admin page's Category Maintenance tab. Web-standard (Request -> Response) and
// storage-agnostic, like photo-form.mjs: the dev server wires it to the real R2 mirror (category-form-server.mjs,
// for the photo-count check on removal), tests to a fake one.
//
//   GET  /__categories/status          -> { categories: [{ slug, hidden, label, labelEs, description,
//                                            descriptionEs, photoCount }, ...] }
//   POST /__categories/add     JSON { slug, label, labelEs, description, descriptionEs, hidden? }
//                                                     -> the new category, in the same shape as `status`
//   POST /__categories/edit    JSON { slug, newSlug?, hidden?, label?, labelEs?, description?, descriptionEs? }
//                                                     -> the updated category, in the same shape as `status`
//                                                        (a `newSlug` renames it, moving any of its photos and
//                                                        its locale text along with it)
//   POST /__categories/remove  JSON { slug }          -> { slug }
//
// Unlike photos, a category is not R2 data: it is the site's own source (src/config/categories.json, and each
// locale's `categories.<slug>` in src/i18n/*.json), so this only ever writes local files — nothing here talks
// to R2 except to count a category's photos before letting it be removed, the same local mirror
// (scripts/lib/entry-sync.mjs) the New Photo form already keeps in step. A category still needs a commit and a
// deploy to reach the live site, same as any other source change; this only saves hand-editing the files.
import { readFile, writeFile } from 'node:fs/promises';
import { pullEntries, pushEntries } from './entry-sync.mjs';
import { changeCategory, listEntries } from './photos.mjs';

export const CATEGORY_FORM_PREFIX = '/__categories/';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 40;
const MAX_TEXT_LENGTH = 200;

// The real project files, used whenever createCategoryFormHandler isn't told otherwise (the dev server never
// overrides this). Tests pass their own temporary copies instead — never these, so a test run can never leave
// the actual repository edited.
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

async function readJsonFile(file) {
  return JSON.parse(await readFile(file, 'utf-8'));
}

/** Every JSON file this touches is pretty-printed the same way it already is in the repo (2-space indent, one trailing newline). */
async function writeJsonFile(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

/** Refuses anything but the owner's own page on localhost — identical reasoning to photo-form.mjs's assertOwnPage. */
function assertOwnPage(request, url) {
  if (!LOCAL_HOSTS.has(url.hostname)) throw new FormError(403, 'not-local', 'Category Maintenance only answers on localhost.');
  const origin = request.headers.get('Origin');
  if (request.method === 'POST' ? origin !== url.origin : origin !== null && origin !== url.origin) {
    throw new FormError(403, 'not-local', 'Category Maintenance only takes requests from its own page.');
  }
}

function readBody(request) {
  return request.json().catch(() => {
    throw new FormError(400, 'bad-request', 'Send the request as JSON.');
  });
}

/** A required, trimmed field, within a sane length — the same shape of check the New Photo form makes of `title`. */
function requiredText(body, field, max = MAX_TEXT_LENGTH) {
  const value = typeof body?.[field] === 'string' ? body[field].trim() : '';
  if (!value) throw new FormError(400, 'bad-request', `"${field}" is required.`);
  if (value.length > max) throw new FormError(400, 'bad-request', `"${field}" is longer than ${max} characters.`);
  return value;
}

function knownSlug(list, body) {
  const slug = typeof body?.slug === 'string' ? body.slug : '';
  if (!list.some((c) => c.slug === slug)) throw new FormError(404, 'not-found', `No such category "${slug}".`);
  return slug;
}

/**
 * Answers a request for Category Maintenance, or returns null when it is not one of its addresses. Requests are
 * queued one at a time (like the New Photo form's handler), so two quick submissions can never interleave their
 * reads and writes of the same JSON files. `categoriesFile`/`localeFiles` default to the real project files
 * (see above); tests point them at their own temporary copies instead.
 */
export function createCategoryFormHandler({ contentDir, storage, sync = false, log = () => {}, categoriesFile = DEFAULT_CATEGORIES_FILE, localeFiles = DEFAULT_LOCALE_FILES }) {
  const locales = Object.keys(localeFiles);
  const readCategoriesFile = () => readJsonFile(categoriesFile);
  const writeCategoriesFile = (list) => writeJsonFile(categoriesFile, list);
  const readLocaleFile = (locale) => readJsonFile(localeFiles[locale]);
  const writeLocaleFile = (locale, messages) => writeJsonFile(localeFiles[locale], messages);
  // Only needed for a slug rename, to push the moved photo entries' new category to R2 the same way the
  // New Photo form's own edits do (see changeCategory in photos.mjs) — undefined in tests that don't sync.
  const publish = sync ? () => pushEntries({ contentDir, storage, log }) : undefined;

  function describeOne(list, textByLocale, slug) {
    const found = list.find((c) => c.slug === slug);
    return {
      slug,
      hidden: Boolean(found?.hidden),
      label: textByLocale.en.categories?.[slug]?.label ?? slug,
      labelEs: textByLocale.es.categories?.[slug]?.label ?? slug,
      description: textByLocale.en.categories?.[slug]?.description ?? '',
      descriptionEs: textByLocale.es.categories?.[slug]?.description ?? '',
    };
  }

  /** Every category, with both locales' text and how many photos file under it (from the local entries mirror). */
  async function describeCategories() {
    const [list, en, es, entries] = await Promise.all([readCategoriesFile(), readLocaleFile('en'), readLocaleFile('es'), listEntries(contentDir)]);
    const counts = new Map();
    for (const { data } of entries) counts.set(data.category, (counts.get(data.category) ?? 0) + 1);
    return list.map(({ slug }) => ({ ...describeOne(list, { en, es }, slug), photoCount: counts.get(slug) ?? 0 }));
  }

  async function status() {
    return json(200, { categories: await describeCategories() });
  }

  async function add({ request }) {
    const body = await readBody(request);
    const slug = requiredText(body, 'slug', MAX_SLUG_LENGTH).toLowerCase();
    if (!SLUG_PATTERN.test(slug)) throw new FormError(400, 'bad-request', 'The slug must be lowercase letters, digits and single hyphens, starting with a letter (e.g. "night-sky").');
    const label = requiredText(body, 'label');
    const labelEs = requiredText(body, 'labelEs');
    const description = requiredText(body, 'description');
    const descriptionEs = requiredText(body, 'descriptionEs');
    const hidden = Boolean(body?.hidden);

    const list = await readCategoriesFile();
    if (list.some((c) => c.slug === slug)) throw new FormError(409, 'duplicate', `"${slug}" already exists.`);
    list.push(hidden ? { slug, hidden: true } : { slug });
    await writeCategoriesFile(list);

    const texts = { en: { label, description }, es: { label: labelEs, description: descriptionEs } };
    for (const locale of locales) {
      const messages = await readLocaleFile(locale);
      messages.categories = { ...messages.categories, [slug]: texts[locale] };
      await writeLocaleFile(locale, messages);
    }
    return json(200, { slug, hidden, label, labelEs, description, descriptionEs, photoCount: 0 });
  }

  async function edit({ request }) {
    const body = await readBody(request);
    const list = await readCategoriesFile();
    const slug = knownSlug(list, body);
    let targetSlug = slug;

    const wantsRename = typeof body?.newSlug === 'string' && body.newSlug.trim() && body.newSlug.trim().toLowerCase() !== slug;
    if (wantsRename) {
      const newSlug = body.newSlug.trim().toLowerCase();
      if (!SLUG_PATTERN.test(newSlug) || newSlug.length > MAX_SLUG_LENGTH) {
        throw new FormError(400, 'bad-request', 'The slug must be lowercase letters, digits and single hyphens, starting with a letter (e.g. "night-sky").');
      }
      if (list.some((c) => c.slug === newSlug)) throw new FormError(409, 'duplicate', `"${newSlug}" already exists.`);

      list.find((c) => c.slug === slug).slug = newSlug;
      await writeCategoriesFile(list);

      for (const locale of locales) {
        const messages = await readLocaleFile(locale);
        if (messages.categories && slug in messages.categories) {
          const { [slug]: text, ...rest } = messages.categories;
          messages.categories = { ...rest, [newSlug]: text };
          await writeLocaleFile(locale, messages);
        }
      }

      // Existing photos must follow their category, or they'd be left pointing at a slug that no longer
      // exists — the same primitive the New Photo form's own bulk-recategorize uses.
      if (sync) await pullEntries({ contentDir, storage, log });
      const moving = (await listEntries(contentDir)).filter((e) => e.data.category === slug);
      if (moving.length > 0) {
        const photos = moving.map((e) => ({ id: e.data.photo.id, category: slug }));
        await changeCategory({ photos, toCategory: newSlug, contentDir, categories: list.map((c) => c.slug), publish, log });
      }
      targetSlug = newSlug;
    }

    if ('hidden' in body) {
      const entry = list.find((c) => c.slug === targetSlug);
      if (body.hidden) entry.hidden = true;
      else delete entry.hidden;
      await writeCategoriesFile(list);
    }

    const wantsText = ['label', 'labelEs', 'description', 'descriptionEs'].some((field) => typeof body?.[field] === 'string');
    if (wantsText) {
      const label = body.label === undefined ? undefined : requiredText(body, 'label');
      const labelEs = body.labelEs === undefined ? undefined : requiredText(body, 'labelEs');
      const description = body.description === undefined ? undefined : requiredText(body, 'description');
      const descriptionEs = body.descriptionEs === undefined ? undefined : requiredText(body, 'descriptionEs');
      const byLocale = { en: { label, description }, es: { label: labelEs, description: descriptionEs } };
      for (const locale of locales) {
        const { label: newLabel, description: newDescription } = byLocale[locale];
        if (newLabel === undefined && newDescription === undefined) continue;
        const messages = await readLocaleFile(locale);
        const current = messages.categories?.[targetSlug];
        if (!current) throw new FormError(404, 'not-found', `"${targetSlug}" has no ${locale} text yet.`);
        messages.categories[targetSlug] = {
          ...current,
          ...(newLabel === undefined ? {} : { label: newLabel }),
          ...(newDescription === undefined ? {} : { description: newDescription }),
        };
        await writeLocaleFile(locale, messages);
      }
    }

    const [refreshed, en, es] = await Promise.all([readCategoriesFile(), readLocaleFile('en'), readLocaleFile('es')]);
    const photoCount = (await listEntries(contentDir)).filter((e) => e.data.category === targetSlug).length;
    return json(200, { ...describeOne(refreshed, { en, es }, targetSlug), photoCount });
  }

  async function remove({ request }) {
    const body = await readBody(request);
    const list = await readCategoriesFile();
    const slug = knownSlug(list, body);

    if (sync) await pullEntries({ contentDir, storage, log });
    const count = (await listEntries(contentDir)).filter((e) => e.data.category === slug).length;
    if (count > 0) throw new FormError(409, 'in-use', `${count} photo${count === 1 ? '' : 's'} still use "${slug}". Move or remove ${count === 1 ? 'it' : 'them'} first.`);

    await writeCategoriesFile(list.filter((c) => c.slug !== slug));
    for (const locale of locales) {
      const messages = await readLocaleFile(locale);
      if (messages.categories && slug in messages.categories) {
        const { [slug]: _removed, ...rest } = messages.categories;
        messages.categories = rest;
        await writeLocaleFile(locale, messages);
      }
    }
    return json(200, { slug });
  }

  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work, work);
    queue = turn.catch(() => {});
    return turn;
  };

  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(CATEGORY_FORM_PREFIX)) return null;
    const route = `${request.method} ${url.pathname.slice(CATEGORY_FORM_PREFIX.length)}`;
    try {
      assertOwnPage(request, url);
      switch (route) {
        case 'GET status':
          return await inTurn(() => status());
        case 'POST add':
          return await inTurn(() => add({ request }));
        case 'POST edit':
          return await inTurn(() => edit({ request }));
        case 'POST remove':
          return await inTurn(() => remove({ request }));
        default:
          throw new FormError(404, 'not-found', 'Not found.');
      }
    } catch (error) {
      if (error instanceof FormError) return json(error.status, { error: error.code, message: error.message });
      log(`Category Maintenance: ${error.message}`);
      return json(500, { error: 'failed', message: error.message });
    }
  };
}
