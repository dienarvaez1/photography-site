import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { DIST_DIR } from './lib.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

/** Parses Cloudflare's `_headers` file: a path pattern line, then indented "Name: value" lines. */
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), headers: {} };
      rules.push(current);
    } else if (current) {
      const [name, ...value] = line.trim().split(':');
      current.headers[name.trim()] = value.join(':').trim();
    }
  }
  return rules;
}

/**
 * Serves the built site (dist/client) the way Cloudflare's asset hosting does: `_headers` applied,
 * /dir redirected to /dir/, and for an unknown URL the nearest 404.html with a real 404 status.
 * Options simulate a bad deploy: `transform(path, body, contentType)` may rewrite a text response,
 * `blank404` answers unknown URLs with an empty 404 (what the site did before it had a 404 page),
 * and `stripHeaders` drops response headers by name.
 */
export async function startStaticServer({ root = DIST_DIR, transform, blank404 = false, stripHeaders = [] } = {}) {
  const headerRules = existsSync(join(root, '_headers')) ? parseHeadersFile(readFileSync(join(root, '_headers'), 'utf-8')) : [];
  const requests = [];

  const fileFor = (pathname) => {
    const safe = normalize(decodeURIComponent(pathname)).split(sep).join('/');
    const candidates = safe.endsWith('/') ? [`${safe}index.html`] : [safe];
    for (const candidate of candidates) {
      const full = join(root, candidate);
      if (full.startsWith(root) && existsSync(full) && statSync(full).isFile()) return { full, status: 200 };
    }
    if (!safe.endsWith('/') && existsSync(join(root, safe, 'index.html'))) return { redirect: `${safe}/` };
    // Nearest 404.html, walking up from the requested directory.
    const parts = safe.split('/').filter(Boolean);
    for (let depth = parts.length; depth >= 0; depth--) {
      const candidate = join(root, ...parts.slice(0, depth), '404.html');
      if (existsSync(candidate)) return { full: candidate, status: 404 };
    }
    return { none: true };
  };

  // A scenario can mount an extra handler (the New Photo form's service, which `astro dev` adds to the dev server).
  let mounted = null;
  const PREFIX = '/__photos/';

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname + url.search);
    if (mounted && url.pathname.startsWith(PREFIX)) return mounted(req, res, () => respond(req, res, url));
    respond(req, res, url);
  });

  function respond(req, res, url) {
    const found = fileFor(url.pathname);
    if (found.redirect) {
      res.writeHead(308, { Location: found.redirect + url.search });
      return res.end();
    }
    if (found.none || (blank404 && found.status === 404)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end();
    }
    const headers = { 'Content-Type': TYPES[extname(found.full)] ?? 'application/octet-stream' };
    for (const rule of headerRules) if (rule.pattern.test(url.pathname)) Object.assign(headers, rule.headers);
    let body = readFileSync(found.full);
    for (const name of stripHeaders) delete headers[Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase())];
    if (transform && /^text\/|xml/.test(headers['Content-Type'])) {
      const changed = transform(url.pathname, body.toString('utf-8'), headers['Content-Type']);
      if (changed !== undefined) body = Buffer.from(changed);
    }
    res.writeHead(found.status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Handles the requests under /__photos/ with `handler(req, res, next)`; `next` answers as an ordinary unknown address. */
    mount: (handler) => {
      mounted = handler;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
