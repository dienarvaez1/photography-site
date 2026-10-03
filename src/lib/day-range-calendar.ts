// The Access Info tab's day picker, after the Astro UXDS date picker (astrouxds.com/components/date-picker): a field
// showing the chosen days as YYYY-MM-DD with a calendar icon, which opens a compact month calendar (month and year
// dropdowns between ‹ › arrows, short weekday names, the neighbouring months' days dimmed to fill the grid); and beside
// it a Quick range dropdown (Today, Last Week, Current Week, Last Month, Current Month, Current Year). In the calendar a
// first click starts a range of days and a second click ends it (the same day twice is one day). Days are UTC days, like
// the access log's files ("2026-10-01"). Days with visits are marked; days after today can't be chosen; a range is at
// most MAX_RANGE_DAYS long. Escape, Close, a tap outside, or choosing closes it. Everything is put on the page as text.
import { el, type Reader } from './admin-common';
import { MAX_RANGE_DAYS, PRESETS, addDays, presetRange, rangeOf, toDate, toDay, todayUtc, type DayRange, type Preset } from './access-view';

const SVG = 'http://www.w3.org/2000/svg';

/** The calendar icon in the field (drawn here: the page's policy allows no inline images). */
function calendarIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'access-range-icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 8H5v10h14V10Z');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

export function mountDayRangePicker(options: {
  m: Reader;
  locale: string;
  range: DayRange;
  /** The days the log has (they're marked in the calendar). */
  logged: Set<string>;
  onChoose: (range: DayRange) => void;
}): HTMLElement {
  const { m, locale, logged, onChoose } = options;
  const today = todayUtc();
  const full = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthName = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short' });
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' });
  const label = ({ from, to }: DayRange) => (from === to ? from : `${from} – ${to}`);

  let range = options.range;
  let pending: string | null = null; // the first click of a range, until the second
  let shown = range.to.slice(0, 7); // the month on screen ("2026-10")

  // --- The field and the Quick range dropdown ---------------------------------------------------------------------------

  const value = el('span', { class: 'access-range-value', text: label(range) });
  const toggle = el('button', { class: 'access-range-toggle', attrs: { type: 'button', id: 'access-range', 'aria-labelledby': 'access-range-label access-range', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'access-calendar' } }, value, calendarIcon());

  const presetOf = (r: DayRange) =>
    PRESETS.find((p) => {
      const pr = presetRange(p, today);
      return pr.from === r.from && pr.to === r.to;
    }) ?? 'custom';
  const quick = el('select', { class: 'access-quick', attrs: { id: 'access-quick', 'aria-label': m('access.calendar.presetsLabel') } },
    el('option', { text: m('access.calendar.custom'), attrs: { value: 'custom', disabled: '' } }),
    ...PRESETS.map((preset) => el('option', { text: m(`access.calendar.presets.${preset}`), attrs: { value: preset } })));
  quick.value = presetOf(range);
  quick.addEventListener('change', () => {
    if (quick.value !== 'custom') choose(presetRange(quick.value as Preset, today));
  });

  // --- The calendar --------------------------------------------------------------------------------------------------------

  const prev = el('button', { class: 'access-calendar-nav', text: '‹', attrs: { type: 'button', 'aria-label': m('access.calendar.previous') } });
  const next = el('button', { class: 'access-calendar-nav', text: '›', attrs: { type: 'button', 'aria-label': m('access.calendar.next') } });
  const monthSelect = el('select', { class: 'access-calendar-select', attrs: { 'aria-label': m('access.calendar.month') } },
    ...Array.from({ length: 12 }, (_, i) => el('option', { text: monthName.format(new Date(Date.UTC(2026, i, 1))), attrs: { value: String(i + 1).padStart(2, '0') } })));
  const firstYear = Math.min(Number(today.slice(0, 4)) - 2, ...[...logged].map((d) => Number(d.slice(0, 4))));
  const yearSelect = el('select', { class: 'access-calendar-select', attrs: { 'aria-label': m('access.calendar.year') } },
    ...Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, i) => el('option', { text: String(firstYear + i), attrs: { value: String(firstYear + i) } })));
  const title = el('span', { class: 'visually-hidden', attrs: { id: 'access-calendar-title', 'aria-live': 'polite' } });
  const grid = el('table', { class: 'access-calendar-grid', attrs: { role: 'grid', 'aria-labelledby': 'access-calendar-title' } });
  const hint = el('p', { class: 'access-calendar-hint', attrs: { role: 'status' } });
  const closeButton = el('button', { class: 'results-button access-calendar-close', text: m('access.calendar.close'), attrs: { type: 'button' } });
  const calendar = el('div', { class: 'access-calendar', attrs: { id: 'access-calendar', role: 'dialog', 'aria-label': m('access.day'), hidden: '' } },
    el('div', { class: 'access-calendar-head' }, prev, el('div', { class: 'access-calendar-selects' }, monthSelect, yearSelect), next),
    title,
    grid,
    hint,
    el('div', { class: 'access-calendar-foot' }, closeButton));

  const showMonth = (month: string) => {
    shown = month > today.slice(0, 7) ? today.slice(0, 7) : month;
    draw();
  };
  const moveMonth = (by: number) => {
    const [y, mo] = shown.split('-').map(Number);
    showMonth(toDay(new Date(Date.UTC(y, mo - 1 + by, 1))).slice(0, 7));
  };
  prev.addEventListener('click', () => moveMonth(-1));
  next.addEventListener('click', () => moveMonth(1));
  monthSelect.addEventListener('change', () => showMonth(`${yearSelect.value}-${monthSelect.value}`));
  yearSelect.addEventListener('change', () => showMonth(`${yearSelect.value}-${monthSelect.value}`));

  function open(isOpen: boolean) {
    calendar.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      pending = null;
      shown = range.to.slice(0, 7);
      draw();
      grid.querySelector<HTMLButtonElement>('button.chosen:not(.outside), button[aria-current="date"], button:not(:disabled)')?.focus();
    }
  }
  toggle.addEventListener('click', () => open(toggle.getAttribute('aria-expanded') !== 'true'));
  closeButton.addEventListener('click', () => {
    open(false);
    toggle.focus();
  });
  calendar.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    open(false);
    toggle.focus();
  });
  // A tap or click anywhere outside the picker closes the calendar (removed with it when the tab redraws).
  const outside = (event: PointerEvent) => {
    if (calendar.hidden || !picker.isConnected) return;
    if (!picker.contains(event.target as Node)) open(false);
  };
  document.addEventListener('pointerdown', outside);

  function choose(chosen: DayRange) {
    range = chosen;
    value.textContent = label(range);
    quick.value = presetOf(range);
    open(false);
    onChoose(range);
  }

  function pick(day: string) {
    if (pending === null) {
      pending = day;
      hint.textContent = m('access.calendar.pickEnd', { day });
      draw();
      return;
    }
    choose(rangeOf(pending, day));
    toggle.focus();
  }

  function draw() {
    const [y, mo] = shown.split('-').map(Number);
    monthSelect.value = shown.slice(5, 7);
    yearSelect.value = String(y);
    title.textContent = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, mo - 1, 1)));
    prev.disabled = `${yearSelect.options[0]?.value}-01` >= shown;
    next.disabled = shown >= today.slice(0, 7);
    // Weeks start on Monday (as the Current Week and Last Week ranges do); the neighbouring months' days fill the six rows.
    const first = `${shown}-01`;
    const start = addDays(first, -((toDate(first).getUTCDay() + 6) % 7));
    const head = el('tr', {}, ...Array.from({ length: 7 }, (_, i) => el('th', { text: weekday.format(toDate(addDays(start, i))), attrs: { scope: 'col' } })));
    const rows = Array.from({ length: 6 }, (_, week) =>
      el('tr', {}, ...Array.from({ length: 7 }, (_, i) => {
        const day = addDays(start, week * 7 + i);
        const inRange = pending === null ? day >= range.from && day <= range.to : day === pending;
        const button = el('button', {
          class: ['access-calendar-day', day.slice(0, 7) !== shown ? 'outside' : '', logged.has(day) ? 'logged' : '', inRange ? 'chosen' : ''].filter(Boolean).join(' '),
          text: String(Number(day.slice(8))),
          attrs: {
            type: 'button',
            'data-day': day,
            'aria-label': `${full.format(toDate(day))}${logged.has(day) ? `, ${m('access.calendar.hasVisits')}` : ''}`,
            'aria-pressed': String(inRange),
            ...(day === today ? { 'aria-current': 'date' } : {}),
          },
        });
        button.disabled = day > today;
        button.addEventListener('click', () => pick(day));
        return el('td', {}, button);
      })));
    grid.replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows));
    if (pending === null) hint.textContent = m('access.calendar.pickStart', { max: MAX_RANGE_DAYS });
  }

  const picker = el('div', { class: 'access-range' },
    el('span', { class: 'access-range-label', text: m('access.day'), attrs: { id: 'access-range-label' } }),
    el('div', { class: 'access-range-controls' }, toggle, quick),
    calendar);
  // Once the tab draws a new picker, this one's outside-tap listener goes.
  new MutationObserver((_, watcher) => {
    if (picker.isConnected) return;
    document.removeEventListener('pointerdown', outside);
    watcher.disconnect();
  }).observe(document.body, { childList: true, subtree: true });
  return picker;
}
