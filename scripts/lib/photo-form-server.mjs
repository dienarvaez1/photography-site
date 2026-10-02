// Puts the New Photo form's endpoints (photo-form.mjs) into `astro dev`. Nothing here is part of the built
// site: the build never runs a dev-server hook, so the deployed Admin page finds no endpoint and says the
// form works only on the owner's computer. The photo code (sharp, wrangler) is imported only when the dev
// server starts, so `astro build` never loads it.
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { NOT_DEV_BOX, loadEnv, writesAllowed } from './build-env.mjs';

/** Connect-style middleware: hands the form's addresses to the handler and lets every other request through. */
export async function photoFormMiddleware(options) {
  // Decided once, when the dev server starts: `allowWrites` (tests) or SITE_ENV from the environment or .env.
  const allowWrites = options.allowWrites ?? writesAllowed(loadEnv(fileURLToPath(new URL('../..', import.meta.url))));
  const { createPhotoFormHandler, PHOTO_FORM_PREFIX } = await import('./photo-form.mjs');
  const handle = createPhotoFormHandler(options);
  return async (req, res, next) => {
    if (!req.url?.startsWith(PHOTO_FORM_PREFIX)) return next();
    const method = req.method ?? 'GET';
    // Reading is always fine; writing (R2, the site's files) only on the dev box (SITE_ENV; scripts/lib/build-env.mjs).
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

/** Astro integration: adds the middleware to the dev server, with the real R2 behind it. */
export function photoForm({ contentDir }) {
  return {
    name: 'photo-form',
    hooks: {
      'astro:server:setup': async ({ server }) => {
        const { createR2Storage } = await import('./r2-storage.mjs');
        server.middlewares.use(await photoFormMiddleware({ contentDir, storage: createR2Storage(), sync: true, log: (line) => console.error(line) }));
      },
    },
  };
}
