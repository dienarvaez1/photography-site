// The Admin page's sign-in. Until the admin token has been checked against the results API (GET /auth), the page shows
// only the token box and its button: no tabs, no tab titles, no descriptions. The tabs are hidden in the page's own
// HTML, so they stay hidden without JavaScript too, and are revealed here only once a token has been accepted. A
// signed-in token is kept for the browser tab (admin-common.ts `remembered`); signing out, the idle timeout, or any
// tab finding the token refused clears it, and the page goes back to just the token box.
import { resolveApiUrl } from './results-view';
import { AUTH_EVENT, ApiError, GATE_PROBLEM_EVENT, apiGet, gateForm, messageReader, parseJson, remembered, type Messages } from './admin-common';

export function mountAdminGate(gate: HTMLElement, tabs: HTMLElement) {
  const m = messageReader(parseJson<Messages>(gate.dataset.messages ?? '{}'));
  const apiUrl = resolveApiUrl(gate.dataset.api ?? '', location.search, location.hostname);

  function showGate(problem?: unknown) {
    const { form, input } = gateForm(m, 'admin', (token) => void signIn(token), problem);
    gate.replaceChildren(form);
    gate.hidden = false;
    tabs.hidden = true;
    if (problem) input.focus();
  }

  // (A 404 from /auth means a results API from before this sign-in existed: the token box says to redeploy it, through
  // its own errors.notFound text, not the tabs' "that run was not found". Issue #6.)
  async function signIn(token: string) {
    try {
      await apiGet(apiUrl, token, '/auth');
    } catch (error) {
      showGate(error instanceof ApiError ? error : new ApiError('generic'));
      return;
    }
    remembered.set(token); // every tab follows (AUTH_EVENT), and update() below reveals them
  }

  const update = () => {
    if (remembered.get()) {
      gate.hidden = true;
      gate.replaceChildren();
      tabs.hidden = false;
    } else if (!gate.querySelector('form') || gate.hidden) {
      showGate();
    }
  };
  window.addEventListener(AUTH_EVENT, update);
  // A tab found the token refused (the Worker's secret changed, say): it has signed out; say why.
  window.addEventListener(GATE_PROBLEM_EVENT, (event) => {
    if (!remembered.get()) showGate((event as CustomEvent).detail);
  });
  update();
}
