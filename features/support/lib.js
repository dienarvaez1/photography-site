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
  'category',
  'image',
  'camera',
  'copyright',
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
 * Load every photo content entry: its frontmatter, the folder it lives in
 * (which the collection loader treats as informational only — `category`
 * in frontmatter is the actual source of truth), and whether its declared
 * image resolves to a real file on disk.
 */
export function loadContentEntries() {
  return findMarkdownFiles(CONTENT_DIR).map((filePath) => {
    const raw = readFileSync(filePath, 'utf-8');
    const { data: frontmatter } = matter(raw);
    const dir = dirname(filePath);
    const imagePath = frontmatter.image ? join(dir, frontmatter.image) : null;
    return {
      filePath,
      relPath: relative(ROOT, filePath),
      dir,
      frontmatter,
      imagePath,
      imageExists: imagePath ? existsSync(imagePath) : false,
    };
  });
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
 * Reads PUBLIC_WEB3FORMS_KEY straight out of .env, the same way Vite reads
 * it to inline `import.meta.env.PUBLIC_WEB3FORMS_KEY` at build time. This
 * only reflects the local build environment — it says nothing about what a
 * separate CI/deploy pipeline (e.g. a Git-connected Cloudflare build) has
 * configured, since that's a dashboard setting this repo can't see.
 */
export function readWeb3FormsKeyFromEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, 'utf-8').match(/^PUBLIC_WEB3FORMS_KEY=(.*)$/m);
  return match?.[1]?.trim() || undefined;
}

/** Every *.css file emitted by the build, plus inline <style> blocks in every built page — used for CSS-syntax regression checks. */
export function allBuiltCss() {
  const chunks = [];
  const astroDir = join(DIST_DIR, '_astro');
  if (existsSync(astroDir)) {
    for (const entry of readdirSync(astroDir)) {
      if (entry.endsWith('.css')) {
        chunks.push({ source: `_astro/${entry}`, css: readFileSync(join(astroDir, entry), 'utf-8') });
      }
    }
  }
  for (const routePath of listBuiltRoutes()) {
    const { html } = readBuiltPage(routePath);
    const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
    for (const [, css] of styleMatches) {
      chunks.push({ source: `${routePath} inline <style>`, css });
    }
  }
  return chunks;
}

/** Every route this site is expected to build, derived from the pages directory + dynamic category routes. */
export function listBuiltRoutes() {
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
