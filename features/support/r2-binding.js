/**
 * Wraps a memory bucket's objects (as written by the real results publisher) in the read API of an R2
 * bucket binding (`env.RESULTS.get(key)`), so the results Worker can be tested against real published runs.
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
  };
}
