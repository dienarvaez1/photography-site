// A small pie chart for the Admin page's Access Info tab: one slice per group, a 2px gap in the page's own color
// between slices, a legend that says what each color is (and its number, so nothing is told by color or hover alone),
// and one tooltip, shown on hover and on keyboard focus, with the slice's number first and its name after.
//
// Colors are classes (`.pie-slot-1` … `.pie-slot-5`, `.pie-other`), set in admin.astro's styles: the dark steps of
// the dataviz reference palette's first four categorical slots, then its violet (magenta, red and green each failed
// next to the yellow or the gray), and a neutral gray for "Other". Validated as a ring (the last slice touches the
// first) against the page's background: worst neighboring pair ΔE 8.4 for color-blind vision, 19.1 for normal vision,
// every slice at least 3:1 against the page.
import { el } from './admin-common';

const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 200;
const RADIUS = 96;

export interface PieSlice {
  /** What the legend and the tooltip call it. */
  label: string;
  count: number;
  /** A fraction of the whole, 0–1. */
  share: number;
  other?: boolean;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** The SVG path of a slice from one angle to another (radians, clockwise from twelve o'clock). */
function slicePath(from: number, to: number) {
  const c = SIZE / 2;
  const point = (angle: number) => `${(c + RADIUS * Math.sin(angle)).toFixed(2)} ${(c - RADIUS * Math.cos(angle)).toFixed(2)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${c} ${c} L ${point(from)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${point(to)} Z`;
}

/**
 * A pie with its legend and tooltip. `describe(slice, percent)` gives the slice's value line ("2 visits · 67%"), which
 * the tooltip leads with and the legend and the slice's accessible name repeat.
 */
export function pieChart(slices: PieSlice[], { title, locale, describe }: { title: string; locale: string; describe: (slice: PieSlice, percent: string) => string }) {
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const classOf = (slice: PieSlice, index: number) => (slice.other ? 'pie-other' : `pie-slot-${index + 1}`);

  const tip = el('div', { class: 'pie-tooltip', attrs: { role: 'status' } });
  tip.hidden = true;
  const chart = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'pie', role: 'group', 'aria-label': title });
  const figure = el('figure', { class: 'pie-figure' });
  const plot = el('div', { class: 'pie-plot' }, chart, tip);

  function showTip(slice: PieSlice, index: number, at?: { x: number; y: number }) {
    const value = el('strong', { text: describe(slice, percent.format(slice.share)) });
    const key = el('span', { class: `pie-key ${classOf(slice, index)}`, attrs: { 'aria-hidden': 'true' } });
    tip.replaceChildren(value, el('span', { class: 'pie-tip-label' }, key, slice.label));
    tip.hidden = false;
    // Next to the pointer; for the keyboard, beside the chart's top right, clear of the slices.
    const box = plot.getBoundingClientRect();
    const x = at ? Math.min(at.x - box.left + 12, box.width - tip.offsetWidth) : box.width - tip.offsetWidth / 2;
    const y = at ? at.y - box.top + 12 : 0;
    tip.style.setProperty('--tip-x', `${Math.max(0, x)}px`);
    tip.style.setProperty('--tip-y', `${Math.max(0, y)}px`);
  }
  const hideTip = () => {
    tip.hidden = true;
  };

  let angle = 0;
  slices.forEach((slice, index) => {
    const end = index === slices.length - 1 ? Math.PI * 2 : angle + slice.share * Math.PI * 2;
    // Two half-pies for a slice that is (all but) the whole circle: one arc can't draw a full turn.
    const d = end - angle >= Math.PI * 2 - 1e-6 ? `${slicePath(angle, angle + Math.PI)} ${slicePath(angle + Math.PI, end)}` : slicePath(angle, end);
    const path = svg('path', { d, class: `pie-slice ${classOf(slice, index)}`, tabindex: '0', role: 'img', 'aria-label': `${slice.label}: ${describe(slice, percent.format(slice.share))}` });
    path.addEventListener('pointermove', (event) => showTip(slice, index, { x: event.clientX, y: event.clientY }));
    path.addEventListener('pointerleave', hideTip);
    path.addEventListener('focus', () => showTip(slice, index));
    path.addEventListener('blur', hideTip);
    chart.append(path);
    angle = end;
  });

  const legend = el('ul', { class: 'pie-legend' },
    ...slices.map((slice, index) => el('li', {},
      el('span', { class: `pie-swatch ${classOf(slice, index)}`, attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'pie-legend-label', text: slice.label }),
      el('span', { class: 'pie-legend-value', text: describe(slice, percent.format(slice.share)) }))));

  figure.append(plot, legend);
  return figure;
}
