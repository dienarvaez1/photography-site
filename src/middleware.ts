// Runs for the pages the Worker renders when they are requested (the home, category and Admin pages). The
// files Cloudflare serves itself (the static pages, pictures and scripts) never come through here, so what
// Cloudflare does for those has to be done here for these:
//
//   - the security headers of `public/_headers` (CSP, HSTS, ...): Cloudflare applies that file to files only
//   - `/work/nature` -> `/work/nature/`: Cloudflare redirects that for files only
//   - the localized 404 page, with a real 404 status, for an address that is no page (`/nothing-here/`)
//   - a plain 500 when a page cannot be rendered (say the photo manifest is missing): it must fail loudly, never
//     as an empty gallery or as a "page not found" (Astro's own error page would fit `[...lang]` and say 404)
import { defineMiddleware } from 'astro:middleware';
import headersText from '../public/_headers?raw';
import { headersFor, parseHeadersFile } from './lib/headers-file';
import { NOT_FOUND_HEADER } from './lib/not-found';

const rules = parseHeadersFile(headersText);

interface Assets {
  fetch(request: Request): Promise<Response>;
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Static pages are built once, at build time: nothing to add.
  if (context.isPrerendered) return next();
  const url = new URL(context.request.url);
  const readsPage = context.request.method === 'GET' || context.request.method === 'HEAD';
  if (readsPage && !url.pathname.endsWith('/') && !url.pathname.split('/').pop()!.includes('.')) {
    return new Response(null, { status: 308, headers: { Location: `${url.pathname}/${url.search}`, ...headersFor(rules, url.pathname) } });
  }

  let response: Response;
  try {
    response = await next();
  } catch (error) {
    console.error(`Rendering ${url.pathname} failed:`, error);
    response = new Response('<!doctype html><meta charset="utf-8"><title>Error</title><h1>Something went wrong</h1><p>Please try again in a moment. · Algo salió mal; inténtalo de nuevo en un momento.</p>', {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  if (response.headers.has(NOT_FOUND_HEADER)) {
    const { env } = await import('cloudflare:workers');
    const assets = (env as { ASSETS?: Assets }).ASSETS;
    const page = url.pathname.startsWith('/es/') || url.pathname === '/es' ? '/es/404.html' : '/404.html';
    const found = await assets?.fetch(new Request(new URL(page, url), { headers: { Accept: 'text/html' } }));
    response = new Response(found?.ok ? found.body : 'Not found', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const merged = new Response(response.body, response);
  for (const [name, value] of Object.entries(headersFor(rules, url.pathname))) merged.headers.set(name, value);
  // Pages change when photos are added: never let a browser or a shared cache keep one.
  if (merged.headers.get('content-type')?.includes('text/html')) merged.headers.set('Cache-Control', 'no-cache');
  return merged;
});
