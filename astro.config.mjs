// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';
import { existsSync, renameSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHOTO_ENTRIES_DIR } from './scripts/lib/entries-dir.mjs';
import { buildInfo } from './scripts/lib/build-info.mjs';
import { loadEnv, siteEnv } from './scripts/lib/build-env.mjs';
import { photoForm } from './scripts/lib/photo-form-server.mjs';
import { categoryForm } from './scripts/lib/category-form-server.mjs';
import { resultsForm } from './scripts/lib/results-form-server.mjs';
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

/**
 * The access log's endpoint, POST /api/access (src/endpoints/access.ts): only in the real build and `astro dev`. The
 * tests' snapshot build is all static files and has no Worker to run it (its pages' reports are noted by the browser
 * tests instead), so adding it there would turn that build into a Worker build.
 */
/** @type {import('astro').AstroIntegration} */
const accessLogEndpoint = {
  name: 'access-log-endpoint',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      injectRoute({ pattern: '/api/access', entrypoint: './src/endpoints/access.ts', prerender: false });
    },
  },
};

// The tests build the whole site as static HTML from a sample library (`PHOTOS_SNAPSHOT=1`, see
// src/lib/photo-entries.ts). The real build leaves the pages that show photos to be rendered by the Worker
// when they are requested, from the entries in R2, so a new photo needs no build and no deploy.
const SNAPSHOT = process.env.PHOTOS_SNAPSHOT === '1';
// The dev box or production (SITE_ENV, from the environment or .env; scripts/lib/build-env.mjs siteEnv). On the dev
// box every Admin button shows, even in a production build of the site (the preview); in production, only the ones
// that work there.
const SITE_ENV = siteEnv(loadEnv(fileURLToPath(new URL('.', import.meta.url))), { dev: process.argv.includes('dev') });

// Which code this build is (scripts/lib/build-info.mjs), read once here and stamped into the site as constants — every
// page's footer shows it. Under `astro dev` it is read when the server starts.
const BUILD = buildInfo({ cwd: fileURLToPath(new URL('.', import.meta.url)) });

// Pages rendered on request are not in the sitemap unless listed: the home pages, the "All" gallery
// (work/[category].astro's own pseudo-category, ALL_SLUG) and every real category's page.
const requestPages = SNAPSHOT
  ? []
  : LOCALES.flatMap((locale) => {
      const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
      return [`${prefix}/`, `${prefix}/work/all/`, ...CATEGORIES.map((c) => `${prefix}/work/${c.slug}/`)].map((path) => new URL(path, SITE.url).href);
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
    ...(SNAPSHOT ? [] : [accessLogEndpoint]),
    // The Admin page's New Photo form: dev server only (it needs your Cloudflare login to upload).
    photoForm({ contentDir: fileURLToPath(new URL(`./${PHOTO_ENTRIES_DIR}`, import.meta.url)) }),
    // The Admin page's Category Maintenance tab: dev server only, same reasoning (it needs the local
    // entries mirror to count a category's photos before letting it be removed).
    categoryForm({ contentDir: fileURLToPath(new URL(`./${PHOTO_ENTRIES_DIR}`, import.meta.url)) }),
    // The Test Results tab's Remove Results: dev server only too (it deletes from the private results bucket with
    // your Cloudflare login, and the results API it otherwise reads from is read-only).
    resultsForm(),
  ],
  adapter: cloudflare(),
  // <ClientRouter/> (astro:transitions, in BaseLayout.astro) turns prefetch on by default, which
  // injects its own inline <script type="speculationrules">; the CSP (public/_headers) forbids
  // inline scripts, so the browser blocks it. Not something this redesign asked for anyway.
  prefetch: false,
  vite: {
    // `astro dev` keeps its pre-bundled dependencies in node_modules/.vite; anything else (a build, `astro check`, the
    // tests' builds) gets its own folder. Sharing one let a build re-bundle the dev server's files from under it, and
    // every page then failed (runInRunnerObject: "The file does not exist … in the optimize deps directory"); Run in
    // CI's "local checkout" builds while the dev server runs.
    cacheDir: process.argv.includes('dev') ? 'node_modules/.vite' : 'node_modules/.vite-build',
    define: {
      'import.meta.env.PHOTOS_SNAPSHOT': JSON.stringify(SNAPSHOT),
      // Its own constant, not import.meta.env.SITE_ENV: Astro fills import.meta.env from .env by itself, which would
      // override the value resolved here (a production build on the dev box must stay production when asked to be).
      __SITE_ENV__: JSON.stringify(SITE_ENV),
      'import.meta.env.BUILD_LABEL': JSON.stringify(BUILD.label),
      'import.meta.env.BUILD_COMMIT': JSON.stringify(BUILD.commit),
      'import.meta.env.BUILD_TIME': JSON.stringify(BUILD.builtAt),
    },
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