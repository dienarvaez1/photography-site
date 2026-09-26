// `document.referrer` is set once, by the browser, for a real top-level navigation — and never
// updates for an Astro view-transition swap, since no new document actually loads. Anything that
// needs "did the visitor just navigate here from elsewhere on this site" (see GeoRedirect, which
// uses this to tell a visitor arriving fresh from a same-site link click apart from one arriving
// from outside it) has no other way to know once a click has been client-routed instead of causing
// a real navigation. This tracks it ourselves, in sessionStorage, from BaseLayout's script (present
// on every page, so it can record the page being left before each transition's swap happens).

const KEY = 'astro:last-path';

/** Called once, from BaseLayout: records the page being left, right before each transition. */
export function trackTransitionOrigin() {
  document.addEventListener('astro:before-preparation', (event) => {
    try {
      sessionStorage.setItem(KEY, event.from.href);
    } catch {
      // Storage unavailable: effectiveReferrer() below just falls back to document.referrer.
    }
  });
}

/**
 * The effective referrer for a same-site-navigation check: the real one when the browser set it
 * (arriving from elsewhere, or the very first page of a session), otherwise whichever page a
 * client-side transition last recorded leaving.
 */
export function effectiveReferrer(): string {
  if (document.referrer) return document.referrer;
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
