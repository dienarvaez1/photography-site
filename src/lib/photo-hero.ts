// The Admin page's Home Background button (bulk hero-background change), opened by the Pics Viewer. Each
// photo in the list gets a checkbox (the same mechanism Edit Photos and Remove Photos use — only one of the
// three bulk actions is ever active at a time, see pics-viewer.ts's `mode`); this is the bar above the list:
// how many are chosen, select all / none, and two actions, Set as background and Remove from background.
// The change is done by the local photo service (scripts/lib/photos.mjs's setHeroBackground, through
// scripts/lib/photo-form.mjs), which exists only in `astro dev`: it only ever writes the `heroBackground`
// field of the entries named — the photo itself, its files in R2, its category and every other field of its
// entry are untouched. There is no confirmation step first, the same reasoning as Edit Photos: unlike a
// deletion, marking or unmarking a photo by mistake costs nothing to put right (choose it again). Every
// answer is put on the page as text.
import { el, type Reader } from './admin-common';
import { call } from './photo-service';
import type { PicRow } from './pics-view';

export type HeroBackgroundChange = { id: string; category: string };
export type HeroBackgroundResult = { id: string; category: string; changed: boolean };

/** Asks the service to set (`value: true`) or clear (`value: false`) the hero-background flag on these
 *  photos, each named by its id and the category it is currently filed under (a photo can be in more than one). */
export async function setHeroBackground(photos: HeroBackgroundChange[], value: boolean): Promise<HeroBackgroundResult[]> {
  const { results } = await call<{ results: HeroBackgroundResult[] }>('/hero-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: photos.map(({ id, category }) => ({ id, category })), value }),
  });
  return results;
}

export interface HeroBackgroundBar {
  element: HTMLElement;
  /** The selection changed (a checkbox was ticked): refresh the count and the buttons. */
  update(): void;
  focus(): void;
}

export function heroBackgroundBar(options: {
  m: Reader;
  rows: PicRow[];
  selected: Set<string>;
  /** How many of the rows are drawn so far (the list shows a page at a time): "select all" only ever ticks those. */
  shown: () => number;
  onSelectAll: (all: boolean) => void;
  onCancel: () => void;
  /** Sets or clears the flag; resolves with what happened, or rejects when the service could not be reached. */
  perform: (photos: HeroBackgroundChange[], value: boolean) => Promise<HeroBackgroundResult[]>;
  onDone: (value: boolean, outcome: HeroBackgroundResult[] | Error) => void;
}): HeroBackgroundBar {
  const { m, rows, selected, shown, onSelectAll, onCancel, perform, onDone } = options;
  const t = (key: string, values?: Record<string, string | number>) => m(`pics.background.${key}`, values);
  const element = el('div', { class: 'pics-edit-bar', attrs: { role: 'group', 'aria-label': t('barLabel'), 'data-hero-bar': '' } });
  const chosen = () => rows.filter((row) => selected.has(row.id));
  const button = (text: string, onClick: () => void, extra = '') => {
    const node = el('button', { class: `results-button ${extra}`.trim(), text, attrs: { type: 'button' } });
    node.addEventListener('click', onClick);
    return node;
  };

  const count = el('p', { class: 'pics-edit-count', attrs: { role: 'status' } });
  const allShownTicked = () => rows.slice(0, shown()).every((row) => selected.has(row.id));
  const toggleAll = button('', () => onSelectAll(!allShownTicked()));
  const setBtn = button(t('set'), () => void run(true), 'primary');
  const clearBtn = button(t('clear'), () => void run(false));
  const cancel = button(t('cancel'), onCancel);

  function update() {
    count.textContent = t('selected', { count: selected.size });
    // With more photos still to be drawn, say that only those shown are ticked (never photos nobody has seen).
    toggleAll.textContent = allShownTicked() ? t('selectNone') : shown() < rows.length ? t('selectShown', { count: shown() }) : t('selectAll');
    setBtn.disabled = selected.size === 0;
    clearBtn.disabled = selected.size === 0;
  }

  async function run(value: boolean) {
    const photos = chosen();
    if (!photos.length) return;
    element.setAttribute('aria-busy', 'true');
    for (const control of [setBtn, clearBtn, cancel, toggleAll]) control.disabled = true;
    count.textContent = photos.length === 1 ? t(value ? 'settingOne' : 'clearingOne') : t(value ? 'setting' : 'clearing', { count: photos.length });
    try {
      onDone(value, await perform(photos.map(({ id, categorySlug }) => ({ id, category: categorySlug ?? '' })), value));
    } catch (error) {
      onDone(value, error instanceof Error ? error : new Error(String(error)));
    }
  }

  element.replaceChildren(count, el('div', { class: 'pics-edit-controls' }, toggleAll, setBtn, clearBtn, cancel));
  update();
  return { element, update, focus: () => (setBtn.disabled ? toggleAll.focus() : setBtn.focus()) };
}
