// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';
import { existsSync, renameSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { photoForm } from './scripts/lib/photo-form-server.mjs';
import { SITE } from './src/config/site.ts';
import { DEFAULT_LOCALE, LOCALES } from './src/i18n/config.ts';

/**
 * Cloudflare serves the nearest `404.html` for an unknown URL. Astro builds the default
 * language's page as /404.html but other languages as /es/404/index.html, so move each
 * to /es/404.html; a mistyped Spanish URL then gets the Spanish error page (with a real 404
 * status), and /es/404/ itself is not left behind as an "error page" that answers 200.
 */
/** @type {import('astro').AstroIntegration} */
const localizedNotFoundPages = {
  name: 'localized-404-pages',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const root = fileURLToPath(dir);
      for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
        const built = `${root}${locale}/404/index.html`;
        if (!existsSync(built)) continue;
        renameSync(built, `${root}${locale}/404.html`);
        rmdirSync(`${root}${locale}/404`);
      }
    },
  },
};

// https://astro.build/config
export default defineConfig({
  site: SITE.url,
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    locales: [...LOCALES],
    // English lives at the root (/about/); other locales are prefixed (/es/about/).
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    // Adds <xhtml:link rel="alternate" hreflang> entries for each page's translations.
    sitemap({
      // Error pages and the admin page (noindex) don't belong in the sitemap.
      filter: (page) => !/\/(404|admin)\/?$/.test(page),
      i18n: {
        defaultLocale: DEFAULT_LOCALE,
        locales: Object.fromEntries(LOCALES.map((locale) => [locale, locale])),
      },
    }),
    localizedNotFoundPages,
    // The Admin page's New Photo form: dev server only (it needs your Cloudflare login and writes into src/content).
    photoForm({ contentDir: fileURLToPath(new URL('./src/content/photos', import.meta.url)) }),
  ],
  adapter: cloudflare(),
  vite: {
    build: {
      // Never inline scripts into the HTML, so the Content-Security-Policy (public/_headers) can
      // say `script-src 'self'` without 'unsafe-inline'.
      assetsInlineLimit: 0,
      // Keep the CSS minifier from emitting modern range media-query
      // syntax (e.g. "width<=720px"), which Safari < 16.4 and legacy
      // Edge/IE don't parse at all — that silently drops whole rules
      // (including the mobile nav breakpoint) instead of degrading.
      cssTarget: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    },
  },
});