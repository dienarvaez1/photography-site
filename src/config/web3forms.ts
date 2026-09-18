import type { Locale } from '../i18n/config';

// One Web3Forms form (access key) per language, so each language's messages
// land in their own form. Keys are public by design (they ship in the page
// HTML), which is why they can use the PUBLIC_ prefix.
const KEYS: Record<Locale, string | undefined> = {
  en: import.meta.env.PUBLIC_WEB3FORMS_KEY,
  es: import.meta.env.PUBLIC_WEB3FORMS_KEY_ES,
};

const DEFAULT_KEY: string | undefined = import.meta.env.PUBLIC_WEB3FORMS_KEY;

/** The access key for a locale's contact form; falls back to the default-language key if unset. */
export function getWeb3FormsKey(locale: Locale): string | undefined {
  return KEYS[locale]?.trim() || DEFAULT_KEY?.trim() || undefined;
}
