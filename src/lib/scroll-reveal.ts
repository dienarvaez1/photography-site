// Progressive-enhancement scroll reveal: elements marked [data-reveal] fade/slide into place as
// they enter the viewport. Without this script (JS disabled, or it fails to run) they're simply
// visible from the start, since the "hidden" state is only ever applied here — never in the
// server-rendered HTML — so there's nothing to fall back from.
//
// Only content that starts out of sight is hidden, and it is hidden without a fade: the script runs after the page has
// loaded and painted, so hiding a section that is already on screen would make it visibly fade OUT (then back in) —
// a flash every visitor saw, and a half-transparent moment that failed the accessibility audit's colour-contrast
// check whenever the audit happened to look mid-fade (it did, on GitHub's slower runners).
//
// `prefers-reduced-motion` needs no special handling here: global.css's blanket reduced-motion
// rule already forces every transition to ~0s, so the reveal still happens, just instantly.

let currentObserver: IntersectionObserver | null = null;

export function initScrollReveal(root: Document | HTMLElement = document) {
  // A page without any [data-reveal] elements, or a repeat run against a page that replaced them,
  // starts from a clean slate rather than piling up observers across navigations.
  currentObserver?.disconnect();
  currentObserver = null;

  if (!('IntersectionObserver' in window)) return;

  const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (!targets.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('is-reveal-hidden');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
  );

  for (const el of targets) {
    const { top, bottom } = el.getBoundingClientRect();
    if (top < window.innerHeight && bottom > 0) continue; // already (even partly) on screen: leave it be
    // Straight to hidden, no fade-out: the transition is switched off for this one change, and the forced layout
    // (offsetHeight) makes the browser apply it before the transition comes back.
    el.style.transition = 'none';
    el.classList.add('is-reveal-hidden');
    void el.offsetHeight;
    el.style.transition = '';
    observer.observe(el);
  }

  currentObserver = observer;
}
