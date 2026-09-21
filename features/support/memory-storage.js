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

/** A single fake bucket with the put/get/delete interface of a private R2 bucket, for the test-results tests. */
export function createMemoryBucket() {
  const objects = new Map();
  const faults = { failPutMatching: null, failDeleteMatching: null };
  return {
    objects,
    faults,
    async put(key, file, contentType, cacheControl) {
      if (faults.failPutMatching && key.includes(faults.failPutMatching)) throw new Error(`simulated upload failure for ${key}`);
      objects.set(key, { body: await readFile(file), contentType, cacheControl });
    },
    async get(key) {
      const object = objects.get(key);
      return object ? Buffer.from(object.body) : null;
    },
    async delete(key) {
      if (faults.failDeleteMatching && key.includes(faults.failDeleteMatching)) throw new Error(`simulated delete failure for ${key}`);
      objects.delete(key);
    },
  };
}
