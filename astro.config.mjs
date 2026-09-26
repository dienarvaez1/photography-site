// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';
import { existsSync, renameSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHOTO_ENTRIES_DIR } from './scripts/lib/entries-dir.mjs';
import { photoForm } from './scripts/lib/photo-form-server.mjs';
import { CATEGORIES } from './src/config/categories.ts';
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

// The tests build the whole site as static HTML from a sample library (`PHOTOS_SNAPSHOT=1`, see
// src/lib/photo-entries.ts). The real build leaves the pages that show photos to be rendered by the Worker
// when they are requested, from the entries in R2, so a new photo needs no build and no deploy.
const SNAPSHOT = process.env.PHOTOS_SNAPSHOT === '1';

// Pages rendered on request are not in the sitemap unless listed: the home pages and every category's page.
const requestPages = SNAPSHOT
  ? []
  : LOCALES.flatMap((locale) => {
      const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
      return [`${prefix}/`, ...CATEGORIES.map((c) => `${prefix}/work/${c.slug}/`)].map((path) => new URL(path, SITE.url).href);
    });

// https://astro.build/config
export default defineConfig({
  site: SITE.url,
  // Pages are rendered when requested unless they say `export const prerender = true` (about, contact, the error
  // pages). The snapshot build is the opposite: every page static.
  output: SNAPSHOT ? 'static' : 'server',
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
      customPages: requestPages,
      i18n: {
        defaultLocale: DEFAULT_LOCALE,
        locales: Object.fromEntries(LOCALES.map((locale) => [locale, locale])),
      },
    }),
    localizedNotFoundPages,
    // The Admin page's New Photo form: dev server only (it needs your Cloudflare login to upload).
    photoForm({ contentDir: fileURLToPath(new URL(`./${PHOTO_ENTRIES_DIR}`, import.meta.url)) }),
  ],
  adapter: cloudflare(),
  // <ClientRouter/> (astro:transitions, in BaseLayout.astro) turns prefetch on by default, which
  // injects its own inline <script type="speculationrules">; the CSP (public/_headers) forbids
  // inline scripts, so the browser blocks it. Not something this redesign asked for anyway.
  prefetch: false,
  vite: {
    define: { 'import.meta.env.PHOTOS_SNAPSHOT': JSON.stringify(SNAPSHOT) },
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