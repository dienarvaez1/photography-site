/**
 * A stand-in for the access log bucket (photography-site-access), with the parts of the R2 binding the site's Worker
 * and the results API use: get, conditional put (etag / If-None-Match) and list. `days` seeds it with day files
 * ({ day, entries }). `interfere(n)` makes the next n writes lose a race: another write lands just before each one,
 * the way a visit at the same moment does.
 */
export function fakeAccessBucket(days = []) {
  const objects = new Map(); // key -> { body, etag, uploaded }
  let version = 0;
  let interfering = 0;
  const store = (key, body) => objects.set(key, { body, etag: `e${++version}`, uploaded: new Date(Date.UTC(2026, 9, 1, 12, 0, version)) });
  for (const log of days) store(`logs/${log.day}.json`, JSON.stringify(log));

  const bucket = {
    puts: 0,
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { key, etag: object.etag, size: object.body.length, body: new Blob([object.body]).stream(), text: async () => object.body, json: async () => JSON.parse(object.body) };
    },
    async put(key, body, { onlyIf } = {}) {
      bucket.puts++;
      if (interfering > 0) {
        interfering--;
        // Someone else's entry lands first: the file changes under this writer.
        const current = objects.get(key);
        const log = current ? JSON.parse(current.body) : { day: key.slice(5, -5), entries: [] };
        log.entries.push({ time: `${key.slice(5, 15)}T00:00:00.000Z`, ip: '192.0.2.99', page: '/elsewhere/', event: 'view' });
        store(key, JSON.stringify(log));
      }
      const current = objects.get(key);
      const ifNoneMatch = onlyIf instanceof Headers ? onlyIf.get('If-None-Match') : null;
      if (ifNoneMatch === '*' && current) return null;
      if (onlyIf && !(onlyIf instanceof Headers) && onlyIf.etagMatches !== current?.etag) return null;
      store(key, body);
      return { key };
    },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      // Two at a time, so the results API's paging is exercised too.
      const start = Number(cursor ?? 0);
      const page = keys.slice(start, start + 2);
      const truncated = start + 2 < keys.length;
      return { objects: page.map((key) => ({ key, size: objects.get(key).body.length, uploaded: objects.get(key).uploaded })), truncated, ...(truncated ? { cursor: String(start + 2) } : {}) };
    },
    interfere(count) {
      interfering = count;
    },
    log: (day) => (objects.has(`logs/${day}.json`) ? JSON.parse(objects.get(`logs/${day}.json`).body) : null),
    keys: () => [...objects.keys()].sort(),
    raw: (key, body) => store(key, body),
  };
  return bucket;
}

/** Day files from a table: | time | ip | page | event | photo | category | (one row per entry), and optionally | country | city |. */
export function daysFromRows(rows) {
  const days = new Map();
  for (const row of rows) {
    const day = `${row.time.slice(0, 10)}T00:00:00.000Z`;
    const entry = { time: row.time, ip: row.ip, page: row.page, event: row.event, ...(row.photo ? { photo: { id: row.photo, category: row.category } } : {}), ...(row.country ? { geo: { ...(row.city ? { city: row.city } : {}), country: row.country } } : {}) };
    if (!days.has(day)) days.set(day, { day, entries: [] });
    days.get(day).entries.push(entry);
  }
  return [...days.values()];
}
