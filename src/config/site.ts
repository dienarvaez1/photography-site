// Language-independent site facts. Translatable copy (title, tagline,
// description) lives in src/i18n/<locale>.json.
export const SITE = {
  url: 'https://diego-narvaez-photography.org',
  author: 'Diego Narvaez',
  email: 'admin@diego-narvaez-photography.org',
  // Where the business is based, for structured data (already public on the About page).
  address: { locality: 'Portland', region: 'OR', country: 'US' },
  social: {
    instagram: '',
    facebook: '',
  },
} as const;
