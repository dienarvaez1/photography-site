// Puts the page editor's endpoints (page-text-form.mjs) into `astro dev`, the twin of category-form-server.mjs. Nothing
// here is part of the built site: the deployed pages find no endpoint and never show the editor at all.
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { NOT_DEV_BOX, loadEnv, writesAllowed } from './build-env.mjs';

/** Connect-style middleware: hands the editor's addresses to the handler and lets every other request through. */
export async function pageTextMiddleware(options = {}) {
  // Decided once, when the dev server starts: `allowWrites` (tests) or SITE_ENV from the environment or .env.
  const allowWrites = options.allowWrites ?? writesAllowed(loadEnv(fileURLToPath(new URL('../..', import.meta.url))));
  const { createPageTextHandler, PAGE_TEXT_PREFIX } = await import('./page-text-form.mjs');
  const handle = createPageTextHandler(options);
  return async (req, res, next) => {
    if (!req.url?.startsWith(PAGE_TEXT_PREFIX)) return next();
    const method = req.method ?? 'GET';
    // Reading is always fine; writing the site's files only on the dev box (SITE_ENV; scripts/lib/build-env.mjs).
    if (method !== 'GET' && method !== 'HEAD' && !allowWrites) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return void res.end(JSON.stringify(NOT_DEV_BOX));
    }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method,
      headers: req.headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
    });
    const response = await handle(request);
    if (!response) return next();
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

/** Astro integration: adds the middleware to the dev server. */
export function pageTextForm() {
  return {
    name: 'page-text-form',
    hooks: {
      'astro:server:setup': async ({ server }) => {
        server.middlewares.use(await pageTextMiddleware({ log: (line) => console.error(line) }));
      },
    },
  };
}
