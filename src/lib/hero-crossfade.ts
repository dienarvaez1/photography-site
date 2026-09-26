// The home hero's slow crossfade between a few featured photos. `prefers-reduced-motion` isn't
// handled by the blanket CSS rule this time (that rule collapses transition *durations*, but a
// crossfade that's still silently cycling every few seconds — just instantly — would be its own
// kind of motion) so it's checked directly here: reduced motion means the first photo simply stays
// put.

let currentStop: (() => void) | null = null;

export function initHeroCrossfade(root: Document | HTMLElement = document) {
  // A previous page's interval, if any, needs to stop before this one starts — see the fuller
  // explanation of why this can run more than once per page load in Header.astro's script.
  currentStop?.();
  currentStop = null;

  const images = Array.from(root.querySelectorAll<HTMLImageElement>('.hero-media img'));
  if (images.length < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let index = 0;
  const id = window.setInterval(() => {
    images[index].classList.remove('is-active');
    index = (index + 1) % images.length;
    images[index].classList.add('is-active');
  }, 6000);

  currentStop = () => window.clearInterval(id);
}
