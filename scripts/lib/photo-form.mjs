// Server side of the Admin page's New Photo form. Web-standard (Request -> Response) and storage-agnostic,
// like photos.mjs: the dev server wires it to the real R2 (photo-form-server.mjs), tests to a fake one.
//
//   GET  /__photos/status    { categories: { <slug>: { count, max, next } } }   what the form needs to start
//   POST /__photos/analyze   multipart `photo`        -> { id, width, height, camera, inCategories }
//   POST /__photos/add       multipart `photo`, `title`, `titleEs`, `category`, `order`, `featured`, `camera`
//                                                     -> { path, entry, id, width, height, camera, order }
//   GET  /__photos/entry?category=&id=                the same description of an entry already written
//                                                     (the dev server reloads the page when an entry appears,
//                                                     and the page asks again to show what was added)
//
// The form never invents anything the photo can tell it: the id (a hash of the file), the size as displayed
// and the camera line all come from the file, through the same code `npm run photos:add` uses (addPhoto),
// so a photo added here and one added from the command line are indistinguishable.
//
// The endpoints write into the project and upload with the owner's Cloudflare login, so they are for the
// owner's own machine only: they exist only in `astro dev`, answer only requests addressed to localhost,
// and refuse a POST that does not come from the page itself (a web page open in another tab cannot use them).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { CATEGORIES } from '../../src/config/categories.ts';
import { PHOTO_ID_PATTERN } from '../../src/config/photos.ts';
import { addPhoto, analyzePhoto, entryPath, listEntries } from './photos.mjs';
import { readCameraLine } from './exif.mjs';

export const PHOTO_FORM_PREFIX = '/__photos/';
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

class FormError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Photos per category and the highest `order` in each: what the form suggests the next photo's order to be. */
export async function categoryOrders(contentDir, categories = CATEGORIES.map((c) => c.slug)) {
  const orders = Object.fromEntries(categories.map((slug) => [slug, { count: 0, max: 0, next: 1 }]));
  for (const { data } of await listEntries(contentDir)) {
    const seen = orders[data.category];
    if (!seen) continue;
    seen.count += 1;
    if (typeof data.order === 'number' && data.order > seen.max) seen.max = data.order;
  }
  for (const seen of Object.values(orders)) seen.next = seen.max + 1;
  return orders;
}

/** Refuses anything but the owner's own page on localhost. */
function assertOwnPage(request, url) {
  if (!LOCAL_HOSTS.has(url.hostname)) throw new FormError(403, 'not-local', 'The New Photo form only answers on localhost.');
  const origin = request.headers.get('Origin');
  if (request.method === 'POST' ? origin !== url.origin : origin !== null && origin !== url.origin) {
    throw new FormError(403, 'not-local', 'The New Photo form only takes requests from its own page.');
  }
}

async function readForm(request) {
  const length = Number(request.headers.get('Content-Length'));
  if (length > MAX_UPLOAD_BYTES) throw new FormError(413, 'too-large', `The photo is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new FormError(400, 'bad-request', 'Send the form as multipart/form-data.');
  }
  const photo = form.get('photo');
  if (!photo || typeof photo === 'string' || typeof photo.arrayBuffer !== 'function') throw new FormError(400, 'bad-request', 'Choose a photo first.');
  const buffer = Buffer.from(await photo.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) throw new FormError(413, 'too-large', `The photo is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  return { form, buffer };
}

/** Runs `use(file)` with the upload saved as a JPEG in a folder of its own, gone afterwards. */
async function withFile(buffer, use) {
  const dir = await mkdtemp(join(tmpdir(), 'photo-form-'));
  try {
    const file = join(dir, 'upload.jpg');
    await writeFile(file, buffer);
    return await use(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The originals are stored as `original.jpg`, so only a JPEG is accepted (and it must be a readable one). */
async function assertJpeg(buffer) {
  let format;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    throw new FormError(400, 'unreadable', 'That file is not a readable image.');
  }
  if (format !== 'jpeg') throw new FormError(400, 'not-jpeg', 'Only JPEG photos are accepted.');
}

const text = (form, name) => String(form.get(name) ?? '').trim();

async function analyze({ request, contentDir, categories }) {
  const { buffer } = await readForm(request);
  await assertJpeg(buffer);
  const { id, width, height } = await withFile(buffer, analyzePhoto);
  const inCategories = (await listEntries(contentDir)).filter((e) => e.data.photo?.id === id && categories.includes(e.data.category)).map((e) => e.data.category);
  return json(200, { id, width, height, camera: (await readCameraLine(buffer)) ?? null, inCategories });
}

/** What the form shows about an entry: where it is, its text, and the values it was given. */
async function describeEntry(contentDir, category, id) {
  const file = entryPath(contentDir, category, id);
  const entry = (await listEntries(contentDir)).find((e) => e.file === file);
  if (!entry) return null;
  return {
    path: entryPath('.', category, id), // relative to src/content/photos
    entry: await readFile(file, 'utf-8'),
    id,
    order: entry.data.order ?? 0,
    camera: entry.data.camera ?? null,
  };
}

async function existing({ url, contentDir, categories }) {
  const category = url.searchParams.get('category') ?? '';
  const id = url.searchParams.get('id') ?? '';
  if (!categories.includes(category) || !PHOTO_ID_PATTERN.test(id)) throw new FormError(400, 'bad-request', 'Give a configured category and a 16-character photo id.');
  const described = await describeEntry(contentDir, category, id);
  if (!described) throw new FormError(404, 'not-found', `No entry for ${id} in ${category}.`);
  return json(200, described);
}

async function add({ request, contentDir, storage, categories }) {
  const { form, buffer } = await readForm(request);
  const title = text(form, 'title');
  const category = text(form, 'category');
  if (!title) throw new FormError(400, 'bad-request', 'A title is required.');
  if (!categories.includes(category)) throw new FormError(400, 'bad-request', `Unknown category "${category}". Configured categories: ${categories.join(', ')}`);
  await assertJpeg(buffer);

  // The order defaults to one past the highest in the category; a value typed in the form wins.
  const given = text(form, 'order');
  const order = given === '' ? (await categoryOrders(contentDir, categories))[category].next : Number(given);
  if (!Number.isInteger(order) || order < 0) throw new FormError(400, 'bad-request', 'The order must be a whole number, 0 or more.');

  // `camera` sent (even empty) is the owner's decision; not sent, the photo's own EXIF is used.
  const camera = form.has('camera') ? text(form, 'camera') : undefined;
  const result = await withFile(buffer, (source) =>
    addPhoto({ source, category, title, titleEs: text(form, 'titleEs') || undefined, camera, order, featured: text(form, 'featured') === 'true', contentDir, storage, keepSource: true, categories })
  ).catch((error) => {
    if (/already exists/.test(error.message)) throw new FormError(409, 'duplicate', error.message);
    throw error;
  });
  return json(200, { ...(await describeEntry(contentDir, category, result.photo.id)), ...result.photo, camera: result.camera ?? null, order });
}

/**
 * Answers a request for the New Photo form, or returns null when it is not one of its addresses.
 * One photo is added at a time, so two quick submissions can never be handed the same order.
 */
export function createPhotoFormHandler({ contentDir, storage, categories = CATEGORIES.map((c) => c.slug), log = () => {} }) {
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work, work);
    queue = turn.catch(() => {});
    return turn;
  };

  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PHOTO_FORM_PREFIX)) return null;
    const route = `${request.method} ${url.pathname.slice(PHOTO_FORM_PREFIX.length)}`;
    try {
      assertOwnPage(request, url);
      switch (route) {
        case 'GET status':
          return json(200, { categories: await categoryOrders(contentDir, categories) });
        case 'GET entry':
          return await existing({ url, contentDir, categories });
        case 'POST analyze':
          return await analyze({ request, contentDir, categories });
        case 'POST add':
          return await inTurn(() => add({ request, contentDir, storage, categories, log }));
        default:
          throw new FormError(404, 'not-found', 'Not found.');
      }
    } catch (error) {
      if (error instanceof FormError) return json(error.status, { error: error.code, message: error.message });
      log(`New Photo form: ${error.message}`);
      return json(500, { error: 'failed', message: error.message });
    }
  };
}
