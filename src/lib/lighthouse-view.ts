// Pure helpers for the Admin page's Lighthouse Test Results viewer (no DOM, so they can be tested in Node).

/** The tab the viewer lives in; its hash is `#lighthouse-results` (the list) or `#lighthouse-results/run/<run id>`. */
export const LIGHTHOUSE_TAB = 'lighthouse-results';
export const LIGHTHOUSE_LIST_HASH = `#${LIGHTHOUSE_TAB}`;

export type LighthouseRoute = { view: 'list' } | { view: 'run'; runId: string };

/** Run ids look like 2026-09-29T18-49-00Z-6959246-local; anything else is not a run. */
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export const lighthouseRunHash = (runId: string) => `${LIGHTHOUSE_LIST_HASH}/run/${runId}`;

/** Where the URL hash points inside the Lighthouse tab (null when it points somewhere else). */
export function parseLighthouseRoute(hash: string): LighthouseRoute | null {
  const [tab, kind, runId, ...extra] = hash.replace(/^#/, '').split('/');
  if (tab !== LIGHTHOUSE_TAB) return null;
  if (kind === undefined) return { view: 'list' };
  let id: string;
  try {
    id = decodeURIComponent(runId ?? '');
  } catch {
    return { view: 'list' };
  }
  return kind === 'run' && !extra.length && RUN_ID.test(id) ? { view: 'run', runId: id } : { view: 'list' };
}

/** Only links that lead back to the API's own Lighthouse files are ever followed. */
export function isLighthouseLink(link: string, apiUrl: string): boolean {
  try {
    const url = new URL(link);
    return url.origin === new URL(apiUrl).origin && url.pathname.startsWith('/lighthouse/files/');
  } catch {
    return false;
  }
}

/** Lighthouse's own colour bands for a 0–100 score: 90–100 good, 50–89 needs work, 0–49 poor. */
export function scoreBand(score: number): 'good' | 'average' | 'poor' {
  return score >= 90 ? 'good' : score >= 50 ? 'average' : 'poor';
}

export const METRIC_IDS = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'] as const;
export type MetricId = (typeof METRIC_IDS)[number];
export const SCORE_IDS = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type ScoreId = (typeof SCORE_IDS)[number];

/** A timing as people read it: "2.4 s" for paints, "40 ms" for blocking time, "0.013" for layout shift. */
export function formatMetric(id: MetricId, value: number, locale: string): string {
  if (!Number.isFinite(value)) return '–';
  if (id === 'cumulative-layout-shift') return new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
  if (id === 'total-blocking-time') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ms`;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1000)} s`;
}

/** A download size in kilobytes: "585 KB". */
export const formatKilobytes = (bytes: number, locale: string) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;

export type Measurement = { path: string; device: string; report: string; scores: Record<ScoreId, number>; metrics: Record<MetricId, number>; bytes: number; errors: number; ok: boolean; misses: string[] };

/** Each distinct problem once, with every page and device it happened on, in the order first seen. */
export function groupMisses(results: Measurement[]): { miss: string; where: Measurement[] }[] {
  const groups = new Map<string, Measurement[]>();
  for (const r of results) for (const miss of r.misses) groups.set(miss, [...(groups.get(miss) ?? []), r]);
  return [...groups].map(([miss, where]) => ({ miss, where }));
}
