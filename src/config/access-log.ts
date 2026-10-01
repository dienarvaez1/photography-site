// The site's access log: who opened which page, and which photo, when. Plain module (no imports) so the site's
// beacon endpoint (src/endpoints/access.ts), the results API that shows it on the Admin page
// (workers/results-api/src/access.mjs) and the tests all read the same format.
//
// It lives in its own private bucket, one file per UTC day, named by the day's first instant:
//   photography-site-access / logs/2026-10-01T00:00:00.000Z.json   { day, entries: [...] }, oldest entry first
//
// R2 can't append, so an entry is added by reading the day's file and writing it back on condition that nobody wrote
// it in between (its etag); when somebody did, that is done again. Two visitors at the same moment both get recorded.

export const ACCESS_BUCKET = 'photography-site-access';
export const ACCESS_PREFIX = 'logs/';
/** A day file's key, by its first instant in UTC. */
export const DAY_KEY = /^logs\/(\d{4}-\d{2}-\d{2})T00:00:00\.000Z\.json$/;
/** A day as the API and the Admin page name it: the same first instant, `2026-10-01T00:00:00.000Z`. */
export const DAY = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;

export const ACCESS_EVENTS = ['view', 'photo'] as const;
export type AccessEvent = (typeof ACCESS_EVENTS)[number];

/** One visit to a page (`view`), or one photo opened in the lightbox (`photo`). */
export interface AccessEntry {
  /** When it was recorded, by the Worker's clock: ISO 8601 in UTC (`2026-10-01T14:30:00.000Z`). */
  time: string;
  /** The visitor's address, as Cloudflare saw it (`CF-Connecting-IP`). */
  ip: string;
  /** The page's path, without its query or fragment (`/es/work/nature/`). */
  page: string;
  event: AccessEvent;
  /** For `photo`: the photo's id and the category it was opened in. */
  photo?: { id: string; category: string };
  /** Where the address is, as Cloudflare places it (or, for entries from before this was recorded, a lookup service). */
  geo?: AccessGeo;
}

/** A place, by name; any part Cloudflare doesn't know is left out. */
export interface AccessGeo {
  city?: string;
  /** The country's English name: `Netherlands`, `Mexico`. */
  country?: string;
  continent?: string;
  /** IANA: `Europe/Amsterdam`. */
  timezone?: string;
}

const CONTINENTS: Record<string, string> = { AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America' };
const TIMEZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;
const regions = new Intl.DisplayNames(['en'], { type: 'region' });

/** A country's English name from its ISO code; Cloudflare's own `XX` (unknown) and `T1` (Tor) are no country. */
function countryName(code: unknown): string | undefined {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return undefined;
  try {
    const name = regions.of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() && value.length <= 100 ? value.trim() : undefined);

/**
 * The `geo` of an entry from what Cloudflare knows about the request (`request.cf`: `city`, `country` as an ISO code,
 * `continent` as a code, `timezone`), in the log's own words: names, not codes. Undefined when it knows none of them.
 */
export function geoFrom(cf: { city?: unknown; country?: unknown; continent?: unknown; timezone?: unknown } | null | undefined): AccessGeo | undefined {
  if (!cf) return undefined;
  const timezone = text(cf.timezone);
  const geo: AccessGeo = {
    city: text(cf.city),
    country: countryName(cf.country),
    continent: typeof cf.continent === 'string' ? CONTINENTS[cf.continent] : undefined,
    timezone: timezone && TIMEZONE.test(timezone) ? timezone : undefined,
  };
  for (const key of Object.keys(geo) as (keyof AccessGeo)[]) if (geo[key] === undefined) delete geo[key];
  return Object.keys(geo).length ? geo : undefined;
}

export interface AccessDay {
  day: string;
  entries: AccessEntry[];
}

/** A day file holds at most this many entries; later ones that day are dropped, so a flood can't grow it forever. */
export const MAX_ENTRIES_PER_DAY = 20_000;
/**
 * How often an entry is tried when other writes keep winning the race. Each try waits a little longer, at random, so
 * visits that collided once spread out instead of colliding again; waiting costs a Worker no CPU time.
 */
const MAX_ATTEMPTS = 30;
const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(200, 10 * 2 ** attempt)));

const PHOTO_ID = /^[0-9a-f]{16}$/;
const CATEGORY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// A path as a browser sends it: printable, no spaces or quotes, at most 300 characters. Anything else is refused.
const PAGE = /^\/[\x21-\x7e]{0,299}$/;

/** The day an instant belongs to, as its first instant: `2026-10-01T14:30:00.000Z` → `2026-10-01T00:00:00.000Z`. */
export const dayOf = (time: string): string => `${time.slice(0, 10)}T00:00:00.000Z`;
export const dayKey = (day: string): string => `${ACCESS_PREFIX}${day}.json`;

/**
 * What the page sends, checked: `{ page, event, photo? }`. Returns null for anything that isn't exactly that, so
 * nothing but a path, one of two words and a photo id ever reaches the log.
 */
export function parseBeacon(body: unknown): Pick<AccessEntry, 'page' | 'event' | 'photo'> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { page, event, photo, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) return null;
  if (typeof page !== 'string' || !PAGE.test(page) || /["'<>\\`]/.test(page)) return null;
  if (event === 'view') return photo === undefined ? { page, event } : null;
  if (event !== 'photo' || !photo || typeof photo !== 'object' || Array.isArray(photo)) return null;
  const { id, category, ...more } = photo as Record<string, unknown>;
  if (Object.keys(more).length || typeof id !== 'string' || !PHOTO_ID.test(id) || typeof category !== 'string' || !CATEGORY.test(category) || category.length > 40) return null;
  return { page, event, photo: { id, category } };
}

/** The parts of an R2 bucket binding this needs (the real one, or the tests' fake). */
export interface LogBucket {
  get(key: string): Promise<{ etag: string; text(): Promise<string> } | null>;
  put(key: string, value: string, options: { httpMetadata?: { contentType: string }; onlyIf: { etagMatches: string } | Headers }): Promise<object | null>;
}

/** A day file's entries; a missing, unreadable or foreign file counts as empty rather than failing the visit. */
export function readDay(text: string | null, day: string): AccessDay {
  try {
    const data = (text ? JSON.parse(text) : null) as Partial<AccessDay> | null;
    if (data && data.day === day && Array.isArray(data.entries)) return { day, entries: data.entries };
  } catch {
    // fall through: start the day again rather than lose today's visits too
  }
  return { day, entries: [] };
}

/**
 * Adds one entry to its day's file. Returns 'recorded', 'full' (the day already has MAX_ENTRIES_PER_DAY) or 'busy'
 * (other writes won every attempt, which takes a flood of simultaneous visits).
 */
export async function recordAccess(bucket: LogBucket, entry: AccessEntry): Promise<'recorded' | 'full' | 'busy'> {
  const day = dayOf(entry.time);
  const key = dayKey(day);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt) await backoff(attempt);
    const current = await bucket.get(key);
    const log = readDay(current ? await current.text() : null, day);
    if (log.entries.length >= MAX_ENTRIES_PER_DAY) return 'full';
    log.entries.push(entry);
    // Written only if the file is still the one just read; a new day's file only if there still is none.
    const onlyIf = current ? { etagMatches: current.etag } : new Headers({ 'If-None-Match': '*' });
    const written = await bucket.put(key, JSON.stringify(log), { httpMetadata: { contentType: 'application/json' }, onlyIf });
    if (written) return 'recorded';
  }
  return 'busy';
}
