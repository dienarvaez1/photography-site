// Progressive-enhancement scroll reveal: elements marked [data-reveal] fade/slide into place as
// they enter the viewport. Without this script (JS disabled, or it fails to run) they're simply
// visible from the start, since the "hidden" state is only ever applied here — never in the
// server-rendered HTML — so there's nothing to fall back from.
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
    el.classList.add('is-reveal-hidden');
    observer.observe(el);
  }

  currentObserver = observer;
}
