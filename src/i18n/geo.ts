// Picks a first-visit language from the visitor's location.
//
// Order of precedence (first match wins):
//   1. The visitor's own choice — remembered when they click the language switcher.
//   2. Their country, from Cloudflare's IP geolocation (see LOCALE_COUNTRIES below).
//   3. Only when the country can't be determined: the browser's language settings.
//   4. The default locale (English).
// A known country always wins over the browser language, so a visitor in the USA gets English
// even if their browser is set to Spanish; they can switch, and the switch is remembered.
//
// Browser-only glue lives in runGeoRedirect(); everything else is pure so it
// can be tested in Node. Imports use explicit `.ts` extensions so Node can
// load this file directly (the Cucumber tests do).
import { DEFAULT_LOCALE, LOCALES, type Locale } from './config.ts';

/** localStorage key holding the language the visitor last chose explicitly. */
export const LOCALE_STORAGE_KEY = 'preferred-locale';

/** Cloudflare serves the visitor's IP-derived country here (`loc=MX`) on every Cloudflare-served site. */
export const TRACE_URL = '/cdn-cgi/trace';
export const TRACE_TIMEOUT_MS = 2500;

/**
 * ISO 3166-1 alpha-2 country codes whose visitors default to each non-default
 * locale. Any country not listed gets the default locale (English).
 * To add a language: add its locale to config.ts, then list its countries here.
 */
export const LOCALE_COUNTRIES: Partial<Record<Locale, readonly string[]>> = {
  es: [
    'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GQ', 'GT',
    'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
  ],
};

const COUNTRY_TO_LOCALE = new Map<string, Locale>(
  Object.entries(LOCALE_COUNTRIES).flatMap(([locale, countries]) =>
    (countries ?? []).map((country) => [country, locale as Locale] as const)
  )
);

// Crawlers and preview fetchers keep the URL they asked for (search engines
// use hreflang to pick the right language version instead).
const BOT_PATTERN = /bot|crawl|spider|slurp|preview|lighthouse|headless/i;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The locale for a country code (case-insensitive); the default locale when unmapped or unknown. */
export function localeForCountry(country: string | null | undefined): Locale {
  return COUNTRY_TO_LOCALE.get((country ?? '').trim().toUpperCase()) ?? DEFAULT_LOCALE;
}

/** Extracts the country from a `/cdn-cgi/trace` body; null when absent or not a real country (e.g. "XX" unknown). */
export function parseTraceCountry(trace: string): string | null {
  const match = trace.match(/^loc=([A-Za-z]{2})$/m);
  const country = match?.[1].toUpperCase();
  return country && country !== 'XX' ? country : null;
}

/**
 * The configured locale matching the first of the browser's preferred languages that
 * has one ("es-MX" and "es" both give "es"); null when none does. `languages` comes
 * from `navigator.languages`.
 */
export function localeFromLanguages(languages: readonly string[] | null | undefined): Locale | null {
  for (const language of languages ?? []) {
    const primary = String(language).toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** Applies the precedence rules: explicit choice, known country, browser language, default. */
export function pickLocale({
  stored,
  country,
  languages,
}: {
  stored?: string | null;
  country?: string | null;
  languages?: readonly string[] | null;
}): Locale {
  if (isLocale(stored)) return stored;
  if (country) return localeForCountry(country);
  return localeFromLanguages(languages) ?? DEFAULT_LOCALE;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The locale the visitor explicitly chose before, if any. Never throws (storage can be blocked). */
export function readStoredLocale(storage: StorageLike | null): Locale | null {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remembers an explicit language choice. Never throws. */
export function storeLocale(storage: StorageLike | null, locale: string): void {
  if (!isLocale(locale)) return;
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked (private mode, etc.): the choice just isn't remembered.
  }
}

/** Home path for a locale: "/" for the default locale, "/es/" otherwise. */
function homePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
}

export interface GeoRedirectEnv {
  storage: StorageLike | null;
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;
  location: { pathname: string; search: string; hash: string; replace(url: string): void };
  userAgent: string;
  /** The browser's preferred languages (navigator.languages), used only when the country is unknown. */
  languages?: readonly string[];
  /** Development aid only (the page passes it in dev builds): pretend the visitor is in this country. */
  countryOverride?: string | null;
}

/**
 * Runs on the default-locale home page. Sends first-time visitors to their
 * language's home page and does nothing otherwise. Resolves to the locale it
 * redirected to, or null when it stayed put. Never throws: any failure
 * (blocked storage, offline, no trace endpoint) just leaves the English page.
 */
export async function runGeoRedirect(env: GeoRedirectEnv): Promise<Locale | null> {
  const { location } = env;
  if (location.pathname !== homePath(DEFAULT_LOCALE) || BOT_PATTERN.test(env.userAgent)) return null;

  const stored = readStoredLocale(env.storage);
  let country: string | null = null;
  if (!stored) {
    country = env.countryOverride ? env.countryOverride.toUpperCase() : await fetchCountry(env.fetch);
  }

  const target = pickLocale({ stored, country, languages: env.languages });
  if (target === DEFAULT_LOCALE) return null;

  location.replace(`${homePath(target)}${location.search}${location.hash}`);
  return target;
}

async function fetchCountry(fetchFn: GeoRedirectEnv['fetch']): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);
  try {
    const response = await fetchFn(TRACE_URL, { signal: controller.signal });
    return response.ok ? parseTraceCountry(await response.text()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
