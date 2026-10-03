// The Access Info tab's logic, apart from the page: what a day's entries add up to. Plain functions, so the tests can
// check them without a browser (access-info.feature).
import type { AccessEntry } from '../config/access-log';

export type Count<T> = { key: T; count: number };

export interface AccessSummary {
  views: number;
  photos: number;
  /** Different addresses that day. */
  visitors: number;
  /** Pages by visits, most visited first (ties by path). */
  pages: Count<string>[];
  /** Photos by times opened, most opened first (ties by id). */
  topPhotos: Count<string>[];
}

function ranked<T extends string>(counts: Map<T, number>, limit: number): Count<T>[] {
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function summarize(entries: AccessEntry[], limit = 10): AccessSummary {
  const pages = new Map<string, number>();
  const photos = new Map<string, number>();
  const visitors = new Set<string>();
  let views = 0;
  let opened = 0;
  for (const entry of entries) {
    visitors.add(entry.ip);
    if (entry.event === 'photo' && entry.photo) {
      opened++;
      photos.set(entry.photo.id, (photos.get(entry.photo.id) ?? 0) + 1);
    } else if (entry.event === 'view') {
      views++;
      pages.set(entry.page, (pages.get(entry.page) ?? 0) + 1);
    }
  }
  return { views, photos: opened, visitors: visitors.size, pages: ranked(pages, limit), topPhotos: ranked(photos, limit) };
}

/** How many groups a pie names; the rest share one "Other" slice, so a pie never has more than six. */
export const PIE_NAMED = 5;

export type Slice = { key: string; count: number; share: number } | { other: true; groups: number; count: number; share: number };

/**
 * A pie's slices from a complete ranking (most first): the first PIE_NAMED (five) groups by name, then one "Other" slice for
 * everything after them. Shares are fractions of the whole (0–1). Fewer than two groups make no pie: one full circle
 * says nothing the number above it doesn't.
 */
export function pieSlices(ranking: Count<string>[], named = PIE_NAMED): Slice[] {
  const total = ranking.reduce((sum, { count }) => sum + count, 0);
  if (ranking.length < 2 || !total) return [];
  const slices: Slice[] = ranking.slice(0, named).map(({ key, count }) => ({ key, count, share: count / total }));
  const rest = ranking.slice(named);
  if (rest.length) {
    const count = rest.reduce((sum, group) => sum + group.count, 0);
    slices.push({ other: true, groups: rest.length, count, share: count / total });
  }
  return slices;
}

/** A country's share of the day: its page visits and photos opened, and its cities by both together, most first. */
export type CountryCount = { country: string; views: number; photos: number; total: number; cities: Count<string>[] };

/**
 * The day by country (`geo.country`), most first (ties by name); entries without a country are counted apart, as
 * `unplaced`, so the map's totals still add up.
 */
export function byCountry(entries: AccessEntry[]): { countries: CountryCount[]; unplaced: number } {
  const counts = new Map<string, CountryCount>();
  const cities = new Map<string, Map<string, number>>();
  let unplaced = 0;
  for (const entry of entries) {
    const country = entry.geo?.country;
    if (!country) {
      unplaced++;
      continue;
    }
    const count = counts.get(country) ?? { country, views: 0, photos: 0, total: 0, cities: [] };
    if (entry.event === 'photo') count.photos++;
    else count.views++;
    count.total++;
    counts.set(country, count);
    const city = entry.geo?.city;
    if (city) {
      const inCountry = cities.get(country) ?? new Map<string, number>();
      inCountry.set(city, (inCountry.get(city) ?? 0) + 1);
      cities.set(country, inCountry);
    }
  }
  for (const count of counts.values()) count.cities = ranked(cities.get(count.country) ?? new Map<string, number>(), Infinity);
  const countries = [...counts.values()].sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));
  return { countries, unplaced };
}

export type IpCount = { ip: string; views: number; photos: number; total: number; city?: string; country?: string };

/**
 * The day by visitor address (`ip`), most visits first (ties by address), each with its page visits and photos opened,
 * and where its latest entry placed it (`geo`; an address may move between lookups, the newest wins).
 */
export function byIp(entries: AccessEntry[]): IpCount[] {
  const counts = new Map<string, IpCount & { latest: string }>();
  for (const entry of entries) {
    if (!entry.ip) continue;
    const count = counts.get(entry.ip) ?? { ip: entry.ip, views: 0, photos: 0, total: 0, latest: '' };
    if (entry.event === 'photo') count.photos++;
    else count.views++;
    count.total++;
    if (entry.geo && entry.time >= count.latest) Object.assign(count, { latest: entry.time, city: entry.geo.city, country: entry.geo.country });
    counts.set(entry.ip, count);
  }
  return [...counts.values()]
    .map(({ latest: _latest, ...count }) => count)
    .sort((a, b) => b.total - a.total || a.ip.localeCompare(b.ip));
}

/**
 * The map's color bands for a day whose busiest country has `max` visits: up to five, from 1 to `max`, each band's upper
 * bound growing geometrically (so a few busy countries don't wash every other one into the first band). Returns each
 * band's [from, to], lowest first; a band is never empty and never repeats a bound.
 */
export function bands(max: number, count = 5): [number, number][] {
  if (max < 1) return [];
  const uppers: number[] = [];
  for (let i = 1; i <= count; i++) {
    const upper = i === count ? max : Math.max(1, Math.round(max ** (i / count)));
    if (!uppers.length || upper > uppers[uppers.length - 1]) uppers.push(upper);
  }
  return uppers.map((to, i) => [i ? uppers[i - 1] + 1 : 1, to]);
}

/** Which band (0-based) a count falls in, or -1 for none (0 visits). */
export const bandOf = (n: number, ranges: [number, number][]) => (n < 1 ? -1 : ranges.findIndex(([, to]) => n <= to));

// --- The calendar's days (day-range-calendar.ts) -------------------------------------------------------------------------
// UTC days, like the access log's files ("2026-10-01").

/** The longest range one choice may span: a year (the Current Year preset), each day read a few at a time. */
export const MAX_RANGE_DAYS = 366;

export type DayRange = { from: string; to: string };

const DAY_MS = 86_400_000;
export const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const toDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => toDay(new Date(toDate(day).getTime() + n * DAY_MS));

/** Today's UTC day ("2026-10-02"). */
export const todayUtc = () => toDay(new Date());

/** Every day from `from` to `to`, both included. */
export function daysBetween({ from, to }: DayRange): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The range two clicks make: in order, and no longer than MAX_RANGE_DAYS (the end moves in to fit). */
export function rangeOf(a: string, b: string): DayRange {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const longest = addDays(from, MAX_RANGE_DAYS - 1);
  return { from, to: to > longest ? longest : to };
}

/** The calendar's ready-made ranges, by name. */
export const PRESETS = ['today', 'lastWeek', 'currentWeek', 'lastMonth', 'currentMonth', 'currentYear'] as const;
export type Preset = (typeof PRESETS)[number];

/**
 * A ready-made range for `today` (a UTC day). Weeks start on Monday, as the calendar's do. The current ones end today;
 * the last ones are whole (last week Monday to Sunday, last month its first to its last day).
 */
export function presetRange(preset: Preset, today: string): DayRange {
  const monday = addDays(today, -((toDate(today).getUTCDay() + 6) % 7));
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'currentWeek':
      return { from: monday, to: today };
    case 'lastWeek':
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'currentMonth':
      return { from: firstOfMonth, to: today };
    case 'lastMonth': {
      const lastDay = addDays(firstOfMonth, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    case 'currentYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

// --- Long lists, 50 at a time ----------------------------------------------------------------------------------------------

/** How many rows a long list (the IP addresses, the countries) shows at once. */
export const PAGE_SIZE = 50;

/** Page `page` (from 0) of `total` rows: the slice to show, 1-based for the "1–50 of 230" line, and whether there's more. */
export function pageOf(total: number, page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  const start = at * size;
  const end = Math.min(total, start + size);
  return { page: at, pages, start, end, first: total ? start + 1 : 0, last: end, hasPrevious: at > 0, hasNext: at < pages - 1 };
}
