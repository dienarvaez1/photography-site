// The Admin page's Pics Viewer. It lists the original photos in the private originals bucket
// (photos/<id>/original.*) through the API and, when a file is hovered or focused, shows a tooltip with
// its camera information, file size and copyright. Each row of the list shows a small thumbnail, the site's
// own public web copy of the photo; the private originals are never fetched or shown: the API only ever
// returns numbers and text. Everything from the API is put on the page as text.
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, gateForm, icon, messageReader, remembered, type Child, type Messages } from './admin-common';
import type { FormCategory } from './photo-form';
import type { RemovalBar, RemoveResult } from './photo-remove';
import { PICS_PAGE_SIZE } from '../config/admin';
import { PICS_TAB, formatBytes, formatExactBytes, joinPhotos, rowsToShow, thumbSize, type KnownPhoto, type Original, type PicRow } from './pics-view';
import { resolveApiUrl } from './results-view';

type Details = {
  id: string;
  key: string;
  size: number;
  cameraLine: string | null;
  copyright: string | null;
  artist: string | null;
};

export function mountPicsViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-pics-root]')!;
  const messages: Messages = JSON.parse(container.dataset.messages ?? '{}');
  const known: Record<string, KnownPhoto> = JSON.parse(container.dataset.photos ?? '{}');
  const categories: FormCategory[] = JSON.parse(container.dataset.categories ?? '[]');
  const formHost = container.querySelector<HTMLElement>('[data-pics-form]')!; // where the New Photo form opens
  const locale = container.dataset.locale ?? 'en';
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);
  const m = messageReader(messages);

  let token = remembered.get();
  let generation = 0;
  let displayed = false; // is the list on screen?
  // Bulk removal (the Remove Photos button): the last listing, whether checkboxes are showing, which photos are ticked.
  let listing: { rows: PicRow[]; complete: boolean } | null = null;
  // The list is drawn a page at a time (PICS_PAGE_SIZE rows); the next page is drawn when the end of the list is reached.
  let shownCount = PICS_PAGE_SIZE;
  let more: HTMLElement | null = null; // "Showing 20 of 87 photos" and the Show more button, while there is more to show
  let pager: IntersectionObserver | null = null;
  let removing = false;
  let bar: RemovalBar | null = null;
  // The removal code is loaded when Remove Photos is first pressed (it is only ever used on the owner's computer), so
  // the page's own script stays small.
  let removal: typeof import('./photo-remove') | null = null;
  let deleting = false; // a removal is under way: nothing may redraw the list until it is over
  const selected = new Set<string>();
  let notice: { text: string; alert: boolean } | null = null; // what the last removal did, shown until the next action
  const details = new Map<string, Promise<Details>>(); // one request per photo, however often it is hovered

  const api = <T,>(path: string) => apiGet<T>(apiUrl, token, path);
  const show = (...nodes: Child[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as Node[]));
    root.removeAttribute('aria-busy');
  };

  // --- Sign in ------------------------------------------------------------------------------------------------

  function renderGate(problem?: unknown) {
    const { form, input } = gateForm(m, 'pics', (given) => {
      token = given;
      remembered.set(given);
      void render();
    }, problem);
    show(form);
    if (problem) input.focus();
  }

  // --- The tooltip -------------------------------------------------------------------------------------------------

  let tip: HTMLElement | null = null;
  let tipOwner: HTMLElement | null = null;
  let tipId = 0;
  // On a tap, Chromium (at least on some platforms) synthesizes a trailing mouseleave shortly after the
  // compatibility click it fires for touch input — there is no real hover to leave. Without this, that
  // synthetic leave closes the tooltip the tap itself just opened, before its content ever arrives. A click
  // (real or tap-synthesized) is followed by a short window where the owning item's own mouseleave is ignored;
  // every other way to close it (Escape, tapping/clicking elsewhere, moving focus away) is unaffected.
  let suppressLeaveUntil = 0;
  const LEAVE_GRACE_MS = 500;

  function hideTip() {
    tipOwner?.querySelector('a')?.removeAttribute('aria-describedby');
    tip?.remove();
    tip = null;
    tipOwner = null;
  }

  function tipContent(d: Details) {
    const rows: [string, string][] = [
      [m('pics.camera'), d.cameraLine ?? m('pics.noCamera')],
      [m('pics.size'), `${formatBytes(d.size, locale)} (${formatExactBytes(d.size, locale, m('pics.bytes'))})`],
      [m('pics.copyright'), d.copyright ?? m('pics.noCopyright')],
    ];
    if (d.artist) rows.push([m('pics.artist'), d.artist]);
    return el('dl', { class: 'pic-facts' }, ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]));
  }

  /**
   * The picture at the start of a row: the site's own small public copy of the photo (from the page's data,
   * never from the API and never the private original), or a note where the site has none. The row's text
   * already names the photo, so the picture is decorative for screen readers.
   */
  function thumbnail(id: string) {
    const photo = known[id];
    if (!photo?.thumb) return el('span', { class: 'pic-thumb pic-thumb-none' }, el('span', { text: m('pics.noThumbnail') }));
    const { width, height } = thumbSize(photo.thumb.width, photo.thumb.height);
    return el('span', { class: 'pic-thumb' }, el('img', { attrs: { src: photo.thumb.src, width: String(width), height: String(height), alt: '', loading: 'lazy', decoding: 'async' } }));
  }

  function showTip(item: HTMLElement, id: string) {
    if (tipOwner === item) return;
    hideTip();
    const link = item.querySelector('a')!;
    const node = el('div', { class: 'pic-tip', attrs: { role: 'tooltip', id: `pic-tip-${++tipId}` } }, el('p', { class: 'pic-tip-note', text: m('pics.loading') }));
    tip = node;
    tipOwner = item;
    link.setAttribute('aria-describedby', node.id);
    item.append(node);
    let request = details.get(id);
    if (!request) {
      request = api<Details>(`/pics/${encodeURIComponent(id)}`);
      details.set(id, request);
      request.catch(() => details.delete(id)); // a failed lookup can be tried again
    }
    request.then(
      (d) => tip === node && node.replaceChildren(tipContent(d)),
      (error) => tip === node && node.replaceChildren(el('p', { class: 'pic-tip-note', text: error instanceof ApiError && error.kind === 'notFound' ? m('pics.failed') : errorMessage(m, error) }))
    );
  }

  // --- The count and the Upload / Remove buttons ---------------------------------------------------------------

  // Like the removal code, the New Photo form is loaded when it is first needed (it is only ever used on the owner's computer).
  let formModule: typeof import('./photo-form') | null = null;

  /** Opens the New Photo form above the list (a second press just goes back to it). */
  async function openForm() {
    const open = formHost.querySelector<HTMLElement>('input');
    if (open) return open.focus();
    formModule ??= await import('./photo-form');
    if (formHost.firstElementChild) return; // a second press opened it while the code was loading
    formHost.append(
      formModule.photoForm({
        m,
        categories,
        // The photo is now in the bucket: look at the list again (the form stays, showing what was written).
        onAdded: () => {
          details.clear();
          void render();
        },
        onClose: closeForm,
      })
    );
  }

  function closeForm() {
    formHost.replaceChildren();
    container.querySelector<HTMLElement>('[data-action="upload"]')?.focus();
  }

  /** "<count> original photos" with the two action buttons across from it, at the right. */
  function summary(count: number) {
    const status = el('p', { class: 'pics-status', attrs: { role: notice?.alert ? 'alert' : 'status' } });
    if (notice) status.textContent = notice.text;
    const button = (kind: 'upload' | 'remove', glyph: 'upload' | 'trash') => {
      const node = el('button', { class: 'results-button pics-action', attrs: { type: 'button', 'data-action': kind } }, icon(glyph), el('span', { text: m(`pics.${kind}`) }));
      if (kind === 'remove') node.setAttribute('aria-pressed', String(removing));
      // Upload Photos opens the New Photo form; Remove Photos shows a checkbox on every photo (see photo-remove.ts).
      node.addEventListener('click', () => {
        notice = null;
        if (kind === 'upload') {
          status.textContent = '';
          void openForm();
        } else {
          void toggleRemoval(status);
        }
      });
      return node;
    };
    const actions = el('div', { class: 'pics-actions' }, button('upload', 'upload'), button('remove', 'trash'));
    return [el('div', { class: 'pics-summary' }, el('p', { class: 'results-count', text: m('pics.count', { count }) }), actions), status];
  }

  // --- Removing photos in bulk ---------------------------------------------------------------------------------------------

  /** Remove Photos: shows the checkboxes (once the local photo service, which does the deleting, is known to be there), or hides them. */
  async function toggleRemoval(status: HTMLElement) {
    if (deleting) return;
    if (removing) return stopRemoval();
    status.textContent = m('pics.removal.checking');
    removal ??= await import('./photo-remove');
    if (!(await removal.serviceAvailable())) {
      status.textContent = m('pics.removal.unavailable');
      return;
    }
    removing = true;
    selected.clear();
    paint();
    container.querySelector<HTMLInputElement>('.pic-check')?.focus();
  }

  function stopRemoval() {
    removing = false;
    selected.clear();
    paint();
    container.querySelector<HTMLElement>('[data-action="remove"]')?.focus();
  }

  /** The removal is over (or failed): say what happened, and look at the list again. */
  function removalDone(outcome: RemoveResult[] | Error) {
    deleting = false;
    removing = false;
    selected.clear();
    if (outcome instanceof Error) {
      notice = { text: m('pics.removal.requestFailed', { message: outcome.message || m('pics.removal.unreachable') }), alert: true };
    } else {
      const done = outcome.filter((r) => !r.error).length;
      const failures = outcome.filter((r) => r.error).map((r) => m('pics.removal.failed', { title: `${listing?.rows.find((row) => row.id === r.id)?.title ?? r.id} (${r.id})`, message: r.error ?? '' }));
      notice = { text: [done ? m(done === 1 ? 'pics.removal.doneOne' : 'pics.removal.done', { count: done }) : '', ...failures].filter(Boolean).join(' '), alert: failures.length > 0 };
    }
    details.clear();
    void render();
  }

  // --- The list -------------------------------------------------------------------------------------------------------------

  async function renderList(run: number) {
    const fetched = await api<{ photos: Original[]; complete: boolean }>('/pics');
    if (run !== generation) return;
    listing = { rows: joinPhotos(fetched.photos, known, locale), complete: fetched.complete };
    for (const id of [...selected]) if (!listing.rows.some((row) => row.id === id)) selected.delete(id); // a photo that has gone cannot stay chosen
    // A fresh look starts at the first page, but never hides a row that is still ticked.
    const needed = Math.max(0, ...[...selected].map((id) => listing!.rows.findIndex((row) => row.id === id) + 1));
    shownCount = rowsToShow(listing.rows.length, needed, PICS_PAGE_SIZE);
    paint();
    displayed = true;
  }

  /** One row of the list: thumbnail, title, category, key, the tooltip's triggers and (while removing) its checkbox. */
  function buildRow(row: PicRow) {
    const link = el('a', { class: 'pic-link', attrs: { href: `#${PICS_TAB}` } },
      thumbnail(row.id),
      el('span', { class: 'pic-title', text: row.title ?? row.id }),
      row.category ? el('span', { class: 'pic-category', text: row.category }) : el('span', { class: 'pic-category', text: m('pics.notOnSite') }),
      el('span', { class: 'pic-key', text: row.key }));
    const item = el('li', { class: 'pic' }, link);
    if (removing) {
      const box = el('input', { class: 'pic-check', attrs: { type: 'checkbox', 'data-id': row.id, 'aria-label': m('pics.removal.select', { title: `${row.title ?? row.id} (${row.id})` }) } });
      box.checked = selected.has(row.id);
      item.classList.toggle('selected', box.checked);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(row.id);
        else selected.delete(row.id);
        item.classList.toggle('selected', box.checked);
        bar?.update();
      });
      item.prepend(el('label', { class: 'pic-select' }, box));
    }
    item.addEventListener('mouseenter', () => showTip(item, row.id));
    item.addEventListener('mouseleave', () => {
      if (item === tipOwner && Date.now() < suppressLeaveUntil) return;
      hideTip();
    });
    link.addEventListener('focus', () => showTip(item, row.id));
    // A tap or click opens the tooltip too (touch screens have no hover); the link goes nowhere.
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showTip(item, row.id);
      suppressLeaveUntil = Date.now() + LEAVE_GRACE_MS;
    });
    item.addEventListener('focusout', (event) => {
      if (!item.contains(event.relatedTarget as Node | null)) hideTip();
    });
    return item;
  }

  // --- Paging: a page of rows at a time -----------------------------------------------------------------------------------------

  /** Draws the next page below the rows already there (the observer calls this when the end of the list comes into view). */
  function loadMore() {
    const list = root.querySelector<HTMLElement>('.pics-list');
    if (!listing || !list || shownCount >= listing.rows.length) return;
    const from = shownCount;
    shownCount = Math.min(listing.rows.length, shownCount + PICS_PAGE_SIZE);
    list.append(...listing.rows.slice(from, shownCount).map(buildRow));
    bar?.update(); // "Select the 20 shown" now says 40
    updateMore();
  }

  /** Keeps the "Showing X of Y" note and the button true; once everything is shown the button goes and the note says so. */
  function updateMore() {
    pager?.disconnect();
    if (!more || !listing) return;
    const total = listing.rows.length;
    const note = more.querySelector<HTMLElement>('.pics-shown')!;
    const button = more.querySelector('button');
    if (shownCount >= total) {
      const hadFocus = button !== null && button === document.activeElement;
      button?.remove();
      note.textContent = m('pics.paging.all', { total });
      if (hadFocus) {
        note.tabIndex = -1; // the button that was pressed is gone: keep the keyboard here rather than lose it
        note.focus();
      }
      more = null; // nothing left to watch for
      return;
    }
    note.textContent = m('pics.paging.shown', { shown: shownCount, total });
    button!.textContent = m('pics.paging.more', { count: Math.min(PICS_PAGE_SIZE, total - shownCount) });
    // Watching again reports the end of the list at once if it is still in view, so a tall screen fills up page by page.
    pager?.observe(more);
  }

  /** "Showing 20 of 87 photos" with a Show more button (the way to load more without scrolling, and for the keyboard). Only for lists longer than a page. */
  function moreControls(): HTMLElement | null {
    pager?.disconnect();
    pager = null;
    more = null;
    if (!listing || listing.rows.length <= PICS_PAGE_SIZE) return null;
    more = el('div', { class: 'pics-more' }, el('p', { class: 'pics-shown', attrs: { role: 'status' } }), el('button', { class: 'results-button', attrs: { type: 'button', 'data-action': 'more' } }));
    more.querySelector('button')!.addEventListener('click', loadMore);
    if (typeof IntersectionObserver !== 'undefined') {
      pager = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && loadMore(), { rootMargin: '400px 0px' });
    }
    return more;
  }

  /** Draws the counter, the buttons, the removal bar (while removing) and the first pages of the list from the last listing. */
  function paint() {
    hideTip();
    if (!listing) return;
    const { rows, complete } = listing;
    if (!rows.length) {
      removing = false;
      bar = null;
      show(...summary(0), el('p', { class: 'results-empty', text: m('pics.empty') }));
      return;
    }
    bar = removing && removal
      ? removal.removalBar({
          m,
          rows,
          selected,
          shown: () => shownCount,
          onSelectAll: (all) => {
            selected.clear();
            if (all) for (const row of rows.slice(0, shownCount)) selected.add(row.id);
            for (const box of root.querySelectorAll<HTMLInputElement>('.pic-check')) {
              box.checked = selected.has(box.dataset.id ?? '');
              box.closest('.pic')?.classList.toggle('selected', box.checked);
            }
            bar?.update();
          },
          onCancel: stopRemoval,
          perform: (photos) => {
            deleting = true;
            return removal!.removePhotos(photos);
          },
          onDone: removalDone,
        })
      : null;
    show(
      ...summary(rows.length),
      bar?.element ?? null,
      complete ? null : el('p', { class: 'results-error', text: m('pics.incomplete') }),
      el('ul', { class: `pics-list${removing ? ' selecting' : ''}` }, ...rows.slice(0, shownCount).map(buildRow)),
      moreControls()
    );
    updateMore();
  }

  async function render() {
    if (deleting) return; // a removal is under way: it redraws the list itself when it is over
    const run = ++generation;
    hideTip();
    pager?.disconnect(); // the list about to be replaced is not watched any more
    more = null;
    if (!token) {
      displayed = false;
      return renderGate();
    }
    displayed = false;
    root.setAttribute('aria-busy', 'true');
    show(el('p', { class: 'results-loading', text: m('loading') }));
    try {
      await renderList(run);
    } catch (error) {
      if (run !== generation) return;
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'notConfigured')) {
        token = '';
        remembered.set('');
        renderGate(error);
      } else {
        show(el('p', { class: 'results-error', text: errorMessage(m, error), attrs: { role: 'alert' } }));
      }
    }
  }

  // Escape closes the tooltip without moving focus (WCAG: dismissible).
  document.addEventListener('keydown', (event) => event.key === 'Escape' && tip && hideTip());
  // Clicking elsewhere closes a tooltip opened by a tap.
  document.addEventListener('click', (event) => tipOwner && !tipOwner.contains(event.target as Node) && hideTip());

  // Nothing is requested while the tab is hidden; showing it loads the list once.
  const sync = () => {
    if (panel.hidden) return hideTip();
    if (token ? !displayed && !root.querySelector('.results-loading, .results-error') : !root.querySelector('form')) void render();
  };
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    displayed = false;
    generation++;
    details.clear();
    hideTip();
    formHost.replaceChildren(); // signing out (or in as someone else) closes the form
    removing = false; // ...and the removal checkboxes
    selected.clear();
    notice = null;
    listing = null;
    if (!panel.hidden) void render();
    else root.replaceChildren();
  });
  // The page's Refresh button reloads the list (and looks every file up again) when this tab is showing.
  window.addEventListener(REFRESH_EVENT, () => {
    if (panel.hidden || !token) return;
    details.clear();
    void render();
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  // Look once the tabs have applied the address (a link to another tab must not load the list).
  setTimeout(sync, 0);
}
