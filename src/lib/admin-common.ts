// Pieces shared by the Admin page's viewers (Test Results and Pics Viewer): the admin token kept for the
// browser tab, calls to the API with it, the sign-in form, and building DOM from text (never from HTML).
import { formatMessage } from './results-view';

export const TOKEN_KEY = 'admin-token';
/** Fired on `window` whenever the remembered token changes, so every viewer on the page follows a sign-in or sign-out. */
export const AUTH_EVENT = 'admin-auth-changed';

export type ApiErrorKind = 'unauthorized' | 'notConfigured' | 'unreachable' | 'notFound' | 'generic';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status = 0) {
    super(kind);
  }
}

// Storage can be blocked (private windows, site settings); the token then just isn't remembered.
export const remembered = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (token: string) => {
    try {
      token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // not remembered
    }
    window.dispatchEvent(new Event(AUTH_EVENT));
  },
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
