import { readFile } from 'node:fs/promises';

/**
 * In-memory stand-in for R2 (same interface as scripts/lib/r2-storage.mjs), so
 * the photo workflow is tested with no network. `faults` injects failures.
 */
export function createMemoryStorage() {
  const originals = new Map();
  const web = new Map();
  const faults = { failPutMatching: null, corruptOriginals: false };

  const bucket = (map, { corruptible }) => ({
    async put(key, file, contentType, cacheControl) {
      if (faults.failPutMatching && key.includes(faults.failPutMatching)) {
        throw new Error(`simulated upload failure for ${key}`);
      }
      map.set(key, { body: await readFile(file), contentType, cacheControl });
    },
    async get(key) {
      const object = map.get(key);
      if (!object) return null;
      return corruptible && faults.corruptOriginals ? Buffer.concat([object.body, Buffer.from('x')]) : Buffer.from(object.body);
    },
    async delete(key) {
      map.delete(key);
    },
    async exists(key) {
      return map.has(key);
    },
  });

  return {
    originals: bucket(originals, { corruptible: true }),
    web: bucket(web, { corruptible: false }),
    objects: { originals, web },
    faults,
  };
}
