// The Admin page's Test Results viewer. It reads the private results store through the results API
// (workers/results-api): index.json (all runs) and latest.json (the newest one) are the entry points, and
// every run can be opened from the list. Everything from the API is put on the page as text, never as HTML.
import {
  LIST_HASH,
  describeTotals,
  formatDate,
  formatDuration,
  groupArtifacts,
  isApiLink,
  listReports,
  parseRoute,
  resolveApiUrl,
  runHash,
  type Route,
  type Totals,
} from './results-view';
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, gateForm, messageReader, parseJson, remembered, type Child, type Messages } from './admin-common';

type Failure = { feature?: string; scenario?: string; step?: string; message?: string; name?: string; detail?: string };
type Suite = { scenarios?: number; passed: number; failed: number; skipped?: number; steps?: { total: number }; durationMs?: number; features?: { name: string; scenarios: number; passed: number; failed: number }[]; failures?: Failure[]; slowest?: { feature: string; scenario: string; ms: number }[]; checks?: number; baseUrl?: string };
type Summary = { runId: string; startedAt: string; source: string; commit: string; branch: string; dirty: boolean; node?: string; ok: boolean; totals: Totals; suites: Record<string, Suite> };

export function mountResultsViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-results-root]')!;
  const messages = parseJson<Messages>(container.dataset.messages ?? '{}');
  const locale = container.dataset.locale ?? 'en';
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);
  const m = messageReader(messages);

  let token = remembered.get();
  let generation = 0; // a newer render makes older, slower answers stale

  const api = <T,>(path: string) => apiGet<T>(apiUrl, token, path);

  const show = (...nodes: Child[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as Node[]));
    root.removeAttribute('aria-busy');
  };
  const errorBox = (error: unknown) => el('p', { class: 'results-error', text: errorMessage(m, error), attrs: { role: 'alert' } });

  // --- Sign in -----------------------------------------------------------------------------------------------

  function renderGate(problem?: unknown) {
    const { form, input } = gateForm(m, 'results', (given) => {
      token = given;
      remembered.set(given);
      void render();
    }, problem);
    show(form);
    if (problem) input.focus();
  }

  // Refresh and Sign out are buttons at the top of the page (admin-actions.ts); here only the way back from a run.
  // `data-astro-reload`: this is a same-page hash link, and its render() below is driven entirely
  // by the native `hashchange` event (see the listener near the bottom of this file). Without this
  // attribute, Astro's <ClientRouter/> (astro:transitions) intercepts the click itself and updates
  // the URL via `history.pushState`, which never fires `hashchange` — the link would then visibly
  // update the address bar but never actually navigate back to the list.
  const backBar = () => el('div', { class: 'results-toolbar' }, el('a', { class: 'results-back', text: m('back'), attrs: { href: LIST_HASH, 'data-astro-reload': '' } }));

  // --- Small building blocks --------------------------------------------------------------------------------

  const badge = (ok: boolean) => el('span', { class: `results-badge ${ok ? 'ok' : 'bad'}`, text: m(ok ? 'status.passed' : 'status.failed') });
  const totalsText = (totals: Totals) => describeTotals(totals, { allPassed: m('totals.allPassed', {}), someFailed: m('totals.someFailed', {}) });
  const dl = (rows: [string, Child][]) => el('dl', { class: 'results-meta' }, ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', {}, value)]));
  const sourceLine = (s: { commit: string; branch: string; source: string; dirty: boolean }) => `${s.commit}${s.dirty ? ` (${m('detail.dirty')})` : ''} · ${s.branch} · ${s.source}`;

  // --- The list: latest.json and index.json ---------------------------------------------------------------------

  type IndexEntry = { runId: string; startedAt: string; source: string; commit: string; branch: string; dirty: boolean; ok: boolean; totals: Totals; failures?: { suite: string; name: string }[] };

  function runLink(entry: IndexEntry) {
    // `data-astro-reload`: see the comment on `backBar` above — same reasoning applies here.
    const link = el('a', { class: 'results-run', attrs: { href: runHash(entry.runId), 'aria-label': m('runs.open', { id: entry.runId }), 'data-astro-reload': '' } });
    link.append(
      el('span', { class: 'run-when', text: formatDate(entry.startedAt, locale) }),
      badge(entry.ok),
      el('span', { class: 'run-what', text: sourceLine(entry) }),
      el('span', { class: 'run-totals', text: totalsText(entry.totals) })
    );
    return link;
  }

  async function renderList(run: number) {
    // Re-propagates whatever apiGet rejected with (always an ApiError; see admin-common.ts), not a new reason.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const notFoundIsFine = (e: unknown) => (e instanceof ApiError && e.kind === 'notFound' ? null : Promise.reject(e));
    const [latest, index] = await Promise.all([api<Summary>('/latest').catch(notFoundIsFine), api<{ runs: IndexEntry[] }>('/index')]);
    if (run !== generation) return;
    if (!index.runs.length && !latest) {
      show(el('p', { class: 'results-empty', text: m('empty') }));
      return;
    }
    const nodes: Child[] = [];
    if (latest) {
      nodes.push(
        el('section', { class: 'results-latest', attrs: { 'aria-labelledby': 'results-latest-heading' } },
          el('h3', { text: m('latest.heading'), attrs: { id: 'results-latest-heading' } }),
          runLink({ ...latest, failures: [] }))
      );
    }
    nodes.push(
      el('section', { attrs: { 'aria-labelledby': 'results-runs-heading' } },
        el('h3', { text: m('runs.heading'), attrs: { id: 'results-runs-heading' } }),
        el('p', { class: 'results-count', text: m('runs.count', { count: index.runs.length }) }),
        el('ul', { class: 'results-runs' }, ...index.runs.map((entry) => el('li', {}, runLink(entry)))))
    );
    show(...nodes);
  }

  // --- One run -----------------------------------------------------------------------------------------------------------

  function suiteTable(summary: Summary) {
    const head = ['suite', 'scenarios', 'passed', 'failed', 'skipped', 'steps', 'duration'].map((key) => el('th', { text: m(`suites.${key}`), attrs: { scope: 'col' } }));
    const rows = Object.entries(summary.suites).map(([name, s]) => {
      const smoke = name === 'smoke';
      const cells = [smoke ? s.checks ?? 0 : s.scenarios ?? 0, s.passed, s.failed, smoke ? '–' : s.skipped ?? 0, smoke ? '–' : s.steps?.total ?? 0, smoke ? '–' : formatDuration(s.durationMs ?? NaN)];
      return el('tr', {}, el('th', { text: m(`suites.${name}`), attrs: { scope: 'row' } }), ...cells.map((cell) => el('td', { text: String(cell) })));
    });
    return el('div', { class: 'results-table-wrap' }, el('table', { class: 'results-table' }, el('thead', {}, el('tr', {}, ...head)), el('tbody', {}, ...rows)));
  }

  /** Every feature file of each suite with its counts, folded away until asked for. */
  function featureLists(summary: Summary) {
    const suites = Object.entries(summary.suites).filter(([, s]) => s.features?.length);
    if (!suites.length) return null;
    return el('section', { attrs: { 'aria-labelledby': 'results-features-heading' } },
      el('h3', { text: m('suites.features'), attrs: { id: 'results-features-heading' } }),
      ...suites.map(([suite, s]) =>
        el('details', { class: 'results-features' },
          el('summary', { text: `${m(`suites.${suite}`)} (${s.features!.length})` }),
          el('div', { class: 'results-table-wrap' },
            el('table', { class: 'results-table' },
              el('thead', {}, el('tr', {}, ...['feature', 'scenarios', 'passed', 'failed'].map((key) => el('th', { text: m(key === 'feature' ? 'failures.feature' : `suites.${key}`), attrs: { scope: 'col' } })))),
              el('tbody', {}, ...s.features!.map((f) => el('tr', { class: f.failed ? 'has-failures' : '' }, el('th', { text: f.name, attrs: { scope: 'row' } }), ...[f.scenarios, f.passed, f.failed].map((n) => el('td', { text: String(n) }))))))))));
  }

  function failureList(summary: Summary) {
    const items: Node[] = [];
    for (const [suite, s] of Object.entries(summary.suites)) {
      for (const f of s.failures ?? []) {
        const title = suite === 'smoke' ? f.name ?? '' : f.scenario ?? '';
        const rows: [string, Child][] = [[m('suites.suite'), m(`suites.${suite}`)]];
        if (f.feature) rows.push([m('failures.feature'), f.feature]);
        if (f.step) rows.push([m('failures.step'), f.step]);
        items.push(
          el('li', { class: 'results-failure' },
            el('h4', { text: title }),
            dl(rows),
            (f.message ?? f.detail) ? el('pre', { text: f.message ?? f.detail }) : null)
        );
      }
    }
    return el('section', { attrs: { 'aria-labelledby': 'results-failures-heading' } },
      el('h3', { text: m('failures.heading'), attrs: { id: 'results-failures-heading' } }),
      items.length ? el('ul', { class: 'results-failures' }, ...items) : el('p', { class: 'results-none', text: m('failures.none') }));
  }

  function slowestLists(summary: Summary) {
    const groups = Object.entries(summary.suites).filter(([, s]) => s.slowest?.length);
    if (!groups.length) return null;
    return el('section', { attrs: { 'aria-labelledby': 'results-slowest-heading' } },
      el('h3', { text: m('slowest.heading'), attrs: { id: 'results-slowest-heading' } }),
      ...groups.map(([suite, s]) =>
        el('div', {}, el('h4', { text: m(`suites.${suite}`) }), el('ol', { class: 'results-slowest' }, ...s.slowest!.map((item) => el('li', { text: `${formatDuration(item.ms)} · ${item.scenario}` }))))));
  }

  function externalLink(text: string, href: string, download = false) {
    const link = el('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
    if (download) link.setAttribute('download', '');
    link.append(el('span', { class: 'visually-hidden', text: ` ${m('files.newTab')}` }));
    return link;
  }

  function filesSection(links: Record<string, string>, expiresIn: number) {
    const safe = Object.fromEntries(Object.entries(links).filter(([, link]) => isApiLink(link, apiUrl)));
    const reports = listReports(safe).map((r) => el('li', {}, externalLink(m(r.kind === 'html' ? 'files.openHtml' : 'files.openJson', { suite: m(`suites.${r.suite}`) }), r.link)));
    const artifacts = groupArtifacts(safe).map((a) =>
      el('li', { class: 'results-artifact' },
        el('h4', { text: `${m(`suites.${a.suite}`)} · ${a.slug}` }),
        a.screenshot ? el('a', { attrs: { href: a.screenshot, target: '_blank', rel: 'noopener noreferrer' } }, el('img', { attrs: { src: a.screenshot, alt: m('artifacts.screenshot', { name: a.slug }), loading: 'lazy' } })) : null,
        el('p', {}, a.trace ? externalLink(m('artifacts.trace'), a.trace, true) : null, a.log ? externalLink(m('artifacts.log'), a.log) : null)));
    return [
      el('section', { attrs: { 'aria-labelledby': 'results-files-heading' } },
        el('h3', { text: m('files.heading'), attrs: { id: 'results-files-heading' } }),
        el('ul', { class: 'results-files' }, ...reports),
        el('p', { class: 'results-hint', text: m('files.expiry', { minutes: Math.round(expiresIn / 60) }) })),
      artifacts.length ? el('section', { attrs: { 'aria-labelledby': 'results-evidence-heading' } }, el('h3', { text: m('artifacts.heading'), attrs: { id: 'results-evidence-heading' } }), el('ul', { class: 'results-artifacts' }, ...artifacts)) : null,
    ];
  }

  async function renderRun(run: number, runId: string) {
    const { summary, links, linksExpireInSeconds } = await api<{ summary: Summary; links: Record<string, string>; linksExpireInSeconds: number }>(`/runs/${encodeURIComponent(runId)}`);
    if (run !== generation) return;
    const heading = el('h3', { class: 'results-run-heading', attrs: { tabindex: '-1' } }, `${formatDate(summary.startedAt, locale)} `, badge(summary.ok));
    show(
      backBar(),
      heading,
      el('p', { class: 'results-totals', text: totalsText(summary.totals) }),
      dl([
        [m('detail.runId'), summary.runId],
        [m('detail.started'), formatDate(summary.startedAt, locale)],
        [m('detail.source'), summary.source],
        [m('detail.commit'), `${summary.commit} (${m(summary.dirty ? 'detail.dirty' : 'detail.clean')})`],
        [m('detail.branch'), summary.branch],
        [m('detail.node'), summary.node ?? '–'],
      ]),
      el('section', { attrs: { 'aria-labelledby': 'results-suites-heading' } }, el('h3', { text: m('suites.heading'), attrs: { id: 'results-suites-heading' } }), suiteTable(summary)),
      failureList(summary),
      featureLists(summary),
      slowestLists(summary),
      ...filesSection(links, linksExpireInSeconds)
    );
    heading.focus();
  }

  // --- Deciding what to show ----------------------------------------------------------------------------------------

  let displayed: string | null = null; // which view is on screen: 'list' or 'run:<id>'
  const keyOf = (route: Route) => (route.view === 'run' ? `run:${route.runId}` : 'list');
  const wantedRoute = (): Route => parseRoute(location.hash) ?? { view: 'list' };

  async function render() {
    const route = wantedRoute();
    const run = ++generation;
    if (!token) {
      displayed = null;
      return renderGate();
    }
    displayed = keyOf(route);
    root.setAttribute('aria-busy', 'true');
    show(el('p', { class: 'results-loading', text: m('loading') }));
    try {
      if (route.view === 'run') await renderRun(run, route.runId);
      else await renderList(run);
    } catch (error) {
      if (run !== generation) return;
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'notConfigured')) {
        token = '';
        displayed = null;
        remembered.set('');
        renderGate(error);
      } else {
        show(route.view === 'run' ? backBar() : null, errorBox(error));
      }
    }
  }

  // Nothing is requested while the tab is hidden. Showing the tab, or moving to another #address inside it
  // (a run, the list, the browser's Back button), shows what the address asks for, unless it is already shown.
  const sync = () => {
    if (!panel.hidden && (token ? displayed !== keyOf(wantedRoute()) : !root.querySelector('form'))) void render();
  };
  // A sign-in or sign-out in the other viewer applies here too.
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    displayed = null;
    generation++;
    sync();
  });
  // The page's Refresh button reloads whichever tab is showing.
  window.addEventListener(REFRESH_EVENT, () => {
    if (!panel.hidden && token) void render();
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  // The tabs' own handlers run first; look afterwards.
  const later = () => setTimeout(sync, 0);
  window.addEventListener('hashchange', later);
  document.getElementById('tab-test-results')?.addEventListener('click', later);
  later(); // once the tabs have applied the address (a link to #pics-viewer must not load results)
}
