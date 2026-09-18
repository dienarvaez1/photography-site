// Plain module (no Astro-only imports) so astro.config.mjs can share it.
export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en', 'es'] as const;

export type Locale = (typeof LOCALES)[number];

// Language names are shown in their own language (a visitor who can't read
// the current page still needs to recognise their language), so they are
// not part of the translatable message files.
export const LOCALE_INFO: Record<Locale, { name: string; short: string; ogLocale: string }> = {
  en: { name: 'English', short: 'EN', ogLocale: 'en_US' },
  es: { name: 'Español', short: 'ES', ogLocale: 'es_ES' },
};
