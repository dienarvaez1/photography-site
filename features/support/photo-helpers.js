import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib.js';
import { createMemoryStorage } from './memory-storage.js';

/** The photo workflow's library modules, loaded once. */
export const lib = await import(join(ROOT, 'scripts/lib/photos.mjs'));
export const exifLib = await import(join(ROOT, 'scripts/lib/exif.mjs'));
export const cli = await import(join(ROOT, 'scripts/lib/cli.mjs'));
export const config = await import(join(ROOT, 'src/config/photos.ts'));

export const state = (world) => world.data.photos;
export const sourcePath = (world, name) => join(state(world).filesDir, name);

/**
 * Entries are named by photo id, so tests refer to them as "<category>/<title slug>",
 * e.g. "nature/rockfish" for the entry titled "Rockfish" in the nature category
 * (a file name, e.g. "nature/legacy", also works).
 */
export async function findEntry(world, ref) {
  const [category, slug] = ref.split('/');
  const matches = (await lib.listEntries(state(world).contentDir)).filter(
    (e) =>
      e.data.category === category &&
      (basename(e.file, '.md') === slug || lib.slugify(String(e.data.title ?? '')) === slug)
  );
  if (matches.length > 1) throw new Error(`"${ref}" matches ${matches.length} entries`);
  return matches[0];
}

export async function entryFile(world, ref) {
  const entry = await findEntry(world, ref);
  if (!entry) throw new Error(`No entry "${ref}"`);
  return entry.file;
}

export async function readEntry(world, ref) {
  const entry = await findEntry(world, ref);
  if (!entry) throw new Error(`No entry "${ref}"`);
  return entry.data;
}

export async function createLibrary(world) {
  const dir = await mkdtemp(join(tmpdir(), 'photo-lib-'));
  const contentDir = join(dir, 'content');
  const filesDir = join(dir, 'files');
  await mkdir(contentDir);
  await mkdir(filesDir);
  world.data.photos = { dir, contentDir, filesDir, storage: createMemoryStorage() };
}

export async function removeLibrary(world) {
  if (world.data.photos?.dir) await rm(world.data.photos.dir, { recursive: true, force: true });
}

/** Deterministic distinct colour per file name, so different names give different bytes. */
function colourFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 };
}

// Where each EXIF tag lives in the file: IFD0 = main image, IFD2 = Exif sub-block, IFD3 = GPS.
const IFD = {
  Make: 'IFD0', Model: 'IFD0', Copyright: 'IFD0', Artist: 'IFD0',
  ExposureTime: 'IFD2', FNumber: 'IFD2', ISOSpeedRatings: 'IFD2', FocalLength: 'IFD2', LensModel: 'IFD2',
  DateTimeOriginal: 'IFD2', BodySerialNumber: 'IFD2',
  GPSLatitudeRef: 'IFD3', GPSLatitude: 'IFD3', GPSLongitudeRef: 'IFD3', GPSLongitude: 'IFD3',
};

/** Human values ("5.6", "140", "2.5", "1/125") -> the "numerator/denominator" strings EXIF stores. */
function exifValue(tag, value) {
  if (tag === 'FNumber') return `${Math.round(Number(value) * 10)}/10`;
  if (tag === 'FocalLength') return `${Math.round(Number(value) * 10)}/10`;
  if (tag === 'ExposureTime') return value.includes('/') ? value : `${Math.round(Number(value) * 10)}/10`;
  return value;
}

/** Writes a JPEG to the files folder, optionally with EXIF tags ({ tag: value }) and/or an orientation. */
export async function makeJpeg(world, name, width, height, { orientation, exif } = {}) {
  state(world).specs = { ...state(world).specs, [name]: { width, height, exif } };
  let image = sharp({ create: { width, height, channels: 3, background: colourFor(name) } }).jpeg();
  const tags = { IFD0: {}, IFD2: {}, IFD3: {} };
  for (const [tag, value] of Object.entries(exif ?? {})) {
    if (!IFD[tag]) throw new Error(`Unknown EXIF tag in test: ${tag}`);
    tags[IFD[tag]][tag] = exifValue(tag, value);
  }
  const withTags = Object.fromEntries(Object.entries(tags).filter(([, v]) => Object.keys(v).length));
  if (Object.keys(withTags).length) image = image.withExif(withTags);
  if (orientation) image = image.withMetadata({ orientation });
  await image.toFile(sourcePath(world, name));
}
