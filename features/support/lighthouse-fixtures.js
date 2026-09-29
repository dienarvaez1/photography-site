// Made-up Lighthouse measurements, for testing what is built from them (the index page, summary.json, publishing)
// without running Lighthouse or touching the network.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgetFor, checkBudget } from './lighthouse.js';
import { renderIndex, summarizeRun } from './lighthouse-index.js';

/** A Lighthouse result with just the fields the index page reads; everything not given is comfortably good. */
export function fakeLhr({ performance, lcp }) {
  const category = (title, score) => ({ title, score });
  const audit = (numericValue) => ({ numericValue });
  return {
    categories: { performance: category('Performance', performance), accessibility: category('Accessibility', 1), 'best-practices': category('Best Practices', 1), seo: category('SEO', 1) },
    audits: {
      'first-contentful-paint': audit(900), 'largest-contentful-paint': audit(lcp), 'total-blocking-time': audit(10),
      'cumulative-layout-shift': audit(0), 'total-byte-weight': audit(400 * 1024), 'errors-in-console': { details: { items: [] } },
    },
  };
}

export const slug = (path) => path.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';

/** One measured page, as the Lighthouse suite records it. */
export function fakeResult(path, device, { performance, lcp }) {
  return { path, device, report: `${device}-${slug(path)}.html`, lhr: fakeLhr({ performance, lcp }) };
}

/** The results with their budget checks, as the suite hands them to the index page and summary. */
export const checked = (results) => results.map((r) => ({ ...r, misses: checkBudget(r.lhr, r.path, r.device), budget: budgetFor(r.path, r.device) }));

/**
 * Writes the folder a Lighthouse run leaves behind (test-results/lighthouse/): each page's report, the index page and
 * summary.json. Returns the summary.
 */
export function writeRunFolder(dir, results, { baseUrl = 'https://example.org', runs = 3, generatedAt = new Date('2026-09-29T12:00:00Z') } = {}) {
  mkdirSync(dir, { recursive: true });
  const run = { baseUrl, runs, generatedAt, results: checked(results) };
  for (const r of results) writeFileSync(join(dir, r.report), `<!doctype html><title>${r.device} ${r.path}</title>`);
  writeFileSync(join(dir, 'index.html'), renderIndex(run));
  const summary = summarizeRun(run);
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary));
  return summary;
}
