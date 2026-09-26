// The Admin page's Edit Photos button (bulk category change), opened by the Pics Viewer. Each photo in the
// list gets a checkbox (the same mechanism Remove Photos uses — only one of the two is ever active at a
// time, see pics-viewer.ts's `mode`); this is the bar above the list: how many are chosen, select all /
// none, a category to move them to, and Change category. The moving is done by the local photo service
// (scripts/lib/photos.mjs's changeCategory, through scripts/lib/photo-form.mjs), which exists only in
// `astro dev`: it renames each entry's file into the new category's folder and republishes the manifest —
// nothing about the photo itself, its files in R2, or any other field of its entry changes. There is no
// confirmation step first, unlike Remove Photos: unlike a deletion, moving a photo to the wrong category by
// mistake costs nothing to put right (choose it again). Every answer is put on the page as text.
import { el, type Reader } from './admin-common';
import { call } from './photo-service';
import type { PicRow } from './pics-view';
import type { FormCategory } from './photo-form';

export type Recategorize = { id: string; category: string };
export type RecategorizeResult = { id: string; from: string; to: string; moved: boolean };

/** Asks the service to move these photos (each named by its id and the category it is currently filed
 *  under — a photo can be in more than one) to `toCategory`. */
export async function changeCategory(photos: Recategorize[], toCategory: string): Promise<RecategorizeResult[]> {
  const { results } = await call<{ results: RecategorizeResult[] }>('/recategorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: photos.map(({ id, category }) => ({ id, category })), toCategory }),
  });
  return results;
}

export interface RecategorizeBar {
  element: HTMLElement;
  /** The selection or the chosen category changed: refresh the count and the buttons. */
  update(): void;
  focus(): void;
}

export function recategorizeBar(options: {
  m: Reader;
  rows: PicRow[];
  categories: FormCategory[];
  selected: Set<string>;
  /** How many of the rows are drawn so far (the list shows a page at a time): "select all" only ever ticks those. */
  shown: () => number;
  onSelectAll: (all: boolean) => void;
  onCancel: () => void;
  /** Moves the photos; resolves with what happened, or rejects when the service could not be reached. */
  perform: (photos: Recategorize[], toCategory: string) => Promise<RecategorizeResult[]>;
  onDone: (outcome: RecategorizeResult[] | Error) => void;
}): RecategorizeBar {
  const { m, rows, categories, selected, shown, onSelectAll, onCancel, perform, onDone } = options;
  const t = (key: string, values?: Record<string, string | number>) => m(`pics.recategorize.${key}`, values);
  const element = el('div', { class: 'pics-edit-bar', attrs: { role: 'group', 'aria-label': t('barLabel'), 'data-edit-bar': '' } });
  const chosen = () => rows.filter((row) => selected.has(row.id));
  const button = (text: string, onClick: () => void, extra = '') => {
    const node = el('button', { class: `results-button ${extra}`.trim(), text, attrs: { type: 'button' } });
    node.addEventListener('click', onClick);
    return node;
  };

  const count = el('p', { class: 'pics-edit-count', attrs: { role: 'status' } });
  const allShownTicked = () => rows.slice(0, shown()).every((row) => selected.has(row.id));
  const toggleAll = button('', () => onSelectAll(!allShownTicked()));
  const categorySelect = el(
    'select',
    { attrs: { 'aria-label': t('category') } },
    el('option', { text: t('chooseCategory'), attrs: { value: '' } }),
    ...categories.map((c) => el('option', { text: c.label, attrs: { value: c.slug } }))
  );
  const apply = button(t('apply'), () => void run(), 'primary');
  const cancel = button(t('cancel'), onCancel);

  function update() {
    count.textContent = t('selected', { count: selected.size });
    // With more photos still to be drawn, say that only those shown are ticked (never photos nobody has seen).
    toggleAll.textContent = allShownTicked() ? t('selectNone') : shown() < rows.length ? t('selectShown', { count: shown() }) : t('selectAll');
    apply.disabled = selected.size === 0 || !categorySelect.value;
  }
  categorySelect.addEventListener('change', update);

  async function run() {
    const photos = chosen();
    const toCategory = categorySelect.value;
    if (!photos.length || !toCategory) return;
    const categoryLabel = categories.find((c) => c.slug === toCategory)?.label ?? toCategory;
    element.setAttribute('aria-busy', 'true');
    for (const control of [apply, cancel, toggleAll, categorySelect]) control.disabled = true;
    count.textContent = photos.length === 1 ? t('applyingOne', { category: categoryLabel }) : t('applying', { count: photos.length, category: categoryLabel });
    try {
      onDone(await perform(photos.map(({ id, categorySlug }) => ({ id, category: categorySlug ?? '' })), toCategory));
    } catch (error) {
      onDone(error instanceof Error ? error : new Error(String(error)));
    }
  }

  element.replaceChildren(count, el('div', { class: 'pics-edit-controls' }, toggleAll, categorySelect, apply, cancel));
  update();
  return { element, update, focus: () => (apply.disabled ? toggleAll.focus() : apply.focus()) };
}
