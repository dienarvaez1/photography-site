// Keeps the photo entries in R2 and a local mirror of them in step. Storage-agnostic, like photos.mjs:
// `storage.web` is the public web bucket ({ get(key), put(key, file, type, cache), delete(key), exists(key) }).
//
// The entries live in R2 (see src/config/photo-manifest.ts): one `photos/<category>/<id>.md` per entry, and
// `photos/index.json`, the manifest the site reads to render its pages. The photo commands work on a folder of
// .md files (`contentDir`, git-ignored), which is only a mirror:
//
//   pull   makes the mirror match R2 (refuses if the mirror has changes that were never published)
//   push   makes R2 match the mirror: new and changed .md files first, then the manifest (which is what makes
//          entries appear on the site), then the .md files of removed entries
//
// Nothing here lists the bucket: the manifest is the registry of entries.
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MANIFEST_KEY, buildManifest, entryKey, parseManifest, problemWith } from '../../src/config/photo-manifest.ts';
import { entryPath, listEntries, serializeEntry } from './photos.mjs';

const SYNCED_FILE = '.synced.json'; // what the mirror held when it last matched R2
const NO_CACHE = 'no-cache'; // the manifest and the .md files change: let no cache keep an old copy

/** A manifest entry for a local entry, or throws saying why it cannot be published. */
function toManifestEntry({ file, data }) {
  const entry = { category: data.category, id: data.photo?.id, data };
  const problem = problemWith(entry);
  if (problem) throw new Error(`${file} cannot be published: it ${problem}`);
  return entry;
}

/** JSON with every object's keys sorted, so the same data always gives the same text. */
const stable = (value) =>
  JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** The entries as one comparable string (order-independent, timestamp-free). */
const fingerprint = (entries) => stable(buildManifest(entries, '').entries);

async function localEntries(contentDir) {
  return (await listEntries(contentDir)).map((entry) => ({ ...entry, manifest: toManifestEntry(entry) }));
}

/** The entries R2 holds: [] before anything was published. Unusable entries stop the command (they would be lost on the next push). */
export async function readRemote(storage) {
  const bytes = await storage.web.get(MANIFEST_KEY);
  if (!bytes) return [];
  const { entries, skipped } = parseManifest(bytes.toString('utf-8'));
  if (skipped.length) throw new Error(`${MANIFEST_KEY} has entries the site cannot use, fix them first:\n  ${skipped.join('\n  ')}`);
  return entries;
}

async function readSynced(contentDir) {
  try {
    return await readFile(join(contentDir, SYNCED_FILE), 'utf-8');
  } catch {
    return null;
  }
}

async function putText(storage, key, text, contentType) {
  const dir = await mkdtemp(join(tmpdir(), 'entry-'));
  try {
    const file = join(dir, 'object');
    await writeFile(file, text);
    await storage.web.put(key, file, contentType, NO_CACHE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Makes the mirror match R2. Returns { entries, changed } (how many .md files were written or removed).
 * Refuses when the mirror holds entries that differ from R2 and were never published, unless `force`.
 */
export async function pullEntries({ contentDir, storage, force = false, log = () => {} }) {
  const remote = await readRemote(storage);
  await mkdir(contentDir, { recursive: true });
  const local = await localEntries(contentDir);
  const localFingerprint = fingerprint(local.map((e) => e.manifest));
  const remoteFingerprint = fingerprint(remote);

  if (localFingerprint !== remoteFingerprint) {
    // With no record of a sync, an empty mirror is a fresh one; anything else is work not yet published.
    const synced = (await readSynced(contentDir)) ?? fingerprint([]);
    if (localFingerprint !== synced && !force) {
      throw new Error(`The local entries (${contentDir}) have changes that were never published. Run "npm run photos:push" to publish them, or "npm run photos:pull -- --force" to discard them.`);
    }
  }

  let changed = 0;
  const wanted = new Set();
  for (const { category, id, data } of remote) {
    const file = entryPath(contentDir, category, id);
    wanted.add(file);
    const text = serializeEntry(data);
    const current = existsSync(file) ? await readFile(file, 'utf-8') : null;
    if (current !== text) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
      changed += 1;
    }
  }
  for (const { file } of local) {
    if (!wanted.has(file)) {
      await unlink(file);
      changed += 1;
    }
  }
  await writeFile(join(contentDir, SYNCED_FILE), remoteFingerprint);
  if (changed) log(`entries: ${changed} file(s) updated from R2`);
  return { entries: remote.length, changed };
}

/**
 * Makes R2 match the mirror. Returns { published, removed } (entries). New and changed .md files go first, then
 * the manifest, then the .md files of removed entries, so the site never lists an entry whose file is missing.
 */
export async function pushEntries({ contentDir, storage, log = () => {} }) {
  await mkdir(contentDir, { recursive: true });
  const local = await localEntries(contentDir);
  const remote = await readRemote(storage);
  const remoteByKey = new Map(remote.map((e) => [entryKey(e.category, e.id), stable(e.data)]));
  const localKeys = new Set(local.map((e) => entryKey(e.manifest.category, e.manifest.id)));

  const changed = local.filter((e) => remoteByKey.get(entryKey(e.manifest.category, e.manifest.id)) !== stable(e.data));
  const removed = remote.filter((e) => !localKeys.has(entryKey(e.category, e.id)));

  if (changed.length || removed.length) {
    for (const entry of changed) {
      const key = entryKey(entry.manifest.category, entry.manifest.id);
      await putText(storage, key, await readFile(entry.file, 'utf-8'), 'text/markdown; charset=utf-8');
      log(`  uploaded ${key}`);
    }
    const manifest = buildManifest(local.map((e) => e.manifest), new Date().toISOString());
    await putText(storage, MANIFEST_KEY, `${JSON.stringify(manifest, null, 2)}\n`, 'application/json; charset=utf-8');
    // What the site reads must be what was meant: read it back before removing anything.
    const stored = await storage.web.get(MANIFEST_KEY);
    if (!stored || fingerprint(parseManifest(stored.toString('utf-8')).entries) !== fingerprint(local.map((e) => e.manifest))) {
      throw new Error(`${MANIFEST_KEY} did not read back as written`);
    }
    log(`  uploaded ${MANIFEST_KEY} (${local.length} entries)`);
    for (const entry of removed) {
      await storage.web.delete(entryKey(entry.category, entry.id));
      log(`  deleted ${entryKey(entry.category, entry.id)}`);
    }
  }
  await writeFile(join(contentDir, SYNCED_FILE), fingerprint(local.map((e) => e.manifest)));
  return { published: changed.length, removed: removed.length };
}
