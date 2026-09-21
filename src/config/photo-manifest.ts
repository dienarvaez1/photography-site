// The photo entries the site shows, and where they live. Plain module (no imports) so the Astro site, the
// Worker that renders it and the photo tooling (scripts/photos.mjs) all read the same format.
//
// Entries live in the public web bucket next to the photos' pictures, in R2:
//   photos/<category>/<photo id>.md   one Markdown file per entry (what the tools write; readable by people)
//   photos/index.json                 the manifest: every entry's data in one file, sorted, so the site reads
//                                     the whole gallery with ONE request and never parses Markdown
// The tools write an entry's .md first and the manifest last (it is what makes the entry appear on the site),
// and remove from the manifest before deleting a .md. Nothing lists the bucket: the manifest is the registry.

export const MANIFEST_KEY = 'photos/index.json';
export const MANIFEST_VERSION = 1;

/** Where an entry's Markdown file lives in the web bucket. */
export const entryKey = (category: string, id: string): string => `photos/${category}/${id}.md`;

/** What an entry's front matter holds (the same fields the .md files always had). */
export interface PhotoData {
  title: string;
  titles?: Record<string, string>;
  category: string;
  photo: { id: string; width: number; height: number };
  camera?: string;
  featured: boolean;
  order: number;
}

/** An entry as the pages use it: `id` is unique across the site (`<category>/<photo id>`). */
export interface PhotoEntry {
  id: string;
  data: PhotoData;
}

export interface ManifestEntry {
  category: string;
  id: string; // the photo id
  data: PhotoData;
}

export interface Manifest {
  version: typeof MANIFEST_VERSION;
  updatedAt: string;
  entries: ManifestEntry[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositiveInt = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

/** Checks one entry's data against the fields the site relies on; returns why it is unusable, or null. */
export function problemWith(entry: unknown): string | null {
  if (!isObject(entry) || !isObject(entry.data)) return 'is not an entry';
  const { category, id, data } = entry as { category?: unknown; id?: unknown; data: Record<string, unknown> };
  const photo = data.photo;
  if (typeof category !== 'string' || !category) return 'has no category';
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) return 'has no valid photo id';
  if (data.category !== category) return 'has a category that differs from its data';
  if (typeof data.title !== 'string' || !data.title) return 'has no title';
  if (!isObject(photo) || photo.id !== id || !isPositiveInt(photo.width) || !isPositiveInt(photo.height)) return 'has no valid photo';
  if (data.titles !== undefined && (!isObject(data.titles) || Object.values(data.titles).some((t) => typeof t !== 'string'))) return 'has invalid titles';
  if (data.camera !== undefined && typeof data.camera !== 'string') return 'has an invalid camera line';
  if (typeof data.featured !== 'boolean') return 'has no featured flag';
  if (typeof data.order !== 'number' || !Number.isFinite(data.order)) return 'has no order';
  return null;
}

const byOrder = (a: ManifestEntry, b: ManifestEntry) => a.category.localeCompare(b.category) || a.data.order - b.data.order || a.id.localeCompare(b.id);

/** The manifest for these entries, in a fixed order (so an unchanged library gives an unchanged file). */
export function buildManifest(entries: ManifestEntry[], updatedAt: string): Manifest {
  return { version: MANIFEST_VERSION, updatedAt, entries: [...entries].sort(byOrder) };
}

/**
 * Reads a manifest file. A file that is not a manifest at all throws (the site must not show an empty gallery
 * as if nothing were wrong); one unusable entry is skipped and reported, so it cannot take the rest down.
 */
export function parseManifest(text: string): { entries: ManifestEntry[]; skipped: string[] } {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error(`${MANIFEST_KEY} is not valid JSON`);
  }
  if (!isObject(manifest) || manifest.version !== MANIFEST_VERSION || !Array.isArray(manifest.entries)) {
    throw new Error(`${MANIFEST_KEY} is not a version ${MANIFEST_VERSION} manifest`);
  }
  const entries: ManifestEntry[] = [];
  const skipped: string[] = [];
  for (const entry of manifest.entries) {
    const problem = problemWith(entry);
    if (problem) skipped.push(`${isObject(entry) ? `${entry.category}/${entry.id}` : 'an item'} ${problem}`);
    else entries.push(entry as ManifestEntry);
  }
  return { entries, skipped };
}

/** The pages' view of manifest entries. */
export const toPhotoEntries = (entries: ManifestEntry[]): PhotoEntry[] => entries.map((e) => ({ id: `${e.category}/${e.id}`, data: e.data }));
