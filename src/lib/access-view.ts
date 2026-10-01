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

/** `2026-10-01T00:00:00.000Z` → `2026-10-01`, for the day picker. */
export const dayLabel = (day: string) => day.slice(0, 10);

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
