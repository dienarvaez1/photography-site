// Signs the Admin page out when nobody has touched it for ADMIN_IDLE_TIMEOUT_MINUTES (src/config/admin.ts).
// Any click, key press, pointer movement, scroll or touch counts as being there; requests the page makes by
// itself do not. The clock is checked every second, and when the tab comes back to the front, because a
// background tab's timers are slowed down by the browser.
import { remembered } from './admin-common';

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart', 'focusin'] as const;

export function mountIdleTimeout() {
  for (const type of ACTIVITY) window.addEventListener(type, () => remembered.touch(), { passive: true, capture: true });
  const check = () => void remembered.expireIfIdle();
  setInterval(check, 1000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  check(); // a page loaded after the limit has already passed
}
