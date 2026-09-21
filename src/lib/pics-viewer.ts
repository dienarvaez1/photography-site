// The Admin page's Pics Viewer. It lists the original photos in the private originals bucket
// (photos/<id>/original.*) through the API and, when a file is hovered or focused, shows a tooltip with
// its camera information, file size and copyright. Each row of the list shows a small thumbnail, the site's
// own public web copy of the photo; the private originals are never fetched or shown: the API only ever
// returns numbers and text. Everything from the API is put on the page as text.
import { AUTH_EVENT, ApiError, apiGet, el, errorMessage, gateForm, messageReader, remembered, type Child, type Messages } from './admin-common';
import { PICS_TAB, formatBytes, formatExactBytes, joinPhotos, thumbSize, type KnownPhoto, type Original } from './pics-view';
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
  const locale = container.dataset.locale ?? 'en';
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);
  const m = messageReader(messages);

  let token = remembered.get();
  let generation = 0;
  let displayed = false; // is the list on screen?
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

  function signOut() {
    token = '';
    displayed = false;
    generation++;
    details.clear();
    remembered.set('');
    renderGate();
  }

  const toolbar = () => {
    const refresh = el('button', { class: 'results-button', text: m('refresh'), attrs: { type: 'button' } });
    const out = el('button', { class: 'results-button', text: m('signOut'), attrs: { type: 'button' } });
    refresh.addEventListener('click', () => {
      details.clear();
      void render();
    });
    out.addEventListener('click', signOut);
    return el('div', { class: 'results-toolbar' }, refresh, out);
  };

  // --- The tooltip -------------------------------------------------------------------------------------------------

  let tip: HTMLElement | null = null;
  let tipOwner: HTMLElement | null = null;
  let tipId = 0;

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

  // --- The list -------------------------------------------------------------------------------------------------------------

  async function renderList(run: number) {
    const listing = await api<{ photos: Original[]; complete: boolean }>('/pics');
    if (run !== generation) return;
    const bar = toolbar();
    if (!listing.photos.length) {
      show(bar, el('p', { class: 'results-empty', text: m('pics.empty') }));
      return;
    }
    const rows = joinPhotos(listing.photos, known, locale);
    const items = rows.map((row) => {
      const link = el('a', { class: 'pic-link', attrs: { href: `#${PICS_TAB}` } },
        thumbnail(row.id),
        el('span', { class: 'pic-title', text: row.title ?? row.id }),
        row.category ? el('span', { class: 'pic-category', text: row.category }) : el('span', { class: 'pic-category', text: m('pics.notOnSite') }),
        el('span', { class: 'pic-key', text: row.key }));
      const item = el('li', { class: 'pic' }, link);
      item.addEventListener('mouseenter', () => showTip(item, row.id));
      item.addEventListener('mouseleave', hideTip);
      link.addEventListener('focus', () => showTip(item, row.id));
      // A tap or click opens the tooltip too (touch screens have no hover); the link goes nowhere.
      link.addEventListener('click', (event) => {
        event.preventDefault();
        showTip(item, row.id);
      });
      item.addEventListener('focusout', (event) => {
        if (!item.contains(event.relatedTarget as Node | null)) hideTip();
      });
      return item;
    });
    show(
      bar,
      el('p', { class: 'results-count', text: m('pics.count', { count: rows.length }) }),
      listing.complete ? null : el('p', { class: 'results-error', text: m('pics.incomplete') }),
      el('ul', { class: 'pics-list' }, ...items)
    );
    displayed = true;
  }

  async function render() {
    const run = ++generation;
    hideTip();
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
        show(toolbar(), el('p', { class: 'results-error', text: errorMessage(m, error), attrs: { role: 'alert' } }));
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
    if (!panel.hidden) void render();
    else root.replaceChildren();
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  // Look once the tabs have applied the address (a link to another tab must not load the list).
  setTimeout(sync, 0);
}
