// Where the pages get the photo entries. In production the Worker reads them from R2 when a page is requested,
// so a photo added with the tools (or the Admin page's New Photo form) shows up without a build or a deploy.
//
//   production   the web bucket's `photos/index.json` through the Worker's WEB binding, kept for a few seconds
//                in the running Worker so a burst of visitors costs one read
//   `astro dev`  the same file over the bucket's public address (the local Workers runtime has no bucket of its own)
//   snapshot     (`PHOTOS_SNAPSHOT=1`, set by the tests) the sample library in test-fixtures/photos, so the whole
//                site can be built into static HTML and checked offline
//
// The branch on `import.meta.env.PHOTOS_SNAPSHOT` is decided at build time (astro.config.mjs), so the snapshot
// code is not part of the deployed Worker.
import { MANIFEST_KEY, parseManifest, toPhotoEntries, type PhotoEntry } from '../config/photo-manifest';
import { PHOTOS_BASE_URL } from '../config/photos';

/** The part of an R2 bucket binding the site uses. */
interface Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

/** How long a running Worker keeps the manifest before reading it again (the MANIFEST_CACHE_SECONDS variable overrides it). */
export const MANIFEST_CACHE_SECONDS = 10;

let cache: { at: number; entries: PhotoEntry[] } | null = null;

/** Reads the manifest's text from wherever this build reads it, or null when it is not there. */
async function readManifestText(bucket: Bucket | undefined): Promise<string | null> {
  if (import.meta.env.DEV) {
    const response = await fetch(`${PHOTOS_BASE_URL}/${MANIFEST_KEY}`, { headers: { 'Cache-Control': 'no-cache' } });
    return response.ok ? response.text() : null;
  }
  if (!bucket) throw new Error('The Worker has no WEB binding (the web bucket): see wrangler.jsonc');
  return (await bucket.get(MANIFEST_KEY))?.text() ?? null;
}

async function readEntries(bucket: Bucket | undefined): Promise<PhotoEntry[]> {
  const text = await readManifestText(bucket);
  // A missing manifest is an outage to report (a 500), never an empty gallery published as if all were well.
  if (text === null) throw new Error(`${MANIFEST_KEY} is missing from the web bucket`);
  const { entries, skipped } = parseManifest(text);
  for (const problem of skipped) console.error(`Photo entry skipped: ${problem}`);
  return toPhotoEntries(entries);
}

/** Every photo entry of the site (unsorted; pages sort and filter what they show). */
export async function getPhotos(): Promise<PhotoEntry[]> {
  if (import.meta.env.PHOTOS_SNAPSHOT) {
    const { getCollection } = await import('astro:content');
    return (await getCollection('photos')).map((entry) => ({ id: entry.id, data: entry.data }));
  }
  const { env } = await import('cloudflare:workers');
  const settings = env as { WEB?: Bucket; MANIFEST_CACHE_SECONDS?: string };
  const seconds = settings.MANIFEST_CACHE_SECONDS === undefined ? MANIFEST_CACHE_SECONDS : Number(settings.MANIFEST_CACHE_SECONDS);
  const now = Date.now();
  if (cache && now - cache.at < seconds * 1000) return cache.entries;
  const entries = await readEntries(settings.WEB);
  cache = { at: now, entries };
  return entries;
}
