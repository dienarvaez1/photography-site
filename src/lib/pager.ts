// Long lists on the Access Info tab (its IP addresses, the map's countries) show PAGE_SIZE rows at a time, with arrows to
// the previous and next ones and a "1–50 of 230" line. `draw(start, end)` puts rows start..end-1 on the page; the pager
// calls it at once for the first rows, and again on every arrow. Lists that fit on one page get no pager at all.
import { el } from './admin-common';
import { PAGE_SIZE, pageOf } from './access-view';

export interface PagerTexts {
  previous: string;
  next: string;
  /** "{first}–{last} of {total}" */
  status: (first: number, last: number, total: number) => string;
}

export function pager(total: number, draw: (start: number, end: number) => void, texts: PagerTexts, label: string): HTMLElement | null {
  let page = 0;
  const status = el('span', { class: 'pager-status', attrs: { 'aria-live': 'polite' } });
  const previous = el('button', { class: 'results-button pager-arrow', text: '‹', attrs: { type: 'button', 'aria-label': texts.previous, title: texts.previous } });
  const next = el('button', { class: 'results-button pager-arrow', text: '›', attrs: { type: 'button', 'aria-label': texts.next, title: texts.next } });
  const go = (to: number) => {
    const at = pageOf(total, to);
    page = at.page;
    draw(at.start, at.end);
    status.textContent = texts.status(at.first, at.last, total);
    previous.disabled = !at.hasPrevious;
    next.disabled = !at.hasNext;
  };
  previous.addEventListener('click', () => go(page - 1));
  next.addEventListener('click', () => go(page + 1));
  go(0);
  return total > PAGE_SIZE ? el('nav', { class: 'pager', attrs: { 'aria-label': label } }, previous, status, next) : null;
}
