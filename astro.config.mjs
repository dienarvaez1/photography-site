// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://photography-site.diego-narvaez.workers.dev',
  integrations: [sitemap()],
  adapter: cloudflare(),
  vite: {
    build: {
      // Keep the CSS minifier from emitting modern range media-query
      // syntax (e.g. "width<=720px"), which Safari < 16.4 and legacy
      // Edge/IE don't parse at all — that silently drops whole rules
      // (including the mobile nav breakpoint) instead of degrading.
      cssTarget: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    },
  },
});