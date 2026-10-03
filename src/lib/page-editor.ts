// The page editor: the Admin, signed in (the Admin page's token, kept for this browser tab) on the dev box, changes a
// page's headings and descriptions in place and saves them in both languages. Loaded only by dev-box builds
// (BaseLayout's loader), and only on pages that mark their editable text with data-edit-key.
//
// Update: the changed texts go to the results API's POST /translate (Workers AI) for the site's other language, then
// both languages go to the dev server's /__page-text/save (scripts/lib/page-text-form.mjs), which writes src/i18n/*.json.
// Publishing is a commit and a deploy, as for any change to the site's source.
import { RESULTS_API_URL } from '../config/results';
import { API_KEY, remembered, storage } from './admin-common';
import { formatMessage, resolveApiUrl } from './results-view';

type Locale = 'en' | 'es';
type Messages = {
  label: string;
  edit: string;
  update: string;
  cancel: string;
  loading: string;
  hint: string;
  translating: string;
  saving: string;
  saved: string;
  nothingChanged: string;
  languages: Record<Locale, string>;
  errors: Record<'noService' | 'notDevBox' | 'unauthorized' | 'translationFailed' | 'unreachable' | 'generic', string>;
};
type Reply = { texts?: Record<string, unknown>; message?: string; error?: string };
type Field = { element: HTMLElement; key: string; original: string; input: HTMLTextAreaElement };

const SERVICE = '/__page-text/';
// Its own styles, added when it loads: the pages that never load it (every page off the dev box) carry none. A bar in
// the corner, and the page's headings and descriptions turned into text boxes that look like them, outlined in gold;
// while editing, the category page's filter can't swap the text being edited.
const STYLES = [
  `.page-editor-root { position: fixed; right: clamp(var(--space-2), 8vw, var(--space-6)); bottom: clamp(var(--space-2), 6vh, var(--space-5)); z-index: 60; max-width: min(28rem, calc(100vw - var(--space-2) - clamp(var(--space-2), 8vw, var(--space-6)))); }`,
  `.page-editor { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-1); padding: var(--space-1) var(--space-2); background: var(--bg-elevated); border: 1px solid var(--accent); border-radius: var(--radius); box-shadow: 0 6px 24px rgb(0 0 0 / 0.5); }`,
  `.page-editor .btn { min-height: 44px; font-family: inherit; font-size: var(--control-text); letter-spacing: normal; }`,
  // The site's .btn sets a display, which would otherwise beat the hidden attribute: only the buttons for this moment show.
  `.page-editor [hidden] { display: none; }`,
  `.page-editor-status { flex: 1 1 100%; margin: 0; font-size: 0.85rem; color: var(--fg-muted); }`,
  `.page-editor-status:empty { display: none; }`,
  `.page-editor-status[data-kind='error'] { color: #ff8a80; }`,
  `.page-editor-status[data-kind='done'] { color: var(--accent); }`,
  `.page-editor-field { display: block; width: 100%; margin: 0 0 var(--space-2); padding: 0.25rem 0.4rem; background: color-mix(in srgb, var(--accent) 8%, transparent); border: 1px dashed var(--accent); border-radius: var(--radius); resize: vertical; overflow: hidden; }`,
  `.page-editor-field:focus { outline: 2px solid var(--accent); outline-offset: 2px; }`,
  `.page-editing .category-filter { pointer-events: none; opacity: 0.5; }`,
  // In edit mode the controls turn red, so it is plain that the page is being edited.
  `.page-editor.is-editing { --edit-red: #e5484d; border-color: var(--edit-red); box-shadow: 0 0 0 3px color-mix(in srgb, var(--edit-red) 35%, transparent), 0 6px 24px rgb(0 0 0 / 0.5); }`,
  `.page-editor.is-editing .btn { border-color: var(--edit-red); color: #ffd5d6; }`,
  `.page-editor.is-editing .btn-primary { background: #c62a2f; border-color: #c62a2f; color: #fff; }`,
  `.page-editor.is-editing .btn:not(:disabled):hover { background: color-mix(in srgb, var(--edit-red) 30%, transparent); box-shadow: inset 0 -3px 0 var(--edit-red); color: #fff; }`,
  `.page-editor.is-editing .btn-primary:not(:disabled):hover { background: #a91f24; }`,
  `.page-editor.is-editing .page-editor-status:not([data-kind='error']) { color: #ffd5d6; }`,
  `.page-editing .page-editor-field { border-color: #e5484d; background: color-mix(in srgb, #e5484d 8%, transparent); }`,
  `.page-editing .page-editor-field:focus { outline-color: #e5484d; }`,
].join('\n');

const EDITING_CLASS = 'page-editing';

/** This page's own `?api=` override, else where the Admin page signed in, else the real API. */
function apiUrl(): string {
  const own = resolveApiUrl(RESULTS_API_URL, location.search, location.hostname);
  return own !== RESULTS_API_URL.replace(/\/+$/, '') ? own : (storage.get(API_KEY) ?? own);
}

class EditorError extends Error {}

async function readJson(response: Response): Promise<Reply | null> {
  if (!response.headers.get('Content-Type')?.includes('application/json')) return null;
  try {
    return (await response.json()) as Reply;
  } catch {
    return null;
  }
}

/** Grows a text box to fit what is in it, so editing looks like the text it replaces. */
function fit(input: HTMLTextAreaElement) {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + 2}px`;
}

/** Puts saved text back into the page: paragraphs for a list, and the element's own link for a {placeholder}. */
function render(element: HTMLElement, text: string) {
  if (element.dataset.editKind === 'paragraphs') {
    element.replaceChildren(...text.split(/\n\s*\n/).filter((p) => p.trim()).map((p) => Object.assign(document.createElement('p'), { textContent: p.trim() })));
    return;
  }
  const link = element.querySelector('a');
  const parts = text.split(/(\{[A-Za-z]+\})/);
  element.replaceChildren(...parts.filter(Boolean).map((part) => (/^\{[A-Za-z]+\}$/.test(part) && link ? link.cloneNode(true) : document.createTextNode(part))));
}

export function mountPageEditor(root: HTMLElement) {
  const messages = JSON.parse(root.dataset.messages ?? '{}') as Messages;
  const locale: Locale = document.documentElement.lang === 'es' ? 'es' : 'en';
  const other: Locale = locale === 'es' ? 'en' : 'es';
  let fields: Field[] = [];
  let busy = false;

  if (!document.getElementById('page-editor-styles')) document.head.append(Object.assign(document.createElement('style'), { id: 'page-editor-styles', textContent: STYLES }));
  const bar = document.createElement('div');
  bar.className = 'page-editor';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', messages.label);
  const editButton = Object.assign(document.createElement('button'), { type: 'button', className: 'btn page-editor-edit', textContent: messages.edit });
  const updateButton = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-primary', textContent: messages.update, hidden: true });
  const cancelButton = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: messages.cancel, hidden: true });
  const status = Object.assign(document.createElement('p'), { className: 'page-editor-status' });
  status.setAttribute('role', 'status');
  bar.append(status, editButton, updateButton, cancelButton);
  root.replaceChildren(bar);

  const say = (text: string, kind: 'info' | 'error' | 'done' = 'info') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    for (const button of [editButton, updateButton, cancelButton]) button.disabled = value;
  };

  function leave() {
    for (const { element, input } of fields) {
      input.remove();
      element.hidden = false;
    }
    fields = [];
    document.body.classList.remove(EDITING_CLASS);
    bar.classList.remove('is-editing');
    editButton.hidden = false;
    updateButton.hidden = cancelButton.hidden = true;
  }

  async function enter() {
    const elements = [...document.querySelectorAll<HTMLElement>('[data-edit-key]')].filter((el) => el.offsetParent !== null || el.getClientRects().length);
    if (!elements.length) return;
    setBusy(true);
    say(messages.loading);
    try {
      const keys = elements.map((el) => el.dataset.editKey!).join(',');
      let response: Response;
      try {
        response = await fetch(`${SERVICE}status?keys=${encodeURIComponent(keys)}`, { headers: { Accept: 'application/json' } });
      } catch {
        throw new EditorError(messages.errors.noService);
      }
      const body = await readJson(response);
      if (!response.ok || !body?.texts) throw new EditorError(body?.message ? formatMessage(messages.errors.generic, { message: body.message }) : messages.errors.noService);
      const texts = body.texts as Record<string, Record<Locale, string>>;
      fields = elements.map((element) => {
        const key = element.dataset.editKey!;
        const original = texts[key][locale];
        const css = getComputedStyle(element);
        const input = Object.assign(document.createElement('textarea'), { className: 'page-editor-field', value: original, spellcheck: true });
        input.setAttribute('aria-label', key);
        input.dataset.editField = key;
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'textAlign'] as const) input.style[property] = css[property];
        element.after(input);
        element.hidden = true;
        input.addEventListener('input', () => fit(input));
        fit(input);
        return { element, key, original, input };
      });
      document.body.classList.add(EDITING_CLASS);
      bar.classList.add('is-editing');
      editButton.hidden = true;
      updateButton.hidden = cancelButton.hidden = false;
      say(messages.hint);
      fields[0]?.input.focus();
    } catch (error) {
      say(error instanceof EditorError ? error.message : formatMessage(messages.errors.generic, { message: String(error) }), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function translate(texts: Record<string, string>): Promise<Record<string, string>> {
    const token = remembered.get();
    if (!token) throw new EditorError(messages.errors.unauthorized);
    let response: Response;
    try {
      response = await fetch(`${apiUrl()}/translate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: locale, to: other, texts }),
      });
    } catch {
      throw new EditorError(messages.errors.unreachable);
    }
    const body = await readJson(response);
    if (response.status === 401) throw new EditorError(messages.errors.unauthorized);
    if (!response.ok || !body?.texts) throw new EditorError(formatMessage(messages.errors.translationFailed, { message: body?.message ?? String(response.status) }));
    return body.texts as Record<string, string>;
  }

  async function update() {
    const changed = fields.filter((f) => f.input.value.trim() !== f.original.trim());
    if (!changed.length) return say(messages.nothingChanged);
    setBusy(true);
    try {
      say(formatMessage(messages.translating, { language: messages.languages[other] }));
      const translated = await translate(Object.fromEntries(changed.map((f) => [f.key, f.input.value.trim()])));
      say(messages.saving);
      const texts = Object.fromEntries(changed.map((f) => [f.key, { [locale]: f.input.value.trim(), [other]: translated[f.key] }]));
      let response: Response;
      try {
        response = await fetch(`${SERVICE}save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts }) });
      } catch {
        throw new EditorError(messages.errors.noService);
      }
      const body = await readJson(response);
      if (response.status === 403 && body?.error === 'not-dev-box') throw new EditorError(messages.errors.notDevBox);
      if (!response.ok || !body?.texts) throw new EditorError(formatMessage(messages.errors.generic, { message: body?.message ?? String(response.status) }));
      const saved = body.texts as Record<string, Record<Locale, string>>;
      for (const field of changed) render(field.element, saved[field.key][locale]);
      leave();
      say(messages.saved, 'done');
    } catch (error) {
      say(error instanceof EditorError ? error.message : formatMessage(messages.errors.generic, { message: String(error) }), 'error');
    } finally {
      setBusy(false);
    }
  }

  editButton.addEventListener('click', () => void enter());
  updateButton.addEventListener('click', () => void update());
  cancelButton.addEventListener('click', () => {
    if (busy) return;
    leave();
    say('');
  });
}
