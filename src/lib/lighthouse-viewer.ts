// The Admin page's Lighthouse Test Results viewer. It reads the Lighthouse runs (lighthouse-results/ in the private test
// bucket) through the results API, behind the same admin token as the other tabs: index (all runs) and latest (the
// newest) are the entry points, and every run can be opened from the list. Built like the Test Results viewer
// (results-viewer.ts); everything from the API is put on the page as text, never as HTML.
import { formatDate, resolveApiUrl } from './results-view';
import {
  LIGHTHOUSE_LIST_HASH,
  METRIC_IDS,
  SCORE_IDS,
  formatKilobytes,
  formatMetric,
  groupMisses,
  isLighthouseLink,
  lighthouseRunHash,
  parseLighthouseRoute,
  scoreBand,
  type LighthouseRoute,
  type Measurement,
} from './lighthouse-view';
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, messageReader, parseJson, remembered, type Child, type Messages, type Notice, leaveToGate, noticeNode } from './admin-common';

type Totals = { measurements: number; withinBudget: number; overBudget: number };
type Summary = { runId: string; startedAt: string; source: string; target?: string; commit: string; branch: string; dirty: boolean; baseUrl: string; runsPerPage: number; ok: boolean; totals: Totals; results: Measurement[] };
type IndexEntry = { runId: string; startedAt: string; source: string; target?: string; commit: string; branch: string; dirty: boolean; baseUrl: string; ok: boolean; totals: Totals; performance?: Record<string, number> };

export function mountLighthouseViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-lighthouse-root]')!;
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

  // Signing in is the page's own token box (admin-gate.ts); without a token this tab shows nothing.
  const renderGate = (problem?: unknown) => leaveToGate(root, problem);

  // `data-astro-reload`: a same-page hash link driven by `hashchange` (see the same note in results-viewer.ts).
  const backBar = () => el('div', { class: 'results-toolbar' }, el('a', { class: 'results-back', text: m('lighthouse.back'), attrs: { href: LIGHTHOUSE_LIST_HASH, 'data-astro-reload': '' } }));

  // --- Small building blocks ------------------------------------------------------------------------------------

  const badge = (ok: boolean) => el('span', { class: `results-badge ${ok ? 'ok' : 'bad'}`, text: m(ok ? 'lighthouse.status.pass' : 'lighthouse.status.fail') });
  const totalsText = (t: Totals) => m('lighthouse.totals', { within: t.withinBudget, total: t.measurements });
  const device = (id: string) => m(`lighthouse.devices.${id}`) || id;
  // Where it was started from and, when the run says, which host it measured: "localhost:4321 → diego-narvaez-photography.org".
  const sourceLine = (s: { commit: string; branch: string; source: string; target?: string; dirty: boolean }) => `${s.commit}${s.dirty ? ` (${m('lighthouse.detail.dirty')})` : ''} · ${s.branch} · ${s.source}${s.target ? ` → ${s.target}` : ''}`;
  const dl = (rows: [string, Child][]) => el('dl', { class: 'results-meta' }, ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', {}, value)]));

  function externalLink(text: string, href: string) {
    const link = el('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
    link.append(el('span', { class: 'visually-hidden', text: ` ${m('lighthouse.files.newTab')}` }));
    return link;
  }

  // --- The list: latest and index --------------------------------------------------------------------------------

  function performanceText(entry: IndexEntry) {
    const perf = entry.performance ?? {};
    return m('lighthouse.performance', { mobile: perf.mobile ?? '–', desktop: perf.desktop ?? '–' });
  }

  function runLink(entry: IndexEntry) {
    const link = el('a', { class: 'results-run lighthouse-run', attrs: { href: lighthouseRunHash(entry.runId), 'aria-label': m('lighthouse.runs.open', { id: entry.runId }), 'data-astro-reload': '' } });
    link.append(
      el('span', { class: 'run-when', text: formatDate(entry.startedAt, locale) }),
      badge(entry.ok),
      el('span', { class: 'run-what', text: sourceLine(entry) }),
      el('span', { class: 'run-totals', text: `${totalsText(entry.totals)} · ${performanceText(entry)}` })
    );
    return link;
  }

  /** The latest run's summary has every measurement, not the index's median per device; this gives it the same shape. */
  function asEntry(summary: Summary): IndexEntry {
    const median = (device: string) => {
      const scores = summary.results.filter((r) => r.device === device).map((r) => r.scores.performance).sort((a, b) => a - b);
      return scores.length ? scores[Math.floor((scores.length - 1) / 2)] : undefined;
    };
    const performance: Record<string, number> = {};
    for (const d of ['mobile', 'desktop']) {
      const value = median(d);
      if (value !== undefined) performance[d] = value;
    }
    return { ...summary, performance };
  }

  // Remove Results and Run in Production (results-remove.ts, loaded when either button is first pressed; Remove
  // Results is the same as the Test Results tab's, Run in Production works like its Run in CI). The list is kept, so
  // ticking a checkbox draws it again without asking the API; `notice` is what the last removal or measurement said.
  let removal: import('./results-remove').RunRemoval | null = null;
  let notice: Notice | null = null;
  let listed: { latest: Summary | null; runs: IndexEntry[] } | null = null;
  let measuring = false; // a Run in Production run is under way (a branch was chosen): its button waits
  const removalModule = () => import('./results-remove');

  async function startRemoving() {
    const { startRunRemoval } = await removalModule();
    const started = await startRunRemoval({
      m,
      store: 'lighthouse',
      root,
      redraw: drawList,
      done: (said) => {
        notice = said;
        removal = null;
        displayed = null;
        void render();
      },
    });
    if ('text' in started) notice = started;
    else [removal, notice] = [started, null];
    drawList();
    root.querySelector<HTMLButtonElement>('[data-remove-bar] button:not(:disabled)')?.focus();
  }

  /**
   * After a measurement: asks the results API (the host this tab reads from) for the run it published until it answers
   * with it. Resolves to 'confirmed', 'timeout' when it never did within CONFIRM_TIMEOUT_MS, or the API's refusal.
   * "Not found" (not there yet) and "unreachable" (a blip) are waited out.
   */
  async function confirmRun(runId: string, pollMs: number, timeoutMs: number): Promise<'confirmed' | 'timeout' | ApiError> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await api(`/lighthouse/runs/${encodeURIComponent(runId)}`);
        return 'confirmed';
      } catch (error) {
        if (!(error instanceof ApiError)) return new ApiError('generic');
        if (error.kind !== 'notFound' && error.kind !== 'unreachable') return error;
      }
      if (Date.now() + pollMs > deadline) return 'timeout';
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /**
   * Run in Production: ask which branch (main unless another is chosen), start the Lighthouse workflow there on GitHub,
   * follow it until GitHub says it completed, then wait for the results API to have the run it published, and show it.
   * The button waits the whole time, from the moment a branch is chosen.
   */
  async function runInProduction() {
    const { runWorkflowAndFollow, lighthouseRunNotice, LIGHTHOUSE_KIND, CONFIRM_POLL_MS, CONFIRM_TIMEOUT_MS } = await removalModule();
    const update = (said: Notice) => {
      notice = said;
      if (!panel.hidden) drawList();
    };
    const ended = await runWorkflowAndFollow<import('./results-remove').LighthouseRun>(m, LIGHTHOUSE_KIND, (run) => lighthouseRunNotice(m, run), update, () => {
      measuring = true;
      drawList();
    });
    const { run } = ended;
    if (!run) {
      [notice, measuring] = [ended.notice ?? notice, false];
      drawList();
      if (!ended.started) root.querySelector<HTMLButtonElement>('[data-action="run-lighthouse-production"]')?.focus();
      return;
    }
    const link = run.url ? { href: run.url, linkText: m('lighthouse.production.open') } : {};
    if (run.runId) {
      // Published: not done until the results API serves the run (only then can the list below show it).
      update({ text: m('lighthouse.production.confirming', { runId: run.runId }), alert: false, ...link });
      const confirmed = await confirmRun(run.runId, CONFIRM_POLL_MS, CONFIRM_TIMEOUT_MS);
      notice =
        confirmed === 'confirmed' ? lighthouseRunNotice(m, run)
        : confirmed === 'timeout' ? { text: m('lighthouse.production.unconfirmed', { runId: run.runId, minutes: Math.round(CONFIRM_TIMEOUT_MS / 60_000) }), alert: true, ...link }
        : { text: errorMessage(m, confirmed), alert: true };
    } else {
      // Nothing published: how it ended says why. A run that ended well without naming its run can't be confirmed.
      notice = run.conclusion === 'success' ? { text: m('lighthouse.production.noRunId'), alert: true, ...link } : lighthouseRunNotice(m, run);
    }
    measuring = false;
    displayed = null; // the new run is in the store now: read the list again
    if (!panel.hidden) void render();
  }

  /** The buttons above the list: Remove Results (only when there is something to remove), then Run in Production. */
  function toolbar(hasRuns: boolean) {
    const run = el('button', { class: 'results-button', text: m(measuring ? 'lighthouse.production.running' : 'lighthouse.production.button'), attrs: { type: 'button', 'data-action': 'run-lighthouse-production' } });
    run.disabled = measuring;
    run.addEventListener('click', () => void runInProduction());
    // Always there, so it can be found; unavailable while there is nothing to remove.
    const remove = el('button', { class: 'results-button', text: m('removal.lighthouse'), attrs: { type: 'button', 'data-action': 'remove-results', ...(hasRuns ? {} : { title: m('removal.nothing') }) } });
    remove.disabled = !hasRuns;
    remove.addEventListener('click', () => void startRemoving());
    return el('div', { class: 'results-toolbar results-remove-toolbar' }, remove, run);
  }

  async function renderList(run: number) {
    // Re-propagates whatever apiGet rejected with (always an ApiError; see admin-common.ts), not a new reason.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const notFoundIsFine = (e: unknown) => (e instanceof ApiError && e.kind === 'notFound' ? null : Promise.reject(e));
    const [latest, index] = await Promise.all([api<Summary>('/lighthouse/latest').catch(notFoundIsFine), api<{ runs: IndexEntry[] }>('/lighthouse/index')]);
    if (run !== generation) return;
    listed = { latest, runs: index.runs };
    drawList();
  }

  /** Draws the list from the last answer: the buttons (or Remove Results' bar and checkboxes), the latest run, all runs. */
  function drawList() {
    if (!listed) return;
    const { latest, runs } = listed;
    const choosing = removal?.active ? removal : null;
    const nodes: Child[] = [];
    if (notice) nodes.push(noticeNode(notice));
    if (!runs.length && !latest) {
      show(...nodes, toolbar(false), el('p', { class: 'results-empty', text: m('lighthouse.empty') }));
      return;
    }
    if (choosing) {
      nodes.push(choosing.bar(runs.map((entry) => ({ runId: entry.runId, label: `${formatDate(entry.startedAt, locale)} · ${entry.commit} · ${totalsText(entry.totals)} (${entry.runId})` }))));
    } else {
      nodes.push(toolbar(runs.length > 0));
    }
    if (latest) {
      nodes.push(
        el('section', { class: 'results-latest', attrs: { 'aria-labelledby': 'lighthouse-latest-heading' } },
          el('h3', { text: m('lighthouse.latest.heading'), attrs: { id: 'lighthouse-latest-heading' } }),
          runLink(asEntry(latest)))
      );
    }
    nodes.push(
      el('section', { attrs: { 'aria-labelledby': 'lighthouse-runs-heading' } },
        el('h3', { text: m('lighthouse.runs.heading'), attrs: { id: 'lighthouse-runs-heading' } }),
        el('p', { class: 'results-count', text: m('lighthouse.runs.count', { count: runs.length }) }),
        el('ul', { class: `results-runs${choosing ? ' choosing' : ''}` }, ...runs.map((entry) => el('li', {}, choosing?.check(entry.runId), runLink(entry)))))
    );
    show(...nodes);
  }

  // --- One run -------------------------------------------------------------------------------------------------------

  function resultsTable(summary: Summary, links: Record<string, string>) {
    const heads = ['page', 'device', ...SCORE_IDS, ...METRIC_IDS, 'size', 'errors', 'budget', 'report'].map((key) =>
      el('th', { text: m(`lighthouse.table.${key}`), attrs: { scope: 'col' } }));
    const rows = summary.results.map((r) => {
      const scoreCells = SCORE_IDS.map((id) => el('td', { class: 'num' }, el('span', { class: `lh-score ${scoreBand(r.scores[id])}`, text: String(r.scores[id]) })));
      const metricCells = METRIC_IDS.map((id) => el('td', { class: 'num', text: formatMetric(id, r.metrics[id], locale) }));
      const report = links[r.report];
      return el('tr', { class: r.ok ? '' : 'has-failures' },
        el('th', { text: r.path, attrs: { scope: 'row' } }),
        el('td', { text: device(r.device) }),
        ...scoreCells,
        ...metricCells,
        el('td', { class: 'num', text: formatKilobytes(r.bytes, locale) }),
        el('td', { class: `num${r.errors ? ' lh-bad' : ''}`, text: String(r.errors) }),
        el('td', {}, badge(r.ok)),
        el('td', {}, report ? externalLink(m('lighthouse.table.openReport'), report) : '–'));
    });
    return el('section', { attrs: { 'aria-labelledby': 'lighthouse-table-heading' } },
      el('h3', { text: m('lighthouse.table.heading'), attrs: { id: 'lighthouse-table-heading' } }),
      el('div', { class: 'results-table-wrap' }, el('table', { class: 'results-table lighthouse-table' }, el('thead', {}, el('tr', {}, ...heads)), el('tbody', {}, ...rows))));
  }

  function missedList(summary: Summary) {
    const groups = groupMisses(summary.results);
    const where = (list: Measurement[]) =>
      list.length === summary.results.length && list.length > 1
        ? m('lighthouse.missed.everywhere', { count: list.length })
        : list.map((r) => `${r.path} · ${device(r.device)}`).join(', ');
    return el('section', { attrs: { 'aria-labelledby': 'lighthouse-missed-heading' } },
      el('h3', { text: m('lighthouse.missed.heading'), attrs: { id: 'lighthouse-missed-heading' } }),
      groups.length
        ? el('ul', { class: 'results-failures' }, ...groups.map((g) => el('li', { class: 'results-failure' }, el('h4', { text: g.miss }), el('p', { class: 'results-hint', text: where(g.where) }))))
        : el('p', { class: 'results-none', text: m('lighthouse.missed.none') }));
  }

  function filesSection(links: Record<string, string>, expiresIn: number) {
    const items = [
      links['index.html'] ? el('li', {}, externalLink(m('lighthouse.files.index'), links['index.html'])) : null,
      links['summary.json'] ? el('li', {}, externalLink(m('lighthouse.files.summary'), links['summary.json'])) : null,
    ];
    return el('section', { attrs: { 'aria-labelledby': 'lighthouse-files-heading' } },
      el('h3', { text: m('lighthouse.files.heading'), attrs: { id: 'lighthouse-files-heading' } }),
      el('ul', { class: 'results-files' }, ...items),
      el('p', { class: 'results-hint', text: m('lighthouse.files.expiry', { minutes: Math.round(expiresIn / 60) }) }));
  }

  async function renderRun(run: number, runId: string) {
    const answer = await api<{ summary: Summary; links: Record<string, string>; linksExpireInSeconds: number }>(`/lighthouse/runs/${encodeURIComponent(runId)}`);
    if (run !== generation) return;
    const { summary, linksExpireInSeconds } = answer;
    const links = Object.fromEntries(Object.entries(answer.links).filter(([, link]) => isLighthouseLink(link, apiUrl)));
    const heading = el('h3', { class: 'results-run-heading', attrs: { tabindex: '-1' } }, `${formatDate(summary.startedAt, locale)} `, badge(summary.ok));
    show(
      backBar(),
      heading,
      el('p', { class: 'results-totals', text: totalsText(summary.totals) }),
      dl([
        [m('lighthouse.detail.runId'), summary.runId],
        [m('lighthouse.detail.measured'), formatDate(summary.startedAt, locale)],
        [m('lighthouse.detail.site'), summary.baseUrl],
        [m('lighthouse.detail.runs'), m('lighthouse.detail.runsValue', { count: summary.runsPerPage })],
        [m('lighthouse.detail.commit'), `${summary.commit} (${m(summary.dirty ? 'lighthouse.detail.dirty' : 'lighthouse.detail.clean')})`],
        [m('lighthouse.detail.branch'), summary.branch],
        [m('lighthouse.detail.source'), summary.source],
        [m('lighthouse.detail.target'), summary.target ?? '–'],
      ]),
      resultsTable(summary, links),
      missedList(summary),
      filesSection(links, linksExpireInSeconds)
    );
    heading.focus();
  }

  // --- Deciding what to show ------------------------------------------------------------------------------------------

  let displayed: string | null = null; // which view is on screen: 'list' or 'run:<id>'
  const keyOf = (route: LighthouseRoute) => (route.view === 'run' ? `run:${route.runId}` : 'list');
  const wantedRoute = (): LighthouseRoute => parseLighthouseRoute(location.hash) ?? { view: 'list' };

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

  // Nothing is requested while the tab is hidden; showing it, or moving to another #address inside it, shows what the
  // address asks for, unless it is already shown.
  const sync = () => {
    if (!panel.hidden && (token ? displayed !== keyOf(wantedRoute()) : !root.querySelector('form'))) void render();
  };
  // A sign-in or sign-out in another tab of the page applies here too.
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    displayed = null;
    generation++;
    sync();
  });
  window.addEventListener(REFRESH_EVENT, () => {
    if (!panel.hidden && token) void render();
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  const later = () => setTimeout(sync, 0);
  window.addEventListener('hashchange', later);
  document.getElementById('tab-lighthouse-results')?.addEventListener('click', later);
  later();
}
