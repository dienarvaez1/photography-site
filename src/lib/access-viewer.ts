// The Admin page's Access Info viewer: who opened which page and which photo, over a range of UTC days chosen in a
// calendar (day-range-calendar.ts; today by default), read from the
// site's access log (src/config/access-log.ts) through the results API, behind the same admin token as the other tabs.
// Built like the GitHub Issues viewer (issues-viewer.ts); everything from the API is put on the page as text.
import type { AccessDay, AccessEntry } from '../config/access-log';
import { byCountry, byIp, daysBetween, pieSlices, summarize, todayUtc, type Count, type CountryCount, type DayRange } from './access-view';
import { mountDayRangePicker } from './day-range-calendar';
import { pager, type PagerTexts } from './pager';
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
  let range: DayRange = { from: todayUtc(), to: todayUtc() }; // the days shown: today, until another range is chosen
  let generation = 0; // a newer render makes older, slower answers stale
  let displayed = false;

  const show = (...nodes: Child[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as Node[]));
    root.removeAttribute('aria-busy');
  };

  // Signing in is the page's own token box (admin-gate.ts); without a token this tab shows nothing.
  const renderGate = (problem?: unknown) => leaveToGate(root, problem);

  const photoName = (id: string) => photos[id]?.title ?? id;
  const pagerTexts: PagerTexts = {
    previous: m('access.pager.previous'),
    next: m('access.pager.next'),
    status: (first, last, total) => m('access.pager.status', { first, last, total }),
  };

  /** The day picker: a button naming the chosen days, opening a calendar where the days with visits are marked. */
  function toolbar(days: DayInfo[]) {
    const picker = mountDayRangePicker({
      m,
      locale,
      range,
      logged: new Set(days.map((info) => info.day.slice(0, 10))),
      onChoose: (chosen) => {
        range = chosen;
        void render();
      },
    });
    return el('div', { class: 'pics-summary access-toolbar' }, picker);
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
      pager: pagerTexts,
      pagerLabel: m('access.map.heading'),
    });
    return el('div', { class: 'access-map' },
      el('table', { class: 'access-map-table' },
        el('caption', { class: 'visually-hidden', text: m('access.map.title') }),
        el('thead', {}, el('tr', {}, el('th', { attrs: { scope: 'col' } },
          el('span', { class: 'access-group-title', text: m('access.map.heading') }),
          el('span', { class: 'access-group-total', text: `${m('access.map.countries')}: ${countries.length}` })))),
        el('tbody', {}, el('tr', {}, el('td', {}, chart)))));
  }

  /**
   * The day by visitor address, under the map, in a table of its own with the same light gray lines: its title (with how
   * many addresses) over one row per address, most visits first: the address, where it is, page visits, photos opened.
   */
  function ipBlock(entries: AccessEntry[]) {
    const ips = byIp(entries);
    const head = ['ip', 'location', 'views', 'photos'].map((key) => el('th', { text: m(`access.ips.${key}`), attrs: { scope: 'col' } }));
    const row = (r: (typeof ips)[number]) =>
      el('tr', {},
        el('th', { class: 'access-ip', text: r.ip, attrs: { scope: 'row' } }),
        el('td', { text: [r.city, r.country].filter(Boolean).join(', ') || m('access.ips.unknown') }),
        el('td', { class: 'access-num', text: String(r.views) }),
        el('td', { class: 'access-num', text: String(r.photos) }));
    // 50 addresses at a time, with arrows for the rest.
    const body = el('tbody', {});
    const nav = pager(ips.length, (start, end) => body.replaceChildren(...ips.slice(start, end).map(row)), pagerTexts, m('access.ips.heading'));
    return el('div', { class: 'access-ips' },
      el('div', { class: 'access-ips-wrap', attrs: { tabindex: '0', role: 'region', 'aria-label': m('access.ips.heading') } },
        el('table', { class: 'access-map-table access-ip-table' },
          el('caption', { class: 'visually-hidden', text: m('access.ips.heading') }),
          el('thead', {},
            el('tr', {}, el('th', { attrs: { scope: 'colgroup', colspan: '4' } },
              el('span', { class: 'access-group-title', text: m('access.ips.heading') }),
              el('span', { class: 'access-group-total', text: `${m('access.ips.count')}: ${ips.length}` }))),
            el('tr', {}, ...head)),
          body)),
      nav);
  }

  function summaryBlock(entries: AccessEntry[]) {
    const s = summarize(entries);
    // The pies share the whole day out, so they rank every group, not just the ten listed.
    const all = summarize(entries, Infinity);
    // Page visits and photos opened are in their columns' titles; how many addresses, in the IP table's title.
    return el('div', { class: 'access-summary' },
      el('div', { class: 'access-groups-wrap', attrs: { tabindex: '0', role: 'region', 'aria-label': m('access.caption') } },
        groupsTable([
          { kind: 'pages', total: s.views, all: all.pages, name: (key) => key },
          { kind: 'photos', total: s.photos, all: all.topPhotos, name: photoName },
        ])),
      // On a phone the pies' legends are hidden: a tap on a slice tells its numbers instead (styles in admin.astro).
      el('p', { class: 'pie-touch-hint', text: m('access.tapHint') }),
      // The world map follows the pies, and the addresses follow the map.
      mapBlock(entries),
      ipBlock(entries));
  }

  /** The chosen days, added up: each day the log has in the range is read (all at once), then shown as one. */
  async function renderDay(run: number) {
    const list = await apiGet<DayList>(apiUrl, token, '/access');
    if (run !== generation) return;
    const wanted = new Set(daysBetween(range));
    const days = list.days.filter((info) => wanted.has(info.day.slice(0, 10)));
    // Read six days at a time: a year is a few hundred requests, which shouldn't all go at once.
    const logs: AccessDay[] = [];
    for (let i = 0; i < days.length; i += 6) {
      logs.push(...(await Promise.all(days.slice(i, i + 6).map((info) => apiGet<AccessDay>(apiUrl, token, `/access/${encodeURIComponent(info.day)}`)))));
      if (run !== generation) return;
    }
    const entries = logs.flatMap((log) => (Array.isArray(log.entries) ? log.entries : []));
    displayed = true;
    show(toolbar(list.days), entries.length ? summaryBlock(entries) : el('p', { class: 'results-empty', text: m(list.days.length ? 'access.noVisits' : 'access.empty') }));
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
