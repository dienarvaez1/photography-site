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
//
// The entries themselves live in R2 too (see entry-sync.mjs); `contentDir` is a local mirror of them. The commands
// that change entries take a `publish` callback, which pushes the mirror to R2. They call it once the local entry
// is written and BEFORE deleting anything a published entry might still point at, so the live site never lists a
// photo whose files are gone.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { CATEGORIES } from '../../src/config/categories.ts';
import {
  ENTRY_FOLDER,
  PHOTO_ID_PATTERN,
  PHOTO_VARIANTS,
  photoKey,
  photoKeys,
  variantSize,
} from '../../src/config/photos.ts';
import { entryKey } from '../../src/config/photo-manifest.ts';
import { readCameraLine } from './exif.mjs';

const CONTENT_TYPES = { original: 'image/jpeg', web: 'image/webp' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
const WEBP_QUALITY = 80;

// --- Analysing a photo ------------------------------------------------------

/** Content id: first 16 hex chars of the file's SHA-256. Same bytes, same id. */
export function contentId(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/**
 * The photo's average color, as `#rrggbb`: a cheap stand-in for a blurred placeholder (one hex
 * string instead of a second image payload) shown behind its gallery tile until the real thumbnail
 * loads. Resizing to 1x1 has libvips average every pixel for us; orientation doesn't matter for an
 * average, so this skips the `.rotate()` the real web variants need.
 */
export async function dominantColor(buffer) {
  const { data } = await sharp(buffer).resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0], data[1], data[2]].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Reads a photo file: its content id, its size as displayed (EXIF rotation applied), and its placeholder color. */
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
    placeholderColor: await dominantColor(buffer),
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

const FIELD_ORDER = ['title', 'titles', 'category', 'photo', 'camera', 'placeholderColor', 'featured', 'order'];

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

/**
 * Fields older versions wrote to entries and the site no longer uses. The tool never
 * writes them, so rewriting an older entry (replace, camera) cleans them up.
 */
const RETIRED_FIELDS = ['exif', 'copyright'];

export async function writeEntry(file, data, body = '') {
  const current = Object.fromEntries(Object.entries(data).filter(([key]) => !RETIRED_FIELDS.includes(key)));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeEntry(current, body));
}

/**
 * Where an entry's .md goes: `<contentDir>/<category>/images/<photo id>.md`.
 * The file is named after its photo id, so it maps 1:1 to its R2 objects
 * (`photos/<id>/...`); the photo itself is in R2, not next to the file.
 */
export function entryPath(contentDir, category, id) {
  return join(contentDir, category, ENTRY_FOLDER, `${id}.md`);
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
 * Adds a photo: uploads it, verifies it, reads the camera line from its EXIF,
 * writes its .md (`<category>/images/<photo id>.md`), then (unless keepSource)
 * deletes the local file. `camera` overrides the line built from EXIF. Only the
 * camera line is kept from EXIF: no copyright, dates, GPS or serial numbers.
 * Returns { file, photo, camera }.
 */
export async function addPhoto({ source, category, title, titleEs, camera, order = 0, featured = false, contentDir, storage, keepSource = false, categories = CATEGORIES.map((c) => c.slug), publish, log = () => {} }) {
  if (!category) throw new Error('--category is required');
  if (!categories.includes(category)) {
    throw new Error(`Unknown category "${category}". Configured categories: ${categories.join(', ')}`);
  }
  if (!title) throw new Error('--title is required');

  const { buffer, id, width, height, placeholderColor } = await analyzePhoto(source);
  const file = entryPath(contentDir, category, id);
  if ((await listEntries(contentDir)).some((e) => e.file === file)) {
    throw new Error(`${file} already exists — this photo is already in "${category}" (use "photos:replace" to change an entry's photo)`);
  }

  const cameraLine = camera ?? (await readCameraLine(buffer));
  log(`${basename(source)} -> ${id} (${width}x${height})${cameraLine ? '' : ' — no camera info in EXIF'}`);
  await uploadPhoto({ buffer, photo: { id, width, height }, storage, log });

  await writeEntry(file, {
    title,
    ...(titleEs ? { titles: { es: titleEs } } : {}),
    category,
    photo: { id, width, height },
    ...(cameraLine ? { camera: cameraLine } : {}),
    placeholderColor,
    featured,
    order,
  });
  await publish?.();
  if (!keepSource) {
    await unlink(source);
    log(`  removed local ${basename(source)} (safe copy is in R2)`);
  }
  return { file, photo: { id, width, height }, camera: cameraLine };
}

/**
 * Replaces the photo of an existing entry. The entry file is renamed to the new
 * photo id (same folder) and the old photo's objects are deleted once nothing
 * uses them. The camera line is `camera`, else the new photo's EXIF, else the
 * entry's existing line: a camera line is never lost.
 */
export async function replacePhoto({ entryFile, source, camera, contentDir, storage, keepSource = false, publish, log = () => {} }) {
  const entry = (await listEntries(contentDir)).find((e) => e.file === entryFile);
  if (!entry) throw new Error(`${entryFile} is not a photo entry`);
  const old = entry.data.photo;

  const { buffer, id, width, height, placeholderColor } = await analyzePhoto(source);
  const newFile = join(dirname(entryFile), `${id}.md`);
  if (newFile !== entryFile && (await listEntries(contentDir)).some((e) => e.file === newFile)) {
    throw new Error(`${newFile} already exists — that photo is already in this category`);
  }
  log(`${basename(source)} -> ${id} (${width}x${height})`);
  await uploadPhoto({ buffer, photo: { id, width, height }, storage, log });

  const cameraLine = camera ?? (await readCameraLine(buffer)) ?? entry.data.camera;
  const data = { ...entry.data, photo: { id, width, height }, placeholderColor };
  if (cameraLine) data.camera = cameraLine; else delete data.camera;
  await writeEntry(newFile, data, entry.body);
  if (newFile !== entryFile) await unlink(entryFile);
  await publish?.(); // the site now points at the new photo; only then may the old one go
  if (old?.id && old.id !== id) {
    await deletePhotoObjects({ id: old.id, contentDir, exceptFile: entryFile, storage, log });
  }
  if (!keepSource) await unlink(source);
  return { file: newFile, photo: { id, width, height } };
}

/** Removes an entry and its objects (objects kept if another entry shares the photo). */
export async function removePhoto({ entryFile, contentDir, storage, publish, log = () => {} }) {
  const entry = (await listEntries(contentDir)).find((e) => e.file === entryFile);
  if (!entry) throw new Error(`${entryFile} is not a photo entry`);
  await unlink(entryFile);
  await publish?.(); // the site stops listing the entry before its photo's files are deleted
  if (entry.data.photo?.id) {
    await deletePhotoObjects({ id: entry.data.photo.id, contentDir, exceptFile: entryFile, storage, log });
  }
}

/** The one key an original may have for a photo id: `photos/<id>/original.<extension>` (uploads always use `.jpg`). */
export const originalKeyPattern = (id) => new RegExp(`^photos/${id}/original\\.[a-z0-9]{1,8}$`);

/**
 * Removes whole photos in bulk. Each photo is named by its photo id together with the key of its original (which a
 * file put there by hand may give another extension). Deletes ONLY, for each id:
 *   - the entries that use that id, in every category (they are removed from the site first);
 *   - the photo's own files: that original, and the web sizes `photos/<id>/<size>.webp`.
 * The entries are unpublished (`publish`, once for all) BEFORE any file is deleted, so the site never lists a photo
 * whose files are gone; if that publishing fails the entries are put back and nothing is deleted. A file that cannot
 * be deleted fails only its own photo. Returns [{ id, entries: ['<category>', ...], deleted: [key, ...], error? }].
 */
export async function removePhotosById({ photos, contentDir, storage, publish, log = () => {} }) {
  const wanted = new Map();
  for (const { id, originalKey } of photos) {
    if (!PHOTO_ID_PATTERN.test(id ?? '')) throw new Error(`"${id}" is not a photo id`);
    if (!originalKeyPattern(id).test(originalKey ?? '')) throw new Error(`"${originalKey}" is not the original of photo ${id}`);
    wanted.set(id, originalKey);
  }

  const doomed = (await listEntries(contentDir)).filter((entry) => wanted.has(entry.data.photo?.id));
  const saved = await Promise.all(doomed.map(async (entry) => ({ file: entry.file, text: await readFile(entry.file, 'utf-8') })));
  for (const { file } of saved) await unlink(file);
  try {
    if (doomed.length) await publish?.();
  } catch (error) {
    for (const { file, text } of saved) await writeFile(file, text); // nothing was deleted: leave the mirror as it was
    throw error;
  }

  const results = [];
  for (const [id, originalKey] of wanted) {
    const result = { id, entries: doomed.filter((e) => e.data.photo.id === id).map((e) => e.data.category), deleted: [] };
    try {
      for (const [bucket, key] of [[storage.originals, originalKey], ...photoKeys(id).web.map((k) => [storage.web, k])]) {
        await bucket.delete(key);
        result.deleted.push(key);
      }
      log(`  removed photo ${id}`);
    } catch (error) {
      result.error = error.message;
    }
    results.push(result);
  }
  return results;
}

/**
 * Checks every entry against R2. Read-only.
 * Returns { problems: [{ file, message }], checked } — empty problems means in sync.
 * `deep` also downloads each original and compares its hash to the entry's id;
 * `checkEntries` also checks that each entry's .md is in the web bucket.
 */
export async function verifyPhotos({ contentDir, storage, deep = false, checkEntries = false, log = () => {} }) {
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
    if (checkEntries) {
      for (const key of await findMissing(storage.web, [entryKey(entry.data.category, photo.id)])) {
        problems.push({ file: entry.file, message: `entry file missing in web bucket: ${key}` });
      }
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

/**
 * Fills in a missing camera line from the EXIF of the entry's original in R2.
 * An entry that already has a camera line is never touched (nor its original
 * downloaded). Pass `entryFiles` to limit it to some entries.
 * Returns { updated, unchanged, problems }.
 */
export async function fillCameraLines({ contentDir, storage, entryFiles, publish, log = () => {} }) {
  const updated = [];
  const unchanged = [];
  const problems = [];
  for (const entry of await listEntries(contentDir)) {
    if (entryFiles && !entryFiles.includes(entry.file)) continue;
    if (typeof entry.data.camera === 'string' && entry.data.camera.trim()) {
      unchanged.push(entry.file);
      continue;
    }
    const photo = entry.data.photo;
    if (!photo?.id || !PHOTO_ID_PATTERN.test(photo.id)) {
      problems.push({ file: entry.file, message: 'has no valid photo.id' });
      continue;
    }
    const original = await storage.originals.get(photoKey(photo.id, 'original'));
    if (!original || contentId(original) !== photo.id) {
      problems.push({ file: entry.file, message: 'original missing or corrupted in R2 — cannot read EXIF' });
      continue;
    }
    const camera = await readCameraLine(original);
    const { camera: _empty, ...rest } = entry.data; // drop an empty `camera: ""`
    if (!camera) {
      if ('camera' in entry.data) await writeEntry(entry.file, rest, entry.body);
      unchanged.push(entry.file);
      continue;
    }
    await writeEntry(entry.file, { ...rest, camera }, entry.body);
    updated.push(entry.file);
    log(`camera line added to ${basename(entry.file)}`);
  }
  if (updated.length) await publish?.();
  return { updated, unchanged, problems };
}

/**
 * Fills in a missing placeholder color from the entry's own `thumb` web variant (already public and
 * small — no need for the private original just to average its pixels). An entry that already has
 * one is never touched. Pass `entryFiles` to limit it to some entries. A one-off backfill for
 * entries added before this field existed; every new photo gets one from `analyzePhoto` already.
 * Returns { updated, unchanged, problems }.
 */
export async function fillPlaceholderColors({ contentDir, storage, entryFiles, publish, log = () => {} }) {
  const updated = [];
  const unchanged = [];
  const problems = [];
  for (const entry of await listEntries(contentDir)) {
    if (entryFiles && !entryFiles.includes(entry.file)) continue;
    if (typeof entry.data.placeholderColor === 'string' && entry.data.placeholderColor) {
      unchanged.push(entry.file);
      continue;
    }
    const photo = entry.data.photo;
    if (!photo?.id || !PHOTO_ID_PATTERN.test(photo.id)) {
      problems.push({ file: entry.file, message: 'has no valid photo.id' });
      continue;
    }
    const thumb = await storage.web.get(photoKey(photo.id, 'thumb'));
    if (!thumb) {
      problems.push({ file: entry.file, message: 'thumb web size missing in R2 — cannot compute a placeholder color' });
      continue;
    }
    const placeholderColor = await dominantColor(thumb);
    await writeEntry(entry.file, { ...entry.data, placeholderColor }, entry.body);
    updated.push(entry.file);
    log(`placeholder color ${placeholderColor} added to ${basename(entry.file)}`);
  }
  if (updated.length) await publish?.();
  return { updated, unchanged, problems };
}
