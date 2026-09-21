// Post-deploy smoke check: does the site at `baseUrl` actually work?
//
// It fetches the site the way a visitor would and checks what has gone wrong before:
// contact forms shipped without their keys, broken photo URLs, a blank 404, a wrong
// robots.txt, missing hreflang, missing security headers. Only `baseUrl` and `fetchFn`
// are needed, so tests can run it against a local server and a fake R2.
import { REQUIRED_KEYS } from './build-env.mjs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const R2_PHOTO = /https:\/\/[a-z0-9.-]+\.r2\.dev\/photos\/[0-9a-f]{16}\/[A-Za-z0-9]+\.webp/g;
const SECURITY_HEADERS = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy'];

const join = (base, path) => `${base.replace(/\/$/, '')}${path}`;

async function text(fetchFn, url, init) {
  const response = await fetchFn(url, { redirect: 'follow', ...init });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

/** Page paths listed in the site's own sitemap (host-independent, so a local server works too). */
async function sitemapPaths(base, fetchFn) {
  const index = await text(fetchFn, join(base, '/sitemap-index.xml'));
  if (index.status !== 200) throw new Error(`sitemap-index.xml returned ${index.status}`);
  const files = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const paths = new Set();
  for (const file of files) {
    const sitemap = await text(fetchFn, join(base, file));
    for (const m of sitemap.body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)) paths.add(new URL(m[1]).pathname);
  }
  return [...paths].sort();
}

/**
 * Runs every check and returns { ok, checks: [{ name, ok, detail }] }.
 * `expectedKeys` ({ en, es }) is optional: when given, each contact form must use exactly that key.
 */
export async function runSmoke({ baseUrl, fetchFn = fetch, expectedKeys = {}, log = () => {} }) {
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const guard = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      record(name, false, error.message);
    }
  };

  let paths = [];
  await guard('sitemap lists the pages', async () => {
    paths = await sitemapPaths(baseUrl, fetchFn);
    record('sitemap lists the pages', paths.length >= 10, `${paths.length} pages`);
  });

  // --- every page ---------------------------------------------------------------------
  const pages = new Map();
  await Promise.all(
    paths.map((path) =>
      guard(`GET ${path}`, async () => {
        const page = await text(fetchFn, join(baseUrl, path));
        pages.set(path, page);
      })
    )
  );
  const bad = [];
  for (const [path, page] of pages) {
    const lang = path.startsWith('/es/') || path === '/es/' ? 'es' : 'en';
    const problems = [];
    if (page.status !== 200) problems.push(`status ${page.status}`);
    if (!new RegExp(`<html[^>]*lang="${lang}"`).test(page.body)) problems.push(`html lang is not ${lang}`);
    if (!/<title>[^<]+<\/title>/.test(page.body)) problems.push('no title');
    if (!/rel="canonical"/.test(page.body)) problems.push('no canonical');
    for (const hreflang of ['en', 'es', 'x-default']) {
      if (!new RegExp(`<link rel="alternate" hreflang="${hreflang}"`).test(page.body)) problems.push(`no hreflang ${hreflang}`);
    }
    if (/name="robots" content="noindex"/.test(page.body)) problems.push('page is noindex');
    if (problems.length) bad.push(`${path}: ${problems.join(', ')}`);
  }
  if (pages.size) record('every page loads with lang, title, canonical and hreflang', bad.length === 0, bad.join('; '));

  // --- contact forms ----------------------------------------------------------------
  const keys = {};
  for (const [name, path, locale] of [['English', '/contact/', 'en'], ['Spanish', '/es/contact/', 'es']]) {
    await guard(`${name} contact form`, async () => {
      const page = pages.get(path) ?? (await text(fetchFn, join(baseUrl, path)));
      const hasForm = /id="contact-form"/.test(page.body);
      const notice = /class="notice"/.test(page.body);
      const key = page.body.match(new RegExp(`name="access_key"[^>]*value="(${UUID.source})"`, 'i'))?.[1];
      keys[locale] = key;
      const expected = expectedKeys[locale];
      const problems = [];
      if (!hasForm) problems.push('no form');
      if (notice) problems.push('shows the "not configured" notice');
      if (!key) problems.push('no access key in the form');
      if (expected && key && key !== expected) problems.push('access key is not the configured one');
      if (!/api\.web3forms\.com\/submit/.test(page.body)) problems.push('does not post to Web3Forms');
      record(`${name} contact form has its key`, problems.length === 0, problems.join(', '));
    });
  }
  if (keys.en && keys.es) record('each language uses its own Web3Forms form', keys.en !== keys.es, keys.en === keys.es ? 'both use the same key' : '');

  // --- photos in R2 -------------------------------------------------------------------
  await guard('photos load from R2', async () => {
    const urls = new Set();
    for (const page of pages.values()) for (const url of page.body.match(R2_PHOTO) ?? []) urls.add(url);
    if (urls.size === 0) throw new Error('no R2 photo URLs found on any page');
    const failures = [];
    const queue = [...urls];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const url = queue.pop();
          const response = await fetchFn(url, { method: 'HEAD' });
          if (response.status !== 200) failures.push(`${response.status} ${url}`);
        }
      })
    );
    record(`all ${urls.size} R2 photo URLs load`, failures.length === 0, failures.slice(0, 3).join('; '));
  });

  // --- 404 pages ---------------------------------------------------------------------
  for (const [prefix, lang, marker] of [['', 'en', 'Error 404'], ['/es', 'es', 'Error 404']]) {
    await guard(`unknown ${lang} URL`, async () => {
      const page = await text(fetchFn, join(baseUrl, `${prefix}/no-such-page-${Date.now()}/`));
      const problems = [];
      if (page.status !== 404) problems.push(`status ${page.status}, expected 404`);
      if (!page.body.includes(marker)) problems.push('body is not the 404 page');
      if (!new RegExp(`<html[^>]*lang="${lang}"`).test(page.body)) problems.push(`not in ${lang}`);
      record(`unknown ${lang === 'en' ? 'English' : 'Spanish'} URL gets a real 404 page`, problems.length === 0, problems.join(', '));
    });
  }

  // --- robots.txt & headers -------------------------------------------------------------
  await guard('robots.txt', async () => {
    const robots = await text(fetchFn, join(baseUrl, '/robots.txt'));
    const sitemap = robots.body.match(/^Sitemap:\s*(\S+)/m)?.[1];
    const problems = [];
    if (robots.status !== 200) problems.push(`status ${robots.status}`);
    if (!sitemap) problems.push('no Sitemap line');
    else if (new URL(sitemap).pathname !== '/sitemap-index.xml') problems.push(`sitemap path ${new URL(sitemap).pathname}`);
    else {
      // The advertised sitemap must be on the same host the site is served from.
      const advertised = new URL(sitemap).host;
      const home = await text(fetchFn, join(baseUrl, '/'));
      const canonicalHost = home.body.match(/rel="canonical" href="https?:\/\/([^/"]+)/)?.[1];
      if (canonicalHost && advertised !== canonicalHost) problems.push(`sitemap host ${advertised} differs from the site's ${canonicalHost}`);
    }
    record('robots.txt points at the real sitemap', problems.length === 0, problems.join(', '));
  });

  await guard('security headers', async () => {
    const home = await text(fetchFn, join(baseUrl, '/'));
    const missing = SECURITY_HEADERS.filter((name) => !home.headers.get(name));
    record('security headers are sent (incl. Content-Security-Policy)', missing.length === 0, missing.join(', '));
  });

  return { ok: checks.every((c) => c.ok), checks };
}

export { REQUIRED_KEYS };
