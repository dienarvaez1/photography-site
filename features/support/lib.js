import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { parse } from 'node-html-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');
export const CONTENT_DIR = join(ROOT, 'src/content/photos');
export const DIST_DIR = join(ROOT, 'dist/client');

const ALLOWED_FRONTMATTER_FIELDS = new Set([
  'title',
  'titles',
  'category',
  'photo',
  'camera',
  'featured',
  'order',
]);

/** Recursively find every *.md file under a directory. */
function findMarkdownFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Load every photo content entry: its frontmatter and the folder it lives in
 * (which the collection loader treats as informational only — `category`
 * in frontmatter is the actual source of truth). The photo itself is not on
 * disk: `frontmatter.photo` is a content id pointing at objects in R2.
 */
export function loadContentEntries() {
  return findMarkdownFiles(CONTENT_DIR).map((filePath) => {
    const raw = readFileSync(filePath, 'utf-8');
    const { data: frontmatter } = matter(raw);
    return {
      filePath,
      relPath: relative(ROOT, filePath),
      dir: dirname(filePath),
      frontmatter,
    };
  });
}

/** Image files that must live in R2, not in the repo: any image under src/, and photo formats under public/ (logos are PNG/SVG). */
export function listPhotoFilesInRepo() {
  const found = [];
  const walk = (dir, pattern) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, pattern);
      else if (pattern.test(entry)) found.push(relative(ROOT, full));
    }
  };
  walk(join(ROOT, 'src'), /\.(jpe?g|png|webp|avif|gif|tiff?|heic)$/i);
  walk(join(ROOT, 'public'), /\.(jpe?g|webp|avif|tiff?|heic)$/i);
  return found;
}

/** Every .astro/.ts source file under src/ with its text — for "the code must not do X" checks. */
export function listSourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(astro|ts)$/.test(entry)) files.push({ path: relative(ROOT, full), text: readFileSync(full, 'utf-8') });
    }
  };
  walk(join(ROOT, 'src'));
  return files;
}

export function allowedFrontmatterFields() {
  return ALLOWED_FRONTMATTER_FIELDS;
}

/** Category folders that exist under src/content/photos (excluding "images"). */
export function contentCategoryFolders() {
  return readdirSync(CONTENT_DIR).filter((name) => {
    const full = join(CONTENT_DIR, name);
    return statSync(full).isDirectory();
  });
}

export async function loadCategoriesConfig() {
  const mod = await import(join(ROOT, 'src/config/categories.ts'));
  return mod;
}

/** Locales configured for the site (src/i18n/config.ts), default locale first. */
export async function loadLocaleConfig() {
  return import(join(ROOT, 'src/i18n/config.ts'));
}

/** The raw translation messages for a locale (src/i18n/<locale>.json). */
export function loadMessages(locale) {
  return JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${locale}.json`), 'utf-8'));
}

/** Built-page route for a locale-less route, e.g. ("/about/", "es") -> "/es/about/". */
export function localizedRoute(route, locale, defaultLocale = 'en') {
  return locale === defaultLocale ? route : `/${locale}${route}`;
}

/** Read a built static page from dist/client and parse it as HTML. Throws with a clear message if the site hasn't been built. */
export function readBuiltPage(routePath) {
  const normalized = routePath === '/' ? '/index.html' : `${routePath.replace(/\/$/, '')}/index.html`;
  const filePath = join(DIST_DIR, normalized);
  if (!existsSync(filePath)) {
    throw new Error(
      `Built page not found: ${filePath}. Run "npm run build" before the test suite (the BeforeAll hook should have done this).`
    );
  }
  const html = readFileSync(filePath, 'utf-8');
  return { html, root: parse(html) };
}

export function distExists() {
  return existsSync(DIST_DIR);
}

/**
 * Reads a PUBLIC_* variable the way Vite resolves it at build time: the
 * process environment first, then the .env file. This only reflects the
 * local build environment — it says nothing about what a separate CI/deploy
 * pipeline (e.g. a Git-connected Cloudflare build) has configured, since
 * that's a dashboard setting this repo can't see.
 */
export function readEnvVar(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, 'utf-8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1]?.trim() || undefined;
}

/** Env var holding a locale's Web3Forms key: PUBLIC_WEB3FORMS_KEY for the default locale, PUBLIC_WEB3FORMS_KEY_<LOCALE> otherwise. */
export function web3formsEnvName(locale, defaultLocale = 'en') {
  return locale === defaultLocale ? 'PUBLIC_WEB3FORMS_KEY' : `PUBLIC_WEB3FORMS_KEY_${locale.toUpperCase()}`;
}

/** The explicitly configured Web3Forms key for a locale (no fallback to the default locale's key). */
export function readWeb3FormsKeyFromEnv(locale = 'en') {
  return readEnvVar(web3formsEnvName(locale));
}

/** The key a locale's built contact page should actually use: its own, else the default locale's (mirrors src/config/web3forms.ts). */
export function effectiveWeb3FormsKey(locale = 'en') {
  return readWeb3FormsKeyFromEnv(locale) ?? readWeb3FormsKeyFromEnv('en');
}

/** Every *.css file emitted by the build, plus inline <style> blocks in every built page — used for CSS-syntax regression checks. */
export async function allBuiltCss() {
  const chunks = [];
  const astroDir = join(DIST_DIR, '_astro');
  if (existsSync(astroDir)) {
    for (const entry of readdirSync(astroDir)) {
      if (entry.endsWith('.css')) {
        chunks.push({ source: `_astro/${entry}`, css: readFileSync(join(astroDir, entry), 'utf-8') });
      }
    }
  }
  for (const routePath of await listBuiltRoutes()) {
    const { html } = readBuiltPage(routePath);
    const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
    for (const [, css] of styleMatches) {
      chunks.push({ source: `${routePath} inline <style>`, css });
    }
  }
  return chunks;
}

/** Every locale-less route this site is expected to build, derived from the pages directory + dynamic category routes. */
export function listBaseRoutes() {
  return [
    '/',
    '/about/',
    '/contact/',
    '/work/astro/',
    '/work/events/',
    '/work/landscape/',
    '/work/nature/',
    '/work/pets/',
    '/work/portrait/',
    '/work/real-estate/',
  ];
}

/** Every route the site builds, in every locale. */
export async function listBuiltRoutes() {
  const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
  return LOCALES.flatMap((locale) =>
    listBaseRoutes().map((route) => localizedRoute(route, locale, DEFAULT_LOCALE))
  );
}

/** The locale a built page declares via <html lang>. */
export function pageLocale(page) {
  return page.root.querySelector('html')?.getAttribute('lang') ?? null;
}

/** Every built page, in every locale, as { route, locale, page } — for "every page" scenarios. */
export async function readAllBuiltPages() {
  const routes = await listBuiltRoutes();
  return routes.map((route) => {
    const page = readBuiltPage(route);
    return { route, locale: pageLocale(page), page };
  });
}

/** Routes of every index.html actually present in the build output (e.g. "/es/about/"). */
export function listDistRoutes() {
  const routes = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === 'index.html') {
        const rel = relative(DIST_DIR, dir).split('\\').join('/');
        routes.push(rel ? `/${rel}/` : '/');
      }
    }
  };
  walk(DIST_DIR);
  return routes.sort();
}
