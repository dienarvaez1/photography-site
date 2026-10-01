// The Admin page's Access Info viewer: who opened which page and which photo, one UTC day at a time, read from the
// site's access log (src/config/access-log.ts) through the results API, behind the same admin token as the other tabs.
// Built like the GitHub Issues viewer (issues-viewer.ts); everything from the API is put on the page as text.
import type { AccessDay, AccessEntry } from '../config/access-log';
import { byCountry, dayLabel, pieSlices, summarize, type Count, type CountryCount } from './access-view';
import { pieChart } from './pie-chart';
import { worldMapChart } from './world-map';
import { resolveApiUrl } from './results-view';
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, messageReader, parseJson, remembered, type Child, type Messages, leaveToGate } from './admin-common';

type DayInfo = { day: string; size: number; updatedAt: string | null };
type DayList = { days: DayInfo[]; complete: boolean };
type KnownPhoto = { title: string; category: string };

export function mountAccessViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-access-root]')!;
  const messages = parseJson<Messages>(container.dataset.messages ?? '{}');
  // The photos the site shows, by id: the Pics Viewer's data on the same page, so the page carries it only once.
  const photos = parseJson<Record<string, KnownPhoto>>(document.querySelector<HTMLElement>('[data-pics]')?.dataset.photos ?? '{}');
  const locale = container.dataset.locale ?? 'en';
  const plural = new Intl.PluralRules(locale); // "1 visit", "2 visits"; "1 visita", "2 visitas"
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);
  const m = messageReader(messages);

  let token = remembered.get();
  let wantedDay: string | null = null; // null: the newest day there is
  let generation = 0; // a newer render makes older, slower answers stale
  let displayed = false;

  const show = (...nodes: Child[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as Node[]));
    root.removeAttribute('aria-busy');
  };

  // Signing in is the page's own token box (admin-gate.ts); without a token this tab shows nothing.
  const renderGate = (problem?: unknown) => leaveToGate(root, problem);

  const photoName = (id: string) => photos[id]?.title ?? id;

  function toolbar(days: DayInfo[], day: string) {
    const select = el('select', { attrs: { id: 'access-day', name: 'day' } },
      ...days.map((info) => {
        const option = el('option', { text: dayLabel(info.day), attrs: { value: info.day } });
        if (info.day === day) option.selected = true;
        return option;
      }));
    select.addEventListener('change', () => {
      wantedDay = select.value;
      void render();
    });
    return el('div', { class: 'pics-summary access-toolbar' },
      el('div', { class: 'access-day' }, el('label', { text: m('access.day'), attrs: { for: 'access-day' } }), select));
  }

  /**
   * The day's two groups side by side in one table, two columns by two rows: the titles ("Most visited pages",
   * "Most opened photos", each with its total), then each group's pie with its legend, which names every slice with its
   * count and share. A pie shares the whole day out: the first five by name and "Other" for the rest. A group with a
   * single page or photo gets that one line instead of a pie, and an empty one says so. `name` turns a key into text.
   */
  function groupsTable(groups: { kind: 'pages' | 'photos'; total: number; all: Count<string>[]; name: (key: string) => string }[]) {
    const cell = (kind: string, ...children: Child[]) => el('td', { attrs: { 'data-group': kind } }, ...children);
    const pieOf = ({ kind, all, name }: (typeof groups)[number]) => {
      const slices = pieSlices(all).map((slice) => ('other' in slice
        ? { label: m('access.chart.other', { count: slice.groups }), count: slice.count, share: slice.share, other: true }
        : { label: name(slice.key), count: slice.count, share: slice.share }));
      const describe = (count: number, percent: string) => m(`access.chart.${kind === 'pages' ? 'visits' : 'opens'}.${plural.select(count) === 'one' ? 'one' : 'other'}`, { count, share: percent });
      if (!all.length) return el('p', { class: 'results-empty', text: m(`access.nothing.${kind}`) });
      if (!slices.length) {
        // One page (or photo) all day: a whole circle would say nothing more than this line.
        return el('p', { class: 'access-single', text: `${name(all[0].key)}: ${describe(all[0].count, new Intl.NumberFormat(locale, { style: 'percent' }).format(1))}` });
      }
      return pieChart(slices, { title: m(`access.chart.${kind}`), locale, describe: (slice, percent) => describe(slice.count, percent) });
    };
    return el('table', { class: 'access-groups' },
      el('caption', { class: 'visually-hidden', text: m('access.caption') }),
      // Each title carries its column's total for the day: "Page visits: 13" under "Most visited pages".
      el('thead', {}, el('tr', {}, ...groups.map(({ kind, total }) => el('th', { attrs: { scope: 'col', 'data-group': kind } },
        el('span', { class: 'access-group-title', text: m(kind === 'pages' ? 'access.topPages' : 'access.topPhotos') }),
        el('span', { class: 'access-group-total', text: `${m(kind === 'pages' ? 'access.summary.views' : 'access.summary.photos')}: ${total}` }))))),
      el('tbody', {},
        el('tr', { class: 'access-charts' }, ...groups.map((group) => cell(group.kind, pieOf(group))))));
  }

  /**
   * The day by country on a world map, under the pies, in a table of its own with the same light gray lines: its title
   * (with how many countries) over one cell holding the map, its legend and its list of countries.
   */
  function mapBlock(entries: AccessEntry[]) {
    const { countries, unplaced } = byCountry(entries);
    const form = (count: number) => (plural.select(count) === 'one' ? 'one' : 'other');
    const counts = (c: CountryCount) => [m(`access.map.views.${form(c.views)}`, { count: c.views }), m(`access.map.photos.${form(c.photos)}`, { count: c.photos })].join(' · ');
    const chart = worldMapChart(countries, unplaced, {
      title: m('access.map.title'),
      counts,
      none: m('access.map.none'),
      legend: m('access.map.legend'),
      unplaced: (n) => m(`access.map.unplaced.${form(n)}`, { count: n }),
      topCities: m('access.map.topCities'),
      cityCount: (n) => m(`access.map.cityCount.${form(n)}`, { count: n }),
      noCities: m('access.map.noCities'),
    });
    return el('div', { class: 'access-map' },
      el('table', { class: 'access-map-table' },
        el('caption', { class: 'visually-hidden', text: m('access.map.title') }),
        el('thead', {}, el('tr', {}, el('th', { attrs: { scope: 'col' } },
          el('span', { class: 'access-group-title', text: m('access.map.heading') }),
          el('span', { class: 'access-group-total', text: `${m('access.map.countries')}: ${countries.length}` })))),
        el('tbody', {}, el('tr', {}, el('td', {}, chart)))));
  }

  function summaryBlock(entries: AccessEntry[]) {
    const s = summarize(entries);
    // The pies share the whole day out, so they rank every group, not just the ten listed.
    const all = summarize(entries, Infinity);
    return el('div', { class: 'access-summary' },
      // Page visits and photos opened are in their columns' titles below; only what spans both stays here.
      el('dl', { class: 'results-meta' },
        el('dt', { text: m('access.summary.visitors') }), el('dd', { text: String(s.visitors) })),
      el('div', { class: 'access-groups-wrap', attrs: { tabindex: '0', role: 'region', 'aria-label': m('access.caption') } },
        groupsTable([
          { kind: 'pages', total: s.views, all: all.pages, name: (key) => key },
          { kind: 'photos', total: s.photos, all: all.topPhotos, name: photoName },
        ])),
      // The world map follows the pies.
      mapBlock(entries));
  }

  async function renderDay(run: number) {
    const list = await apiGet<DayList>(apiUrl, token, '/access');
    if (run !== generation) return;
    if (!list.days.length) {
      displayed = true;
      return show(el('p', { class: 'results-empty', text: m('access.empty') }));
    }
    const day = list.days.some((info) => info.day === wantedDay) ? wantedDay! : list.days[0].day;
    const log = await apiGet<AccessDay>(apiUrl, token, `/access/${encodeURIComponent(day)}`);
    if (run !== generation) return;
    const entries = Array.isArray(log.entries) ? log.entries : [];
    displayed = true;
    show(toolbar(list.days, day), summaryBlock(entries));
  }

  async function render() {
    const run = ++generation;
    if (!token) {
      displayed = false;
      return renderGate();
    }
    root.setAttribute('aria-busy', 'true');
    show(el('p', { class: 'results-loading', text: m('loading') }));
    try {
      await renderDay(run);
    } catch (error) {
      if (run !== generation) return;
      displayed = false;
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'notConfigured')) {
        token = '';
        remembered.set('');
        renderGate(error);
      } else {
        show(el('p', { class: 'results-error', text: errorMessage(m, error), attrs: { role: 'alert' } }));
      }
    }
  }

  // Nothing is requested while the tab is hidden; showing it loads the newest day, unless it is already shown.
  const sync = () => {
    if (!panel.hidden && (token ? !displayed : !root.querySelector('form'))) void render();
  };
  // A sign-in or sign-out in another tab of the page applies here too.
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    displayed = false;
    generation++;
    sync();
  });
  window.addEventListener(REFRESH_EVENT, () => {
    if (!panel.hidden && token) void render();
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(sync, 0);
}
