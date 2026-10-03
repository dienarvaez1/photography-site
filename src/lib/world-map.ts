// The Access Info tab's world map: every country as a plain SVG path (src/data/world-map.json, projected once by
// scripts/build-world-map.mjs), shaded by how many visits it had that day. Hovering over a country, or focusing one that
// had visits with the keyboard, highlights it and shows one tooltip: its numbers first, its name after. A legend and a
// list under the map say the same, so nothing is told by color or hover alone.
//
// Shades are classes (`.map-band-1` … `.map-band-5`, `.map-none`), set in admin.astro's styles: one blue, darkest for
// the fewest visits up to lightest for the most (lighter stands out more on the page's near-black), validated as an
// ordered scale against the page's background; countries without visits stay a quiet gray.
import { el } from './admin-common';
import { bandOf, bands, type CountryCount } from './access-view';
import worldMap from '../data/world-map.json';
import { pager, type PagerTexts } from './pager';

const SVG = 'http://www.w3.org/2000/svg';

export interface MapTexts {
  title: string;
  /** "12 page visits · 3 photos opened" for a country. */
  counts: (count: CountryCount) => string;
  none: string;
  legend: string;
  unplaced: (n: number) => string;
  /** The list's tooltip: its heading ("Top cities"), a city's count ("12 accesses"), and what a country without one says. */
  topCities: string;
  cityCount: (n: number) => string;
  noCities: string;
  /** The country list's arrows, past 50 countries, and the name of the list they page through. */
  pager: PagerTexts;
  pagerLabel: string;
}

/** How many of a country's cities its tooltip in the list names. */
export const TOP_CITIES = 5;

export function worldMapChart(countries: CountryCount[], unplaced: number, texts: MapTexts) {
  const byName = new Map(countries.map((c) => [c.country, c]));
  const ranges = bands(countries[0]?.total ?? 0);
  const svg = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({ viewBox: `0 0 ${worldMap.width} ${worldMap.height}`, class: 'world-map', role: 'group', 'aria-label': texts.title })) svg.setAttribute(name, value);
  const tip = el('div', { class: 'pie-tooltip map-tooltip', attrs: { role: 'status' } });
  tip.hidden = true;
  const plot = el('div', { class: 'map-plot' });
  // The highlighted country's outline, drawn on top of every country (an SVG has no z-index) and never in the pointer's
  // way. Moving the country itself to the top instead would lose the browser's track of the pointer over it.
  const highlight = document.createElementNS(SVG, 'path');
  highlight.setAttribute('class', 'map-highlight');
  highlight.setAttribute('aria-hidden', 'true');

  function showTip(name: string, count: CountryCount | undefined, path: SVGPathElement, at?: { x: number; y: number }, box?: DOMRect) {
    highlight.setAttribute('d', path.getAttribute('d') ?? '');
    const band = count ? bandOf(count.total, ranges) : -1;
    const key = el('span', { class: `pie-key ${band < 0 ? 'map-none' : `map-band-${band + 1}`}`, attrs: { 'aria-hidden': 'true' } });
    tip.replaceChildren(el('strong', { text: count ? texts.counts(count) : texts.none }), el('span', { class: 'pie-tip-label' }, key, name));
    tip.hidden = false;
    const area = plot.getBoundingClientRect();
    const x = at ? at.x - area.left + 14 : (box ? box.right - area.left + 8 : area.width / 2);
    const y = at ? at.y - area.top + 14 : (box ? box.top - area.top : 0);
    tip.style.setProperty('--tip-x', `${Math.max(0, Math.min(x, area.width - tip.offsetWidth))}px`);
    tip.style.setProperty('--tip-y', `${Math.max(0, Math.min(y, area.height - tip.offsetHeight))}px`);
  }
  const hideTip = () => {
    tip.hidden = true;
    highlight.removeAttribute('d');
  };

  for (const country of worldMap.countries) {
    const count = byName.get(country.name);
    const band = count ? bandOf(count.total, ranges) : -1;
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', country.d);
    path.setAttribute('class', `map-country ${band < 0 ? 'map-none' : `map-band-${band + 1}`}`);
    path.dataset.country = country.name;
    if (count) {
      // Only countries with visits are in the tab order: the rest have nothing to say but "no visits".
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'img');
      path.setAttribute('aria-label', `${country.name}: ${texts.counts(count)}`);
      path.addEventListener('focus', () => showTip(country.name, count, path, undefined, path.getBoundingClientRect()));
      path.addEventListener('blur', hideTip);
    } else {
      path.setAttribute('aria-hidden', 'true');
    }
    path.addEventListener('pointermove', (event) => showTip(country.name, count, path, { x: event.clientX, y: event.clientY }));
    path.addEventListener('pointerleave', hideTip);
    svg.append(path);
  }
  svg.append(highlight);
  svg.addEventListener('pointerleave', hideTip);
  plot.append(svg, tip);

  const legend = el('div', { class: 'map-legend', attrs: { role: 'list', 'aria-label': texts.legend } },
    ...ranges.map(([from, to], i) => el('span', { class: 'map-legend-item', attrs: { role: 'listitem' } },
      el('span', { class: `pie-swatch map-band-${i + 1}`, attrs: { 'aria-hidden': 'true' } }),
      from === to ? String(from) : `${from}–${to}`)),
    el('span', { class: 'map-legend-item', attrs: { role: 'listitem' } }, el('span', { class: 'pie-swatch map-none', attrs: { 'aria-hidden': 'true' } }), '0'));

  // Most accessed first (page visits and photos opened together), one country per line, down the page.
  // Each country in the list shows its top cities on hover and on keyboard focus: one tooltip for the whole list, kept
  // beside the country it is about.
  const cityTip = el('div', { class: 'pie-tooltip map-city-tooltip', attrs: { role: 'status' } });
  cityTip.hidden = true;
  const listBox = el('div', { class: 'map-list-box' });
  const showCities = (c: CountryCount, item: HTMLElement) => {
    const top = c.cities.slice(0, TOP_CITIES);
    cityTip.replaceChildren(
      el('strong', { text: `${texts.topCities}: ${c.country}` }),
      top.length
        ? el('ol', { class: 'map-city-list' }, ...top.map((city) => el('li', {}, el('span', { class: 'access-name', text: city.key }), el('span', { class: 'access-times', text: texts.cityCount(city.count) }))))
        : el('span', { class: 'pie-tip-label', text: texts.noCities }));
    cityTip.hidden = false;
    const box = listBox.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    cityTip.style.setProperty('--tip-x', `${Math.max(0, Math.min(row.left - box.left + Math.min(row.width, 320) * 0.5, box.width - cityTip.offsetWidth))}px`);
    cityTip.style.setProperty('--tip-y', `${row.bottom - box.top + 4}px`);
  };
  const hideCities = () => {
    cityTip.hidden = true;
  };
  const listItem = (c: CountryCount) => {
    const item = el('li', { attrs: { tabindex: '0', 'data-country': c.country, 'aria-label': `${c.country}: ${texts.counts(c)}` } },
      el('span', { class: 'access-name', text: c.country }), el('span', { class: 'access-times', text: texts.counts(c) }));
    item.addEventListener('pointerenter', () => showCities(c, item));
    item.addEventListener('pointerleave', hideCities);
    item.addEventListener('focus', () => showCities(c, item));
    item.addEventListener('blur', hideCities);
    return item;
  };
  // 50 countries at a time (in rank order, so the numbering carries on), with arrows for the rest.
  const list = el('ol', { class: 'map-list' });
  const nav = pager(countries.length, (start, end) => {
    hideCities();
    list.start = start + 1;
    list.replaceChildren(...countries.slice(start, end).map(listItem));
  }, texts.pager, texts.pagerLabel);
  listBox.append(list, cityTip);

  // The visits the map can't place come last, under the countries they're missing from.
  return el('figure', { class: 'map-figure' }, plot, legend, listBox, nav, unplaced ? el('p', { class: 'results-hint map-unplaced', text: texts.unplaced(unplaced) }) : null);
}
