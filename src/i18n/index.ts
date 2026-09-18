import { CATEGORIES, VISIBLE_CATEGORIES } from '../config/categories';
import { DEFAULT_LOCALE, LOCALES, LOCALE_INFO, type Locale } from './config';
import en from './en.json';
import es from './es.json';

export { DEFAULT_LOCALE, LOCALES, LOCALE_INFO, type Locale };

type Messages = typeof en;

// `es` must have exactly the shape of `en`, so a missing or misspelled key
// in either file fails type-checking (`astro check`), not just at runtime.
const messages: Record<Locale, Messages> = { en, es };

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends readonly unknown[] ? never : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<Messages>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The locale a page is being rendered for, from Astro's i18n routing. */
export function getLocale(astro: { currentLocale?: string }): Locale {
  return isLocale(astro.currentLocale) ? astro.currentLocale : DEFAULT_LOCALE;
}

/** All message groups for a locale — use for list-valued messages (e.g. paragraphs). */
export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

function lookup(source: unknown, key: string): string | undefined {
  let value: unknown = source;
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Returns a translate function for a locale. `{name}` placeholders are filled
 * from `vars`. A key missing from the locale falls back to the default
 * locale so an unfinished translation never renders a blank.
 */
export function useTranslations(locale: Locale) {
  return function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
    const template = lookup(messages[locale], key) ?? lookup(messages[DEFAULT_LOCALE], key) ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match
    );
  };
}

// --- URLs ---------------------------------------------------------------

/** Splits a pathname like `/es/about/` into its locale and locale-less path (`/about/`). */
export function splitLocalePath(pathname: string): { locale: Locale; path: string } {
  const [, first, ...rest] = pathname.split('/');
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    return { locale: first, path: `/${rest.join('/')}` };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}

/** Prefixes a locale-less path (`/about/`) for a locale. English stays unprefixed. */
export function localizePath(path: string, locale: Locale): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return locale === DEFAULT_LOCALE ? normalized : `/${locale}${normalized}`;
}

export interface Alternate {
  locale: Locale;
  path: string;
  current: boolean;
}

/** The equivalent of the page at `pathname` in every locale (including its own). */
export function getAlternates(pathname: string): Alternate[] {
  const { locale: current, path } = splitLocalePath(pathname);
  return LOCALES.map((locale) => ({
    locale,
    path: localizePath(path, locale),
    current: locale === current,
  }));
}

/** `getStaticPaths` entries for a `[...lang]` route: English (no param) plus every other locale. */
export function localeStaticParams() {
  return LOCALES.map((locale) => ({ params: { lang: locale === DEFAULT_LOCALE ? undefined : locale } }));
}

// --- Categories & photos ------------------------------------------------

export interface LocalizedCategory {
  slug: string;
  label: string;
  description: string;
  hidden: boolean;
}

function localizeCategory(slug: string, hidden: boolean, locale: Locale): LocalizedCategory {
  const text = messages[locale].categories as Record<string, { label: string; description: string }>;
  const fallback = messages[DEFAULT_LOCALE].categories as Record<string, { label: string; description: string }>;
  const { label, description } = text[slug] ?? fallback[slug];
  return { slug, label, description, hidden };
}

export function getLocalizedCategory(slug: string, locale: Locale): LocalizedCategory | undefined {
  const category = CATEGORIES.find((c) => c.slug === slug);
  return category && localizeCategory(category.slug, Boolean(category.hidden), locale);
}

export function getLocalizedCategories(locale: Locale): LocalizedCategory[] {
  return CATEGORIES.map((c) => localizeCategory(c.slug, Boolean(c.hidden), locale));
}

/** Visible categories with translated text, sorted alphabetically in the locale's own collation. */
export function getSortedVisibleCategories(locale: Locale): LocalizedCategory[] {
  return VISIBLE_CATEGORIES.map((c) => localizeCategory(c.slug, false, locale)).sort((a, b) =>
    a.label.localeCompare(b.label, locale)
  );
}

/** A photo's title in the given locale, falling back to its default `title`. */
export function getPhotoTitle(data: { title: string; titles?: Record<string, string> }, locale: Locale): string {
  return data.titles?.[locale] ?? data.title;
}
