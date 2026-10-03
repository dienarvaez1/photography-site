// The Admin page's Home Background button (bulk hero-background change), opened by the Pics Viewer. Each photo the site
// lists gets an on/off switch showing whether it is in the home page's background, starting as it is now (only one of
// the bulk actions is ever active at a time, see pics-viewer.ts's `mode`); this is the bar above the list: how many
// switches have been changed, and one Save changes button that sets the ones switched on and clears the ones switched
// off, together.
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

/** What one Save changes asks for: the photos switched on (to set) and off (to clear) since the bar opened. */
export type HeroBackgroundChanges = { set: HeroBackgroundChange[]; clear: HeroBackgroundChange[] };
export type HeroBackgroundOutcome = { set: HeroBackgroundResult[]; cleared: HeroBackgroundResult[] };

export interface HeroBackgroundBar {
  element: HTMLElement;
  /** A switch was flipped: refresh the count of unsaved changes and the Save button. */
  update(): void;
  focus(): void;
}

export function heroBackgroundBar(options: {
  m: Reader;
  rows: PicRow[];
  /** The photos switched on now: the current members when the bar opens, then whatever the switches say. */
  selected: Set<string>;
  onCancel: () => void;
  /** Saves every change at once; resolves with what happened, or rejects when the service could not be reached. */
  perform: (changes: HeroBackgroundChanges) => Promise<HeroBackgroundOutcome>;
  onDone: (outcome: HeroBackgroundOutcome | Error) => void;
}): HeroBackgroundBar {
  const { m, rows, selected, onCancel, perform, onDone } = options;
  const t = (key: string, values?: Record<string, string | number>) => m(`pics.background.${key}`, values);
  const element = el('div', { class: 'pics-edit-bar', attrs: { role: 'group', 'aria-label': t('barLabel'), 'data-hero-bar': '' } });
  const button = (text: string, onClick: () => void, extra = '') => {
    const node = el('button', { class: `results-button ${extra}`.trim(), text, attrs: { type: 'button' } });
    node.addEventListener('click', onClick);
    return node;
  };

  /** Each listed photo whose switch no longer matches what it was when the bar opened. */
  const changes = (): HeroBackgroundChanges => {
    const listed = rows.filter((row) => row.categorySlug !== null);
    const asChange = ({ id, categorySlug }: PicRow) => ({ id, category: categorySlug ?? '' });
    return {
      set: listed.filter((row) => selected.has(row.id) && !row.heroBackground).map(asChange),
      clear: listed.filter((row) => !selected.has(row.id) && row.heroBackground).map(asChange),
    };
  };
  const pending = () => {
    const { set, clear } = changes();
    return set.length + clear.length;
  };

  const count = el('p', { class: 'pics-edit-count', attrs: { role: 'status' } });
  const save = button(t('save'), () => void run(), 'primary');
  const cancel = button(t('cancel'), onCancel);

  function update() {
    const n = pending();
    count.textContent = n === 0 ? t('noChanges') : t(n === 1 ? 'changesOne' : 'changes', { count: n });
    save.disabled = n === 0;
  }

  async function run() {
    const n = pending();
    if (!n) return;
    element.setAttribute('aria-busy', 'true');
    for (const control of [save, cancel]) control.disabled = true;
    for (const toggle of document.querySelectorAll<HTMLInputElement>('.pic-switch')) toggle.disabled = true;
    count.textContent = n === 1 ? t('savingOne') : t('saving', { count: n });
    try {
      onDone(await perform(changes()));
    } catch (error) {
      onDone(error instanceof Error ? error : new Error(String(error)));
    }
  }

  element.replaceChildren(count, el('div', { class: 'pics-edit-controls' }, save, cancel));
  update();
  return { element, update, focus: () => (save.disabled ? cancel.focus() : save.focus()) };
}
