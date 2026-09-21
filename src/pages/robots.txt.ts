import type { APIRoute } from 'astro';
import { SITE } from '../config/site';

export const prerender = true;

// Generated from SITE.url so the sitemap address always matches the real domain.
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', SITE.url)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
