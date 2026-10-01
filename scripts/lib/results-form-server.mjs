// Puts Remove Results' endpoints (results-form.mjs) into `astro dev`, the same way photo-form-server.mjs does for the
// New Photo form: the build never runs a dev-server hook, so the deployed Admin page finds no endpoint and says that
// removing results works only on the owner's computer.
import { Readable } from 'node:stream';

/** Connect-style middleware: hands the service's addresses to the handler and lets every other request through. */
export async function resultsFormMiddleware(options) {
  const { createResultsFormHandler, RESULTS_FORM_PREFIX } = await import('./results-form.mjs');
  const handle = createResultsFormHandler(options);
  return async (req, res, next) => {
    if (!req.url?.startsWith(RESULTS_FORM_PREFIX)) return next();
    const method = req.method ?? 'GET';
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

/** Astro integration: adds the middleware to the dev server, with the real results bucket behind it. */
export function resultsForm() {
  return {
    name: 'results-form',
    hooks: {
      'astro:server:setup': async ({ server }) => {
        const { createBucketStorage } = await import('./r2-storage.mjs');
        const { RESULTS_BUCKET } = await import('./results.mjs');
        server.middlewares.use(await resultsFormMiddleware({ storage: createBucketStorage(RESULTS_BUCKET), log: (line) => console.error(line) }));
      },
    },
  };
}
