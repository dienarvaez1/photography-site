// Tells the site which page was opened, and which photo, for the access log (src/endpoints/access.ts). Only the
// path is sent, never the query or anything typed; the time and the address are added by the Worker. Fire and forget:
// a visit is never slowed down or broken by this, and `keepalive` lets it finish even if the visitor leaves.
const ENDPOINT = '/api/access';

function send(body: object) {
  try {
    void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch {
    // no fetch, or the page is going away: nothing to record
  }
}

/** This page was opened (a load, a view-transition navigation, or the gallery switching category). */
export const recordPageView = () => send({ page: location.pathname, event: 'view' });

/** A photo was opened in the lightbox (or the lightbox moved on to it). */
export const recordPhotoView = (id: string, category: string) => send({ page: location.pathname, event: 'photo', photo: { id, category } });

/**
 * The gallery's own scripts report through DOM events instead of importing this module, which would make it a
 * separate file every gallery page loads on top of its scripts' budget (performance.feature):
 *   document.dispatchEvent(new CustomEvent('access:view'))                                  a page shown without a load
 *   document.dispatchEvent(new CustomEvent('access:photo', { detail: { id, category } }))   a photo shown in the lightbox
 * Only the layout's script (on every page, once per tab) imports this and listens.
 */
export function listenForAccessEvents() {
  document.addEventListener('access:view', recordPageView);
  document.addEventListener('access:photo', (event) => {
    const { id, category } = (event as CustomEvent<{ id?: unknown; category?: unknown }>).detail ?? {};
    if (typeof id === 'string' && typeof category === 'string') recordPhotoView(id, category);
  });
}
