// Core of the photo workflow. Storage-agnostic: every function takes a
// `storage` object (see r2-storage.mjs; tests pass an in-memory fake), so
// nothing here knows about the network.
//
//   storage.web       public bucket   { exists(key), put(key, file, type), delete(key) }
//   storage.originals private bucket  { put(key, file, type), get(key) -> Buffer|null, delete(key) }
//
// Invariant: an entry's .md is written only after every object it needs is in
// R2 and checked, and a source file is deleted only after that. A failure
// part-way therefore never leaves an .md pointing at missing photos or loses
// the only copy of a file.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import {
  PHOTO_ID_PATTERN,
  PHOTO_VARIANTS,
  photoKey,
  photoKeys,
  variantSize,
} from '../../src/config/photos.ts';

const CONTENT_TYPES = { original: 'image/jpeg', web: 'image/webp' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
const WEBP_QUALITY = 80;

// --- Analysing a photo ------------------------------------------------------

/** Content id: first 16 hex chars of the file's SHA-256. Same bytes, same id. */
export function contentId(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/** Reads a photo file: its content id and its size as displayed (EXIF rotation applied). */
export async function analyzePhoto(file) {
  const buffer = await readFile(file);
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error(`${file}: not a readable image`);
  const rotated = (meta.orientation ?? 1) >= 5; // orientations 5-8 swap width and height
  return {
    buffer,
    id: contentId(buffer),
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
  };
}

/** Renders each web variant (auto-rotated, never upscaled) as WebP to `dir`; returns { variant: filePath }. */
export async function renderVariants(buffer, photo, dir) {
  const files = {};
  for (const variant of Object.keys(PHOTO_VARIANTS)) {
    const { width } = variantSize(photo, variant);
    const file = join(dir, `${variant}.webp`);
    await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toFile(file);
    files[variant] = file;
  }
  return files;
}

// --- Uploading --------------------------------------------------------------

/**
 * Puts a photo into R2 (idempotent: same file, same keys) and confirms it
 * arrived before returning. `buffer` is the original's bytes.
 */
export async function uploadPhoto({ buffer, photo, storage, log = () => {} }) {
  const dir = await mkdtemp(join(tmpdir(), 'photo-'));
  try {
    const originalFile = join(dir, 'original.jpg');
    await writeFile(originalFile, buffer);
    const variants = await renderVariants(buffer, photo, dir);

    await storage.originals.put(photoKey(photo.id, 'original'), originalFile, CONTENT_TYPES.original, IMMUTABLE);
    log(`  uploaded ${photoKey(photo.id, 'original')} (private)`);
    for (const [variant, file] of Object.entries(variants)) {
      await storage.web.put(photoKey(photo.id, variant), file, CONTENT_TYPES.web, IMMUTABLE);
      log(`  uploaded ${photoKey(photo.id, variant)}`);
    }

    // Confirm before anyone deletes or references anything: the original must
    // read back byte-identical, and every web variant must be served.
    const stored = await storage.originals.get(photoKey(photo.id, 'original'));
    if (!stored || contentId(stored) !== photo.id) {
      throw new Error(`Original for ${photo.id} did not read back identical from R2`);
    }
    const missing = await findMissing(storage.web, photoKeys(photo.id).web);
    if (missing.length) throw new Error(`Web variants not served after upload: ${missing.join(', ')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function findMissing(bucket, keys) {
  const missing = [];
  for (const key of keys) if (!(await bucket.exists(key))) missing.push(key);
  return missing;
}

// --- Entries (.md files) ----------------------------------------------------

/** Every photo entry under `contentDir`, as { file, data, body }. */
export async function listEntries(contentDir) {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  await walk(contentDir);
  const entries = [];
  for (const file of files.sort()) {
    const { data, content } = matter(await readFile(file, 'utf-8'));
    entries.push({ file, data, body: content });
  }
  return entries;
}

const FIELD_ORDER = ['title', 'titles', 'category', 'photo', 'camera', 'copyright', 'featured', 'order'];

/** YAML lines for `key: value`; nested objects become an indented block (no trailing space after the key). */
function yamlLines(key, value, indent) {
  const pad = ' '.repeat(indent);
  if (value !== null && typeof value === 'object') {
    return [`${pad}${key}:`, ...Object.entries(value).flatMap(([k, v]) => yamlLines(k, v, indent + 2))];
  }
  return [`${pad}${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`];
}

/** Serializes an entry in the repo's existing style (quoted strings, fixed field order). */
export function serializeEntry(data, body = '') {
  const keys = [...FIELD_ORDER.filter((k) => k in data), ...Object.keys(data).filter((k) => !FIELD_ORDER.includes(k))];
  const lines = keys.filter((k) => data[k] !== undefined).flatMap((k) => yamlLines(k, data[k], 0));
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

export async function writeEntry(file, data, body = '') {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeEntry(data, body));
}

export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Ids referenced by every entry except `exceptFile` — their objects must not be deleted. */
async function idsInUse(contentDir, exceptFile) {
  const ids = new Set();
  for (const entry of await listEntries(contentDir)) {
    if (entry.file !== exceptFile && entry.data.photo?.id) ids.add(entry.data.photo.id);
  }
  return ids;
}

/** Deletes a photo's objects from R2, unless another entry still uses the same id. */
async function deletePhotoObjects({ id, contentDir, exceptFile, storage, log }) {
  if ((await idsInUse(contentDir, exceptFile)).has(id)) {
    log(`  kept ${id}: another entry uses the same photo`);
    return false;
  }
  await storage.originals.delete(photoKey(id, 'original'));
  for (const key of photoKeys(id).web) await storage.web.delete(key);
  log(`  deleted objects for ${id}`);
  return true;
}

// --- Commands ---------------------------------------------------------------

/**
 * Adds a photo: uploads it, verifies it, writes its .md, then (unless
 * keepSource) deletes the local file. Returns { file, photo }.
 */
export async function addPhoto({ source, category, title, slug, titleEs, camera, copyright, order = 0, featured = false, contentDir, storage, keepSource = false, log = () => {} }) {
  if (!category) throw new Error('--category is required');
  if (!title) throw new Error('--title is required');
  const finalSlug = slug ?? slugify(title);
  const file = join(contentDir, category, `${finalSlug}.md`);
  if ((await listEntries(contentDir)).some((e) => e.file === file)) {
    throw new Error(`${file} already exists — use "photos:replace" to change its photo`);
  }

  const { buffer, id, width, height } = await analyzePhoto(source);
  log(`${basename(source)} -> ${id} (${width}x${height})`);
  await uploadPhoto({ buffer, photo: { id, width, height }, storage, log });

  await writeEntry(file, {
    title,
    ...(titleEs ? { titles: { es: titleEs } } : {}),
    category,
    photo: { id, width, height },
    ...(camera ? { camera } : {}),
    ...(copyright ? { copyright } : {}),
    featured,
    order,
  });
  if (!keepSource) {
    await unlink(source);
    log(`  removed local ${basename(source)} (safe copy is in R2)`);
  }
  return { file, photo: { id, width, height } };
}

/** Replaces the photo of an existing entry; the old photo's objects are deleted once nothing uses them. */
export async function replacePhoto({ entryFile, source, contentDir, storage, keepSource = false, log = () => {} }) {
  const entry = (await listEntries(contentDir)).find((e) => e.file === entryFile);
  if (!entry) throw new Error(`${entryFile} is not a photo entry`);
  const old = entry.data.photo;

  const { buffer, id, width, height } = await analyzePhoto(source);
  log(`${basename(source)} -> ${id} (${width}x${height})`);
  await uploadPhoto({ buffer, photo: { id, width, height }, storage, log });

  await writeEntry(entryFile, { ...entry.data, photo: { id, width, height } }, entry.body);
  if (old?.id && old.id !== id) {
    await deletePhotoObjects({ id: old.id, contentDir, exceptFile: entryFile, storage, log });
  }
  if (!keepSource) await unlink(source);
  return { file: entryFile, photo: { id, width, height } };
}

/** Removes an entry and its objects (objects kept if another entry shares the photo). */
export async function removePhoto({ entryFile, contentDir, storage, log = () => {} }) {
  const entry = (await listEntries(contentDir)).find((e) => e.file === entryFile);
  if (!entry) throw new Error(`${entryFile} is not a photo entry`);
  await unlink(entryFile);
  if (entry.data.photo?.id) {
    await deletePhotoObjects({ id: entry.data.photo.id, contentDir, exceptFile: entryFile, storage, log });
  }
}

/**
 * Checks every entry against R2. Read-only.
 * Returns { problems: [{ file, message }], checked } — empty problems means in sync.
 * `deep` also downloads each original and compares its hash to the entry's id.
 */
export async function verifyPhotos({ contentDir, storage, deep = false, log = () => {} }) {
  const problems = [];
  const entries = await listEntries(contentDir);
  for (const entry of entries) {
    const photo = entry.data.photo;
    if (!photo?.id || !PHOTO_ID_PATTERN.test(photo.id)) {
      problems.push({ file: entry.file, message: 'has no valid photo.id' });
      continue;
    }
    for (const key of await findMissing(storage.web, photoKeys(photo.id).web)) {
      problems.push({ file: entry.file, message: `missing in web bucket: ${key}` });
    }
    if (deep) {
      const stored = await storage.originals.get(photoKey(photo.id, 'original'));
      if (!stored) problems.push({ file: entry.file, message: `missing in originals bucket: ${photoKey(photo.id, 'original')}` });
      else if (contentId(stored) !== photo.id) problems.push({ file: entry.file, message: 'original in R2 does not match photo.id (corrupted?)' });
    }
    log(`checked ${basename(entry.file)}`);
  }
  return { problems, checked: entries.length };
}

/**
 * Repairs missing web variants from the original in R2 (e.g. after changing
 * PHOTO_VARIANTS). Returns { repaired: [file], problems }; an entry whose
 * original is missing can't be repaired and is reported.
 */
export async function syncPhotos({ contentDir, storage, log = () => {} }) {
  const repaired = [];
  const problems = [];
  for (const entry of await listEntries(contentDir)) {
    const photo = entry.data.photo;
    if (!photo?.id || !PHOTO_ID_PATTERN.test(photo.id)) {
      problems.push({ file: entry.file, message: 'has no valid photo.id' });
      continue;
    }
    const missing = await findMissing(storage.web, photoKeys(photo.id).web);
    if (!missing.length) continue;
    const original = await storage.originals.get(photoKey(photo.id, 'original'));
    if (!original || contentId(original) !== photo.id) {
      problems.push({ file: entry.file, message: `cannot repair ${missing.join(', ')}: original missing or corrupted in R2` });
      continue;
    }
    log(`repairing ${basename(entry.file)}: ${missing.join(', ')}`);
    await uploadPhoto({ buffer: original, photo, storage, log });
    repaired.push(entry.file);
  }
  return { repaired, problems };
}
