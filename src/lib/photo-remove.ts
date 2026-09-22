// The Admin page's bulk removal (opened by the Pics Viewer's Remove Photos button). Each photo in the list gets a
// checkbox; this is the bar above the list: how many are chosen, select all / none, Delete selected, Cancel, and then
// a confirmation that names every photo before anything is deleted. The deleting is done by the local photo service
// (scripts/lib/photo-form.mjs), which exists only in `astro dev` and deletes exactly the photos named by their id:
// the entries that use them, then each original and its web sizes, and nothing else. Every answer is put on the page as text.
import { el, type Reader } from './admin-common';
import { call } from './photo-service';
import type { PicRow } from './pics-view';

export type Removal = { id: string; key: string };
export type RemoveResult = { id: string; entries: string[]; deleted: string[]; error?: string };

/** Is the local photo service there? (Only while the site runs on the owner's computer.) */
export async function serviceAvailable(): Promise<boolean> {
  try {
    await call('/status');
    return true;
  } catch {
    return false;
  }
}

/** Asks the service to delete these photos, each by its id and the key of its original. */
export async function removePhotos(photos: Removal[]): Promise<RemoveResult[]> {
  const { results } = await call<{ results: RemoveResult[] }>('/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: photos.map(({ id, key }) => ({ id, key })) }),
  });
  return results;
}

export interface RemovalBar {
  element: HTMLElement;
  /** The selection changed (a checkbox was ticked): refresh the count and the buttons. */
  update(): void;
  focus(): void;
}

/** How many photos the confirmation names one by one before "…and N more". */
const NAMED = 10;

export function removalBar(options: {
  m: Reader;
  rows: PicRow[];
  selected: Set<string>;
  /** How many of the rows are drawn so far (the list shows a page at a time): "select all" only ever ticks those. */
  shown: () => number;
  /** Tick every checkbox shown (true) or none (false). */
  onSelectAll: (all: boolean) => void;
  onCancel: () => void;
  /** Deletes the photos; resolves with what happened, or rejects when the service could not be reached. */
  perform: (photos: Removal[]) => Promise<RemoveResult[]>;
  onDone: (outcome: RemoveResult[] | Error) => void;
}): RemovalBar {
  const { m, rows, selected, shown, onSelectAll, onCancel, perform, onDone } = options;
  const t = (key: string, values?: Record<string, string | number>) => m(`pics.removal.${key}`, values);
  const element = el('div', { class: 'pics-remove-bar', attrs: { 'data-remove-bar': '' } });
  const chosen = () => rows.filter((row) => selected.has(row.id));
  const plural = (base: string, count: number) => t(count === 1 ? `${base}One` : base, { count });
  const button = (text: string, onClick: () => void, extra = '') => {
    const node = el('button', { class: `results-button ${extra}`.trim(), text, attrs: { type: 'button' } });
    node.addEventListener('click', onClick);
    return node;
  };

  // --- Choosing ---------------------------------------------------------------------------------------------------------------

  const count = el('p', { class: 'pics-remove-count', attrs: { role: 'status' } });
  const allShownTicked = () => rows.slice(0, shown()).every((row) => selected.has(row.id));
  const toggleAll = button('', () => onSelectAll(!allShownTicked()));
  const remove = button(t('delete'), () => confirm(), 'danger');
  const cancel = button(t('cancel'), onCancel);

  function choosing() {
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', t('barLabel'));
    element.removeAttribute('aria-labelledby');
    element.replaceChildren(count, el('div', { class: 'pics-remove-buttons' }, toggleAll, remove, cancel));
    update();
  }

  function update() {
    count.textContent = t('selected', { count: selected.size });
    // With more photos still to be drawn, say that only those shown are ticked (never photos nobody has seen).
    toggleAll.textContent = allShownTicked() ? t('selectNone') : shown() < rows.length ? t('selectShown', { count: shown() }) : t('selectAll');
    remove.disabled = selected.size === 0;
  }

  // --- Confirming: every photo is named before anything is deleted -------------------------------------------------------------

  function confirm() {
    const photos = chosen();
    if (!photos.length) return;
    const warning = el('p', { class: 'pics-remove-warning', text: plural('confirm', photos.length), attrs: { id: 'pics-remove-warning', tabindex: '-1' } });
    const named = photos.slice(0, NAMED).map((row) => el('li', { text: `${row.title ?? t('notOnSite')} (${row.id})` }));
    const more = photos.length > NAMED ? [el('li', { text: t('more', { count: photos.length - NAMED }) })] : [];
    const yes = button(plural('yes', photos.length), () => void run(photos), 'danger');
    const keep = button(t('keep'), choosing);
    element.setAttribute('role', 'group');
    element.setAttribute('aria-labelledby', 'pics-remove-warning');
    element.removeAttribute('aria-label');
    element.replaceChildren(warning, el('ul', { class: 'pics-remove-named' }, ...named, ...more), el('div', { class: 'pics-remove-buttons' }, yes, keep));
    keep.focus(); // the safe choice is the one under the keyboard
    element.addEventListener('keydown', escape);
  }

  /** Escape backs out of the confirmation, like "Keep them". */
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !element.querySelector('.pics-remove-warning')) return;
    element.removeEventListener('keydown', escape);
    choosing();
  }

  // --- Deleting ------------------------------------------------------------------------------------------------------------------

  async function run(photos: PicRow[]) {
    element.removeEventListener('keydown', escape);
    element.setAttribute('aria-busy', 'true');
    element.replaceChildren(el('p', { class: 'pics-remove-count', text: plural('deleting', photos.length), attrs: { role: 'status' } }));
    try {
      onDone(await perform(photos.map(({ id, key }) => ({ id, key }))));
    } catch (error) {
      onDone(error instanceof Error ? error : new Error(String(error)));
    }
  }

  choosing();
  return { element, update, focus: () => remove.disabled ? toggleAll.focus() : remove.focus() };
}
