// Pure helpers for the Admin page's Test Results viewer (no DOM, so they can be tested in Node).

/** The tab the viewer lives in; its hash is `#test-results` (the list) or `#test-results/run/<run id>`. */
export const RESULTS_TAB = 'test-results';
export const LIST_HASH = `#${RESULTS_TAB}`;

export type Route = { view: 'list' } | { view: 'run'; runId: string };

/** Run ids look like 2026-09-21T04-54-28Z-e786ff8-dirty-local; anything else is not a run. */
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export const runHash = (runId: string) => `${LIST_HASH}/run/${runId}`;

/** Where the URL hash points inside the Test Results tab (null when it points somewhere else). */
export function parseRoute(hash: string): Route | null {
  const [tab, kind, runId, ...extra] = hash.replace(/^#/, '').split('/');
  if (tab !== RESULTS_TAB) return null;
  if (kind === undefined) return { view: 'list' };
  let id: string;
  try {
    id = decodeURIComponent(runId ?? '');
  } catch {
    return { view: 'list' };
  }
  return kind === 'run' && !extra.length && RUN_ID.test(id) ? { view: 'run', runId: id } : { view: 'list' };
}

/** Fills {name} placeholders. */
export function formatMessage(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 60 ? `${minutes + 1} min 0 s` : `${minutes} min ${seconds} s`;
}

/** A moment in UTC, in the page's language: "Sep 21, 2026, 4:54 AM UTC". */
export function formatDate(iso: string | null | undefined, locale: string): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(date);
}

export type Totals = { scenarios: number; passed: number; failed: number; skipped: number };

/** "525 of 525 passed", or "3 of 10 passed, 2 failed, 5 skipped" — built from message templates. */
export function describeTotals(totals: Totals, messages: { allPassed: string; someFailed: string }): string {
  const values = { passed: totals.passed, scenarios: totals.scenarios, failed: totals.failed, skipped: totals.skipped };
  return formatMessage(totals.failed || totals.passed !== totals.scenarios ? messages.someFailed : messages.allPassed, values);
}

/** The API's own address, or (only when the page itself is on localhost) an `?api=` override for local work. */
export function resolveApiUrl(configured: string, search: string, hostname: string): string {
  const override = new URLSearchParams(search).get('api');
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  if (local && override) {
    try {
      const url = new URL(override);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    } catch {
      // fall through to the configured address
    }
  }
  return configured.replace(/\/+$/, '');
}

/** Only links that lead back to the API itself are ever followed. */
export function isApiLink(link: string, apiUrl: string): boolean {
  try {
    const url = new URL(link);
    return url.origin === new URL(apiUrl).origin && url.pathname.startsWith('/files/');
  } catch {
    return false;
  }
}

export type Artifact = { suite: string; slug: string; screenshot?: string; trace?: string; log?: string };

/** Failure evidence saved beside a run (artifacts/<suite>/<name>.png|zip|txt), one entry per failed scenario. */
export function groupArtifacts(links: Record<string, string>): Artifact[] {
  const groups = new Map<string, Artifact>();
  for (const [path, link] of Object.entries(links)) {
    const match = /^artifacts\/([^/]+)\/(.+)\.(png|zip|txt)$/.exec(path);
    if (!match) continue;
    const [, suite, slug, extension] = match;
    const group = groups.get(`${suite}/${slug}`) ?? { suite, slug };
    group[{ png: 'screenshot', zip: 'trace', txt: 'log' }[extension as 'png' | 'zip' | 'txt'] as 'screenshot' | 'trace' | 'log'] = link;
    groups.set(`${suite}/${slug}`, group);
  }
  return [...groups.values()].sort((a, b) => `${a.suite}/${a.slug}`.localeCompare(`${b.suite}/${b.slug}`));
}

export type Report = { path: string; name: string; suite: string; kind: 'html' | 'json'; link: string };

/** The full reports of each suite (HTML to read, JSON to process). */
export function listReports(links: Record<string, string>): Report[] {
  const order = ['offline', 'browser', 'smoke'];
  return Object.entries(links)
    .flatMap(([path, link]) => {
      const match = /^(offline|browser|smoke)\.(html|json)$/.exec(path);
      return match ? [{ path, name: path, suite: match[1], kind: match[2] as 'html' | 'json', link }] : [];
    })
    .sort((a, b) => order.indexOf(a.suite) - order.indexOf(b.suite) || (a.kind === 'html' ? -1 : 1));
}
