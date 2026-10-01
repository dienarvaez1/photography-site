// Backfills `geo` (city, country, continent, time zone) into access log entries recorded before the site's Worker
// recorded it (src/config/access-log.ts). New entries get it from Cloudflare (request.cf); Cloudflare can't place an
// address after the fact, so these are looked up with ipinfo.io, once per address. Only the addresses are sent there.
// (ipapi.co was the first choice, but refuses lookups without a paid plan.)
import { DAY_KEY, geoFrom, readDay } from '../../src/config/access-log.ts';

export const LOOKUP_URL = (ip) => `https://ipinfo.io/${encodeURIComponent(ip)}/json`;

// ipinfo.io gives no continent without a key, so it comes from the country (ISO 3166 codes, by continent).
const BY_CONTINENT = {
  AF: 'DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW',
  AN: 'AQ BV GS HM TF',
  AS: 'AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE IO CC CX',
  EU: 'AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB',
  NA: 'AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US UM VI',
  OC: 'AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF',
  SA: 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE',
};
export const CONTINENT_OF = Object.fromEntries(Object.entries(BY_CONTINENT).flatMap(([continent, codes]) => codes.split(' ').map((code) => [code, continent])));

/** Addresses no service can place: this computer, private networks, link-local, and the like. */
export function isPrivate(ip) {
  if (!ip || ip === 'unknown') return true;
  if (ip.includes(':')) return /^(::1?|f[cd]|fe[89ab])/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** One address's geo from ipinfo.io, in the log's words (geoFrom), or undefined when it can't be placed. */
export async function lookUp(ip, fetcher = fetch) {
  const response = await fetcher(LOOKUP_URL(ip), { headers: { Accept: 'application/json' } });
  if (response.status === 429) throw new Error('ipinfo.io rate limit reached; try again later');
  if (!response.ok) return undefined;
  const data = await response.json();
  if (data.bogon || data.error) return undefined; // a reserved address, or one ipinfo.io can't place
  return geoFrom({ city: data.city, country: data.country, continent: CONTINENT_OF[data.country], timezone: data.timezone });
}

/**
 * Backfills every day file in the bucket. `bucket` is an R2 binding (get, conditional put, list); `lookup(ip)` places
 * one address. With `dryRun`, nothing is written. Returns per-day counts and how many addresses were looked up; never
 * the addresses themselves.
 */
export async function backfill(bucket, { lookup, dryRun = false, maxAttempts = 8 } = {}) {
  const keys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: 'logs/', cursor });
    keys.push(...page.objects.map((o) => o.key).filter((key) => DAY_KEY.test(key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const places = new Map(); // ip -> geo | undefined, looked up once each
  const placeOf = async (ip) => {
    if (!places.has(ip)) places.set(ip, isPrivate(ip) ? undefined : await lookup(ip));
    return places.get(ip);
  };

  const days = [];
  for (const key of keys.sort()) {
    const day = `${DAY_KEY.exec(key)[1]}T00:00:00.000Z`;
    for (let attempt = 1; ; attempt++) {
      const object = await bucket.get(key);
      if (!object) break;
      const log = readDay(await object.text(), day);
      let added = 0;
      let unplaced = 0;
      for (const entry of log.entries) {
        if (entry.geo) continue;
        const geo = await placeOf(entry.ip);
        if (geo) {
          entry.geo = geo;
          added++;
        } else unplaced++;
      }
      const result = { day, entries: log.entries.length, added, unplaced, written: false };
      if (!added || dryRun) {
        days.push(result);
        break;
      }
      // Written only if nobody added a visit since it was read; otherwise read it again (with that visit) and redo.
      const written = await bucket.put(key, JSON.stringify(log), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: object.etag } });
      if (written) {
        days.push({ ...result, written: true });
        break;
      }
      if (attempt >= maxAttempts) throw new Error(`${key} kept changing while being backfilled; run it again`);
    }
  }
  return { days, lookedUp: [...places.keys()].filter((ip) => !isPrivate(ip)).length, placed: [...places.values()].filter(Boolean).length };
}
