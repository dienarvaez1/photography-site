// Language-independent site facts. Translatable copy (title, tagline,
// description) lives in src/i18n/<locale>.json.
export const SITE = {
  url: 'https://photography-site.diego-narvaez.workers.dev',
  author: 'Diego Narvaez',
  email: 'dienarvaez@gmail.com',
  // Where the business is based, for structured data (already public on the About page).
  address: { locality: 'Portland', region: 'OR', country: 'US' },
  social: {
    instagram: '',
    facebook: '',
  },
} as const;
