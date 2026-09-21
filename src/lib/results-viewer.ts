// The Admin page's Test Results viewer. It reads the private results store through the results API
// (workers/results-api): index.json (all runs) and latest.json (the newest one) are the entry points, and
// every run can be opened from the list. Everything from the API is put on the page as text, never as HTML.
import {
  LIST_HASH,
  describeTotals,
  formatDate,
  formatDuration,
  formatMessage,
  groupArtifacts,
  isApiLink,
  listReports,
  parseRoute,
  resolveApiUrl,
  runHash,
  type Route,
  type Totals,
} from './results-view';

const TOKEN_KEY = 'admin-token';

type Failure = { feature?: string; scenario?: string; step?: string; message?: string; name?: string; detail?: string };
type Suite = { scenarios?: number; passed: number; failed: number; skipped?: number; steps?: { total: number }; durationMs?: number; features?: { name: string; scenarios: number; passed: number; failed: number }[]; failures?: Failure[]; slowest?: { feature: string; scenario: string; ms: number }[]; checks?: number; baseUrl?: string };
type Summary = { runId: string; startedAt: string; source: string; commit: string; branch: string; dirty: boolean; node?: string; ok: boolean; totals: Totals; suites: Record<string, Suite> };
type Messages = Record<string, any>;

class ApiError extends Error {
  constructor(readonly kind: 'unauthorized' | 'notConfigured' | 'unreachable' | 'notFound' | 'generic', readonly status = 0) {
    super(kind);
  }
}

// Storage can be blocked (private windows, site settings); the token then just isn't remembered.
const remembered = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (token: string) => {
    try {
      token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // not remembered
    }
  },
};

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function mountResultsViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-results-root]')!;
  const messages: Messages = JSON.parse(container.dataset.messages ?? '{}');
  const locale = container.dataset.locale ?? 'en';
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);
  const m = (path: string, values?: Record<string, string | number>) => formatMessage(path.split('.').reduce<any>((node, key) => node?.[key], messages) ?? path, values);

  let token = remembered.get();
  let generation = 0; // a newer render makes older, slower answers stale

  async function api<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new ApiError('unreachable');
    }
    if (response.status === 401) throw new ApiError('unauthorized', 401);
    if (response.status === 503) throw new ApiError('notConfigured', 503);
    if (response.status === 404) throw new ApiError('notFound', 404);
    if (!response.ok) throw new ApiError('generic', response.status);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('generic', response.status);
    }
  }

  const show = (...nodes: Child[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as Node[]));
    root.removeAttribute('aria-busy');
  };
  const errorBox = (error: unknown) => el('p', { class: 'results-error', text: m(`errors.${error instanceof ApiError ? error.kind : 'generic'}`, { status: error instanceof ApiError ? error.status : 0 }), attrs: { role: 'alert' } });

  // --- Sign in -----------------------------------------------------------------------------------------------

  function renderGate(problem?: unknown) {
    const input = el('input', { attrs: { type: 'password', id: 'results-token', name: 'token', autocomplete: 'off', required: '', spellcheck: 'false' } });
    const submit = el('button', { class: 'results-button primary', text: m('gate.submit'), attrs: { type: 'submit' } });
    const form = el('form', { class: 'results-gate' }, el('p', { text: m('gate.intro') }), el('label', { text: m('gate.label'), attrs: { for: 'results-token' } }), input, submit);
    if (problem) form.append(errorBox(problem));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      token = input.value.trim();
      if (!token) return;
      submit.disabled = true;
      submit.textContent = m('gate.checking');
      remembered.set(token);
      void render();
    });
    show(form);
    if (problem) input.focus();
  }

  function signOut() {
    token = '';
    displayed = null;
    remembered.set('');
    generation++;
    renderGate();
  }

  const toolbar = (...extra: Child[]) =>
    el('div', { class: 'results-toolbar' }, ...extra, el('button', { class: 'results-button', text: m('refresh'), attrs: { type: 'button' } }), el('button', { class: 'results-button', text: m('signOut'), attrs: { type: 'button', 'data-sign-out': '' } }));

  function wireToolbar(bar: HTMLElement) {
    const [refresh, out] = Array.from(bar.querySelectorAll('button'));
    refresh.addEventListener('click', () => void render());
    out.addEventListener('click', signOut);
  }

  // --- Small building blocks --------------------------------------------------------------------------------

  const badge = (ok: boolean) => el('span', { class: `results-badge ${ok ? 'ok' : 'bad'}`, text: m(ok ? 'status.passed' : 'status.failed') });
  const totalsText = (totals: Totals) => describeTotals(totals, { allPassed: m('totals.allPassed', {}), someFailed: m('totals.someFailed', {}) });
  const dl = (rows: [string, Child][]) => el('dl', { class: 'results-meta' }, ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', {}, value)]));
  const sourceLine = (s: { commit: string; branch: string; source: string; dirty: boolean }) => `${s.commit}${s.dirty ? ` (${m('detail.dirty')})` : ''} · ${s.branch} · ${s.source}`;

  // --- The list: latest.json and index.json ---------------------------------------------------------------------

  type IndexEntry = { runId: string; startedAt: string; source: string; commit: string; branch: string; dirty: boolean; ok: boolean; totals: Totals; failures?: { suite: string; name: string }[] };

  function runLink(entry: IndexEntry) {
    const link = el('a', { class: 'results-run', attrs: { href: runHash(entry.runId), 'aria-label': m('runs.open', { id: entry.runId }) } });
    link.append(
      el('span', { class: 'run-when', text: formatDate(entry.startedAt, locale) }),
      badge(entry.ok),
      el('span', { class: 'run-what', text: sourceLine(entry) }),
      el('span', { class: 'run-totals', text: totalsText(entry.totals) })
    );
    return link;
  }

  async function renderList(run: number) {
    const [latest, index] = await Promise.all([api<Summary>('/latest').catch((e) => (e instanceof ApiError && e.kind === 'notFound' ? null : Promise.reject(e))), api<{ runs: IndexEntry[] }>('/index')]);
    if (run !== generation) return;
    const bar = toolbar();
    wireToolbar(bar);
    if (!index.runs.length && !latest) {
      show(bar, el('p', { class: 'results-empty', text: m('empty') }));
      return;
    }
    const nodes: Child[] = [bar];
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
    const bar = toolbar(el('a', { class: 'results-back', text: m('back'), attrs: { href: LIST_HASH } }));
    wireToolbar(bar);
    const heading = el('h3', { class: 'results-run-heading', attrs: { tabindex: '-1' } }, `${formatDate(summary.startedAt, locale)} `, badge(summary.ok));
    show(
      bar,
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
        const bar = toolbar(route.view === 'run' ? el('a', { class: 'results-back', text: m('back'), attrs: { href: LIST_HASH } }) : null);
        wireToolbar(bar);
        show(bar, errorBox(error));
      }
    }
  }

  // Nothing is requested while the tab is hidden. Showing the tab, or moving to another #address inside it
  // (a run, the list, the browser's Back button), shows what the address asks for, unless it is already shown.
  const sync = () => {
    if (!panel.hidden && (token ? displayed !== keyOf(wantedRoute()) : !root.querySelector('form'))) void render();
  };
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  // The tabs' own handlers run first; look afterwards.
  const later = () => setTimeout(sync, 0);
  window.addEventListener('hashchange', later);
  document.getElementById('tab-test-results')?.addEventListener('click', later);
  later(); // once the tabs have applied the address (a link to #tbd must not load results)
}
