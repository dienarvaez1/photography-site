// The Refresh and Sign out buttons at the top of the Admin page, across from its title. They serve whichever
// tab is showing: Refresh asks that tab's viewer to reload, Sign out forgets the admin token (which every
// viewer follows). They are only shown while there is a token to sign out of.
import { AUTH_EVENT, REFRESH_EVENT, remembered } from './admin-common';

export function mountAdminActions(container: HTMLElement) {
  const [refresh, signOut] = Array.from(container.querySelectorAll('button'));
  const update = () => {
    container.hidden = !remembered.get();
  };
  refresh.addEventListener('click', () => window.dispatchEvent(new Event(REFRESH_EVENT)));
  signOut.addEventListener('click', () => remembered.set(''));
  window.addEventListener(AUTH_EVENT, update);
  update();
}
