/**
 * Wraps a memory bucket's objects (as written by the real results publisher) in the API of an R2 bucket binding
 * (`env.RESULTS.get(key)`, and `put` / `delete` for Remove Results), so the results Worker can be tested against real
 * published runs. Deletes go through the memory bucket's own delete, so its simulated failures apply.
 */
export function asR2Binding(bucket) {
  return {
    async get(key) {
      const object = bucket.objects.get(key);
      if (!object) return null;
      const bytes = object.body;
      return {
        key,
        size: bytes.length,
        body: new Blob([bytes]).stream(),
        async text() {
          return bytes.toString('utf-8');
        },
        async json() {
          return JSON.parse(bytes.toString('utf-8'));
        },
      };
    },
    /** Stores a string or bytes, keeping the content type and cache control the way the publisher's objects do. */
    async put(key, value, options = {}) {
      const body = typeof value === 'string' ? Buffer.from(value, 'utf-8') : Buffer.from(value);
      bucket.objects.set(key, { body, contentType: options.httpMetadata?.contentType, cacheControl: options.httpMetadata?.cacheControl });
    },
    /** Deletes one key or a list of them (R2 takes up to 1000 at once); a missing key is already deleted. */
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) await bucket.delete(key);
    },
  };
}
