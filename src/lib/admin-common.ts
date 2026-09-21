// Pieces shared by the Admin page's viewers (Test Results and Pics Viewer): the admin token kept for the
// browser tab, calls to the API with it, the sign-in form, and building DOM from text (never from HTML).
import { ADMIN_IDLE_TIMEOUT_MINUTES } from '../config/admin';
import { formatMessage } from './results-view';

export const TOKEN_KEY = 'admin-token';
/** Fired on `window` whenever the remembered token changes, so every viewer on the page follows a sign-in or sign-out. */
export const AUTH_EVENT = 'admin-auth-changed';
/** Fired on `window` by the page's Refresh button; the viewer of the tab being shown reloads. */
export const REFRESH_EVENT = 'admin-refresh';

export type ApiErrorKind = 'unauthorized' | 'notConfigured' | 'unreachable' | 'notFound' | 'generic';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status = 0) {
    super(kind);
  }
}

const SEEN_KEY = 'admin-token-seen';
const TIMED_OUT_KEY = 'admin-timed-out';
export const IDLE_LIMIT_MS = ADMIN_IDLE_TIMEOUT_MINUTES * 60 * 1000;

export const storage = {
  get: (key: string) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value);
    } catch {
      // not remembered (storage blocked): the copy in memory below still works for this page view
    }
  },
};

// The token, when the person was last there, and whether the last sign-out was the idle timeout. Kept in memory
// (so the timeout works even with storage blocked) and in sessionStorage (so a reload keeps the sign-in, and a
// reload after a long time away finds it expired).
const session = { token: storage.get(TOKEN_KEY) ?? '', seen: Number(storage.get(SEEN_KEY)) || 0, timedOut: storage.get(TIMED_OUT_KEY) === '1', saved: 0 };

export const remembered = {
  /** The token, or '' when there is none or the page was left alone for too long (which signs out). */
  get: () => {
    remembered.expireIfIdle();
    return session.token;
  },
  set: (token: string, { timedOut = false } = {}) => {
    session.token = token;
    session.seen = Date.now();
    session.saved = session.seen;
    session.timedOut = timedOut && !token;
    storage.set(TOKEN_KEY, token || null);
    storage.set(SEEN_KEY, token ? String(session.seen) : null);
    storage.set(TIMED_OUT_KEY, session.timedOut ? '1' : null);
    window.dispatchEvent(new Event(AUTH_EVENT));
  },
  /** The person is here: restart the idle clock (written to storage at most once a second). */
  touch: () => {
    if (!session.token) return;
    session.seen = Date.now();
    if (session.seen - session.saved >= 1000) {
      session.saved = session.seen;
      storage.set(SEEN_KEY, String(session.seen));
    }
  },
  /** Signs out if the person has been away for the idle limit. Returns whether it did. */
  expireIfIdle: () => {
    if (!session.token || Date.now() - session.seen < IDLE_LIMIT_MS) return false;
    remembered.set('', { timedOut: true });
    return true;
  },
  /** Was the last sign-out the idle timeout? (The sign-in form then says so.) */
  timedOut: () => session.timedOut,
};

/** GETs `path` from the API with the token in the Authorization header (and nowhere else). */
export async function apiGet<T>(apiUrl: string, token: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError('unreachable');
  }
  if (response.status === 401) throw new ApiError('unauthorized', 401);
  if (response.status === 503) throw new ApiError('notConfigured', 503);
  if (response.status === 404) throw new ApiError('notFound', 404);
  if (!response.ok) throw new ApiError('generic', response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('generic', response.status);
  }
}

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

/** Line icons for buttons (decorative: the button's text carries the meaning). */
const ICONS: Record<string, string[]> = {
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
};

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-icon': name })) svg.setAttribute(key, value);
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export type Messages = Record<string, any>;

/** Looks up a message by dotted path ("errors.unauthorized") and fills its {placeholders}. */
export function messageReader(messages: Messages) {
  return (path: string, values?: Record<string, string | number>) => formatMessage(path.split('.').reduce<any>((node, key) => node?.[key], messages) ?? path, values);
}

export type Reader = ReturnType<typeof messageReader>;

export const errorMessage = (m: Reader, error: unknown) => m(`errors.${error instanceof ApiError ? error.kind : 'generic'}`, { status: error instanceof ApiError ? error.status : 0 });

/** The token form. `prefix` keeps element ids unique when several viewers each have one on the page. */
export function gateForm(m: Reader, prefix: string, onToken: (token: string) => void, problem?: unknown) {
  const input = el('input', { attrs: { type: 'password', id: `${prefix}-token`, name: 'token', autocomplete: 'off', required: '', spellcheck: 'false' } });
  const submit = el('button', { class: 'results-button primary', text: m('gate.submit'), attrs: { type: 'submit' } });
  const form = el('form', { class: 'results-gate' }, el('p', { text: m('gate.intro') }), el('label', { text: m('gate.label'), attrs: { for: `${prefix}-token` } }), input, submit);
  if (problem) form.append(el('p', { class: 'results-error', text: errorMessage(m, problem), attrs: { role: 'alert' } }));
  else if (remembered.timedOut()) form.prepend(el('p', { class: 'results-notice', text: m('gate.timedOut', { minutes: ADMIN_IDLE_TIMEOUT_MINUTES }), attrs: { role: 'status' } }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = input.value.trim();
    if (!token) return;
    submit.disabled = true;
    submit.textContent = m('gate.checking');
    onToken(token);
  });
  return { form, input };
}
