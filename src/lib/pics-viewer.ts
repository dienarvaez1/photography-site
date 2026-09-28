// The Admin page's Pics Viewer. It lists the original photos in the private originals bucket
// (photos/<id>/original.*) through the API and shows, at the right of each file's row, its camera information,
// when it was taken, its file size and copyright (looked up once per file, when its row is first drawn). Each
// row of the list starts with a small thumbnail, the site's
// own public web copy of the photo; the private originals are never fetched or shown: the API only ever
// returns numbers and text. Everything from the API is put on the page as text.
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, gateForm, icon, messageReader, parseJson, remembered, type Child, type Messages } from './admin-common';
import type { FormCategory } from './photo-form';
import type { HeroBackgroundBar, HeroBackgroundResult } from './photo-hero';
import type { RemovalBar, RemoveResult } from './photo-remove';
import type { RecategorizeBar, RecategorizeResult } from './photo-recategorize';
import { serviceAvailable } from './photo-service';
import { PICS_PAGE_SIZE } from '../config/admin';
import { formatBytes, formatExactBytes, formatTakenAt, joinPhotos, rowsToShow, thumbSize, type KnownPhoto, type Original, type PicRow } from './pics-view';
import { resolveApiUrl } from './results-view';

type Details = {
  id: string;
  key: string;
  size: number;
  cameraLine: string | null;
  copyright: string | null;
  artist: string | null;
  takenAt: string | null;
};

export function mountPicsViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-pics-root]')!;
  const messages = parseJson<Messages>(container.dataset.messages ?? '{}');
  const known = parseJson<Record<string, KnownPhoto>>(container.dataset.photos ?? '{}');
  const categories = parseJson<FormCategory[]>(container.dataset.categories ?? '[]');
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
  // Which bulk action's checkboxes are showing, if either — never more than one at once (choosing one cancels the others).
  let mode: 'none' | 'remove' | 'edit' | 'hero' = 'none';
  let bar: RemovalBar | RecategorizeBar | HeroBackgroundBar | null = null;
  // The removal, category-change and hero-background code are each loaded when their button is first pressed
  // (they are only ever used on the owner's computer), so the page's own script stays small.
  let removal: typeof import('./photo-remove') | null = null;
  let recategorization: typeof import('./photo-recategorize') | null = null;
  let heroBg: typeof import('./photo-hero') | null = null;
  let deleting = false; // a removal is under way: nothing may redraw the list until it is over
  let applying = false; // a category change is under way: nothing may redraw the list until it is over
  let settingHero = false; // a hero-background change is under way: nothing may redraw the list until it is over
  const selected = new Set<string>();
  let notice: { text: string; alert: boolean } | null = null; // what the last bulk action did, shown until the next one
  const details = new Map<string, Promise<Details>>(); // one request per photo, however often its row is drawn

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

  // --- Each file's details, at the right of its row --------------------------------------------------------------------

  function factsList(d: Details) {
    // A photo the site lists shows its entry's own `takenAt` (what photos:add, the New Photo form and photos:dates
    // stored in R2); only a file the site has no entry for — or one whose entry has no date — falls back to the date
    // read from the file's EXIF by the API.
    const takenAt = known[d.id]?.takenAt ?? d.takenAt;
    const rows: [string, string][] = [
      [m('pics.camera'), d.cameraLine ?? m('pics.noCamera')],
      [m('pics.taken'), formatTakenAt(takenAt, locale) ?? m('pics.noTaken')],
      [m('pics.size'), `${formatBytes(d.size, locale)} (${formatExactBytes(d.size, locale, m('pics.bytes'))})`],
      [m('pics.copyright'), d.copyright ?? m('pics.noCopyright')],
    ];
    if (d.artist) rows.push([m('pics.artist'), d.artist]);
    return el('dl', { class: 'pic-facts' }, ...rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]));
  }

  /** The details column of one row: "Reading…" until its lookup answers, then the facts (or why there are none). */
  function detailsFor(id: string) {
    const node = el('div', { class: 'pic-details' }, el('p', { class: 'pic-details-note', text: m('pics.loading') }));
    let request = details.get(id);
    if (!request) {
      request = api<Details>(`/pics/${encodeURIComponent(id)}`);
      details.set(id, request);
      request.catch(() => details.delete(id)); // a failed lookup is tried again the next time the row is drawn (Refresh)
    }
    request.then(
      (d) => node.replaceChildren(factsList(d)),
      (error) => node.replaceChildren(el('p', { class: 'pic-details-note', text: error instanceof ApiError && error.kind === 'notFound' ? m('pics.failed') : errorMessage(m, error) }))
    );
    return node;
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

  /** "<count> original photos" with the four action buttons across from it, at the right. */
  function summary(count: number) {
    const status = el('p', { class: 'pics-status', attrs: { role: notice?.alert ? 'alert' : 'status' } });
    if (notice) status.textContent = notice.text;
    const button = (kind: 'upload' | 'edit' | 'remove' | 'hero', glyph: 'upload' | 'edit' | 'trash' | 'image') => {
      const node = el('button', { class: 'results-button pics-action', attrs: { type: 'button', 'data-action': kind } }, icon(glyph), el('span', { text: m(`pics.${kind}`) }));
      if (kind !== 'upload') node.setAttribute('aria-pressed', String(mode === kind));
      // Upload Photos opens the New Photo form; Edit Photos, Remove Photos and Home Background each show a
      // checkbox on every eligible photo (see photo-recategorize.ts, photo-remove.ts and photo-hero.ts) —
      // only one of the three at a time.
      node.addEventListener('click', () => {
        notice = null;
        if (kind === 'upload') {
          status.textContent = '';
          void openForm();
        } else {
          void toggleMode(kind, status);
        }
      });
      return node;
    };
    const actions = el('div', { class: 'pics-actions' }, button('upload', 'upload'), button('edit', 'edit'), button('remove', 'trash'), button('hero', 'image'));
    return [el('div', { class: 'pics-summary' }, el('p', { class: 'results-count', text: m('pics.count', { count }) }), actions), status];
  }

  // --- Editing, removing or setting the home background for photos in bulk ---------------------------------------------------

  const modeKey = { remove: 'removal', edit: 'recategorize', hero: 'background' } as const;

  /** Edit Photos / Remove Photos / Home Background: shows the checkboxes for that action (once the local photo
   *  service is known to be there), switches directly to another one if it was showing, or hides them if it
   *  was already this one. */
  async function toggleMode(kind: 'remove' | 'edit' | 'hero', status: HTMLElement) {
    if (deleting || applying || settingHero) return;
    if (mode === kind) return stopMode();
    status.textContent = m(`pics.${modeKey[kind]}.checking`);
    if (kind === 'remove') removal ??= await import('./photo-remove');
    else if (kind === 'edit') recategorization ??= await import('./photo-recategorize');
    else heroBg ??= await import('./photo-hero');
    if (!(await serviceAvailable())) {
      status.textContent = m(`pics.${modeKey[kind]}.unavailable`);
      return;
    }
    mode = kind;
    selected.clear();
    // Home Background starts with its current members already ticked — the admin can see at a glance
    // what's set and Remove from background right away, rather than having to reconstruct the current
    // set by eye from the badges first. Edit Photos and Remove Photos start empty on purpose (an
    // explicit choice every time), so this is Home Background's own case, not the general rule.
    if (kind === 'hero' && listing) {
      for (const row of listing.rows) if (row.heroBackground) selected.add(row.id);
      // The same "never hide an already-ticked row" rule renderList() applies on every fresh look:
      // a member beyond the first page still needs to be shown, checked, not just present in `selected`.
      const needed = Math.max(0, ...[...selected].map((id) => listing!.rows.findIndex((row) => row.id === id) + 1));
      shownCount = rowsToShow(listing.rows.length, needed, PICS_PAGE_SIZE);
    }
    paint();
    container.querySelector<HTMLInputElement>('.pic-check')?.focus();
  }

  function stopMode() {
    const was = mode;
    mode = 'none';
    selected.clear();
    paint();
    container.querySelector<HTMLElement>(`[data-action="${was}"]`)?.focus();
  }

  /** The removal is over (or failed): say what happened, and look at the list again. */
  function removalDone(outcome: RemoveResult[] | Error) {
    deleting = false;
    mode = 'none';
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

  // --- Changing category in bulk ---------------------------------------------------------------------------------------------

  /** The category change is over (or failed): say what happened (moved, already-there, or the request itself
   *  failing), and look at the list again — every moved photo now shows under its new category. */
  function recategorizeDone(outcome: RecategorizeResult[] | Error) {
    applying = false;
    mode = 'none';
    selected.clear();
    if (outcome instanceof Error) {
      notice = { text: m('pics.recategorize.requestFailed', { message: outcome.message || m('pics.recategorize.unreachable') }), alert: true };
    } else {
      const moved = outcome.filter((r) => r.moved);
      const unchanged = outcome.length - moved.length;
      const categoryLabel = categories.find((c) => c.slug === outcome[0]?.to)?.label ?? outcome[0]?.to ?? '';
      // `known` came from the page's own server-rendered data, a snapshot from whenever this page was
      // loaded — the API's /pics answer never carries a category at all (see thumbnail()'s own comment:
      // the API only ever returns numbers and text about the ORIGINAL, never the site's own view of it),
      // so without this, re-fetching the list after a real move would keep showing every moved photo
      // under its old category until the whole page is reloaded.
      for (const { id, to } of moved) if (known[id]) known[id] = { ...known[id], category: categoryLabel, categorySlug: to };
      const parts = [
        moved.length ? m(moved.length === 1 ? 'pics.recategorize.doneOne' : 'pics.recategorize.done', { count: moved.length, category: categoryLabel }) : '',
        unchanged ? m(unchanged === 1 ? 'pics.recategorize.unchangedOne' : 'pics.recategorize.unchanged', { count: unchanged }) : '',
      ];
      notice = { text: parts.filter(Boolean).join(' '), alert: false };
    }
    details.clear();
    void render();
  }

  // --- Setting the home background in bulk -----------------------------------------------------------------------------------

  /** The hero-background change is over (or failed): say what happened (set, cleared, already-there, or the
   *  request itself failing), and look at the list again — every changed photo now shows its new badge. */
  function heroBackgroundDone(value: boolean, outcome: HeroBackgroundResult[] | Error) {
    settingHero = false;
    mode = 'none';
    selected.clear();
    if (outcome instanceof Error) {
      notice = { text: m('pics.background.requestFailed', { message: outcome.message || m('pics.background.unreachable') }), alert: true };
    } else {
      const changed = outcome.filter((r) => r.changed);
      const unchanged = outcome.length - changed.length;
      // Same reasoning as recategorizeDone: the page's own server-rendered `known` is the only place this
      // badge comes from, so a changed photo needs patching there to show its new state without a reload.
      for (const { id } of changed) if (known[id]) known[id] = { ...known[id], heroBackground: value };
      const parts = [
        changed.length ? m(changed.length === 1 ? (value ? 'pics.background.doneOne' : 'pics.background.clearedOne') : value ? 'pics.background.done' : 'pics.background.cleared', { count: changed.length }) : '',
        unchanged ? m(unchanged === 1 ? 'pics.background.unchangedOne' : 'pics.background.unchanged', { count: unchanged }) : '',
      ];
      notice = { text: parts.filter(Boolean).join(' '), alert: false };
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

  /** One row of the list: thumbnail, then the title, the Home background badge (when set), its category and the file's
   *  key, one under the other; the file's details at the right, and (while a bulk action is showing) its checkbox. */
  function buildRow(row: PicRow) {
    const link = el('div', { class: 'pic-link' },
      thumbnail(row.id),
      el('span', { class: 'pic-title', text: row.title ?? row.id }),
      row.heroBackground ? el('span', { class: 'pic-badges' }, el('span', { class: 'results-badge', text: m('pics.background.badge') })) : null,
      el('span', { class: 'pic-category', text: row.category ?? m('pics.notOnSite') }),
      el('span', { class: 'pic-key', text: row.key }),
      detailsFor(row.id));
    const item = el('li', { class: 'pic' }, link);
    // A checkbox during Remove Photos (any original can be deleted, entry or not); during Edit Photos and
    // Home Background only for a photo the site actually lists (there is no category to move, or entry to
    // flag, otherwise).
    if (mode === 'remove' || ((mode === 'edit' || mode === 'hero') && row.categorySlug !== null)) {
      const box = el('input', { class: 'pic-check', attrs: { type: 'checkbox', 'data-id': row.id, 'aria-label': m(`pics.${modeKey[mode]}.select`, { title: `${row.title ?? row.id} (${row.id})` }) } });
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

  /** Draws the counter, the buttons, the removal or category-change bar (while one is active) and the first pages of the list from the last listing. */
  function paint() {
    if (!listing) return;
    const { rows, complete } = listing;
    if (!rows.length) {
      mode = 'none';
      bar = null;
      show(...summary(0), el('p', { class: 'results-empty', text: m('pics.empty') }));
      return;
    }
    bar =
      mode === 'remove' && removal
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
            onCancel: stopMode,
            perform: (photos) => {
              deleting = true;
              return removal!.removePhotos(photos);
            },
            onDone: removalDone,
          })
        : mode === 'edit' && recategorization
          ? recategorization.recategorizeBar({
              m,
              rows,
              categories,
              selected,
              shown: () => shownCount,
              onSelectAll: (all) => {
                selected.clear();
                if (all) for (const row of rows.slice(0, shownCount)) if (row.categorySlug !== null) selected.add(row.id);
                for (const box of root.querySelectorAll<HTMLInputElement>('.pic-check')) {
                  box.checked = selected.has(box.dataset.id ?? '');
                  box.closest('.pic')?.classList.toggle('selected', box.checked);
                }
                bar?.update();
              },
              onCancel: stopMode,
              perform: (photos, toCategory) => {
                applying = true;
                return recategorization!.changeCategory(photos, toCategory);
              },
              onDone: recategorizeDone,
            })
          : mode === 'hero' && heroBg
            ? heroBg.heroBackgroundBar({
                m,
                rows,
                selected,
                shown: () => shownCount,
                onSelectAll: (all) => {
                  selected.clear();
                  if (all) for (const row of rows.slice(0, shownCount)) if (row.categorySlug !== null) selected.add(row.id);
                  for (const box of root.querySelectorAll<HTMLInputElement>('.pic-check')) {
                    box.checked = selected.has(box.dataset.id ?? '');
                    box.closest('.pic')?.classList.toggle('selected', box.checked);
                  }
                  bar?.update();
                },
                onCancel: stopMode,
                perform: (photos, value) => {
                  settingHero = true;
                  return heroBg!.setHeroBackground(photos, value);
                },
                onDone: heroBackgroundDone,
              })
            : null;
    show(
      ...summary(rows.length),
      bar?.element ?? null,
      complete ? null : el('p', { class: 'results-error', text: m('pics.incomplete') }),
      el('ul', { class: `pics-list${mode !== 'none' ? ` selecting ${mode}` : ''}` }, ...rows.slice(0, shownCount).map(buildRow)),
      moreControls()
    );
    updateMore();
  }

  async function render() {
    if (deleting || applying || settingHero) return; // a bulk action is under way: it redraws the list itself when it is over
    const run = ++generation;
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

  // Nothing is requested while the tab is hidden; showing it loads the list once.
  const sync = () => {
    if (panel.hidden) return;
    if (token ? !displayed && !root.querySelector('.results-loading, .results-error') : !root.querySelector('form')) void render();
  };
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    displayed = false;
    generation++;
    details.clear();
    formHost.replaceChildren(); // signing out (or in as someone else) closes the form
    mode = 'none'; // ...and any bulk-action checkboxes
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
