// The Admin page's Category Maintenance tab. Categories are public information (unlike Pics Viewer's private
// originals), so this needs no sign-in: the list comes straight from the page's own server-rendered data.
// Add, Edit (hide/show and rename) and Remove each go through the local Category Maintenance service
// (category-service.ts, scripts/lib/category-form.mjs), which exists only in `astro dev`: it writes the site's
// own source files (src/config/categories.json and each locale's `categories.<slug>` in src/i18n/*.json)
// directly — real source, so a change still needs a commit and a deploy to reach the live site, but no
// hand-editing of the files. Every answer from the service is put on the page as text.
import { el, icon, messageReader, parseJson, type Messages } from './admin-common';
import { ServiceError, call, serviceAvailable } from './category-service';

export interface CategoryRow {
  slug: string;
  hidden: boolean;
  label: string;
  labelEs: string;
  description: string;
  descriptionEs: string;
  photoCount: number;
}

/** What the page actually embeds: this locale's own label and the photo count, nothing Edit-only (the other
 *  locale's text, descriptions) — see the comment on `categoryRows` in admin.astro for why. */
type InitialRow = Pick<CategoryRow, 'slug' | 'hidden' | 'label' | 'photoCount'>;
const toCategoryRow = (row: InitialRow): CategoryRow => ({ ...row, labelEs: row.label, description: '', descriptionEs: '' });

/** Service error codes -> the message keys under categories.form.errors (Add) or shown generically (Edit/Remove). */
const ERROR_KEYS: Record<string, string> = {
  unavailable: 'unavailable',
  'not-found': 'unavailable',
  unreachable: 'unreachable',
  'not-local': 'notLocal',
  duplicate: 'duplicate',
};

export function mountCategoryMaintenance(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-categories-root]')!;
  const messages = parseJson<Messages>(container.dataset.messages ?? '{}');
  const m = messageReader(messages);
  const t = (key: string, values?: Record<string, string | number>) => m(`categories.${key}`, values);

  // The page's own server-rendered list — accurate as of when it loaded, and all this tab needs while the
  // local service isn't reachable (e.g. the deployed site, or before `astro dev` starts). Replaced by the
  // service's own answer after every successful Add, Edit or Remove.
  let rows: CategoryRow[] = parseJson<InitialRow[]>(container.dataset.categoriesList ?? '[]').map(toCategoryRow);
  let mode: 'none' | 'edit' | 'remove' = 'none';
  let checking = false; // toggling Edit/Remove while the local service's availability is being confirmed
  let formOpen = false; // the Add Category form
  const selected = new Set<string>(); // Remove mode
  let bar: RemovalBar | null = null;
  let notice: { text: string; alert: boolean } | null = null;

  const show = (...nodes: (Node | string | null | undefined | false)[]) => root.replaceChildren(...(nodes.filter(Boolean) as (Node | string)[]));

  // --- The count and the Add / Edit / Remove buttons ---------------------------------------------------------

  function summary(): (HTMLElement | null)[] {
    const status = el('p', { class: 'pics-status', attrs: { role: notice?.alert ? 'alert' : 'status' } });
    if (notice) status.textContent = notice.text;
    const button = (kind: 'add' | 'edit' | 'remove', glyph: 'plus' | 'edit' | 'trash', label: string) => {
      const node = el('button', { class: 'results-button pics-action', attrs: { type: 'button', 'data-action': kind } }, icon(glyph), el('span', { text: label }));
      if (kind !== 'add') node.setAttribute('aria-pressed', String(mode === kind));
      node.addEventListener('click', () => {
        notice = null;
        if (kind === 'add') {
          status.textContent = '';
          toggleForm();
        } else {
          void toggleMode(kind, status);
        }
      });
      return node;
    };
    const actions = el('div', { class: 'pics-actions' }, button('add', 'plus', t('add')), button('edit', 'edit', t('edit')), button('remove', 'trash', t('remove')));
    const countText = rows.length === 1 ? t('countOne') : t('count', { count: rows.length });
    return [el('div', { class: 'pics-summary' }, el('p', { class: 'results-count', text: countText }), actions), status];
  }

  // --- Add Category --------------------------------------------------------------------------------------------

  const formHost = el('div');

  function toggleForm() {
    formOpen = !formOpen;
    formHost.replaceChildren();
    if (formOpen) formHost.append(categoryAddForm());
    paint();
  }

  function closeForm() {
    formOpen = false;
    paint();
    container.querySelector<HTMLElement>('[data-action="add"]')?.focus();
  }

  function categoryAddForm(): HTMLElement {
    const ft = (key: string, values?: Record<string, string | number>) => m(`categories.form.${key}`, values);
    const field = (id: string, labelText: string, hint?: string) => {
      const input = el('input', { attrs: { type: 'text', id, name: id, required: '' } });
      return { input, node: el('div', { class: 'photo-form-field' }, el('label', { text: labelText, attrs: { for: id } }), input, hint ? el('p', { class: 'results-hint', text: hint }) : null) };
    };
    const slugField = field('category-slug', ft('slug'), ft('slugHint'));
    const labelField = field('category-label', ft('label'));
    const labelEsField = field('category-label-es', ft('labelEs'));
    const descriptionField = field('category-description', ft('description'));
    const descriptionEsField = field('category-description-es', ft('descriptionEs'));
    const hiddenBox = el('input', { attrs: { type: 'checkbox', id: 'category-hidden' } });

    const submit = el('button', { class: 'results-button primary', text: ft('submit'), attrs: { type: 'submit' } });
    const closeButton = () => {
      const button = el('button', { class: 'results-button', text: ft('close'), attrs: { type: 'button' } });
      button.addEventListener('click', closeForm);
      return button;
    };
    const problem = el('p', { class: 'results-error', attrs: { role: 'alert' } });

    const fields = el(
      'form',
      { class: 'photo-form-fields' },
      slugField.node,
      labelField.node,
      labelEsField.node,
      descriptionField.node,
      descriptionEsField.node,
      el('label', { class: 'photo-form-check' }, hiddenBox, el('span', { text: ft('hidden') })),
      problem,
      el('div', { class: 'photo-form-buttons' }, submit, closeButton())
    );
    fields.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitForm();
    });

    async function submitForm() {
      problem.textContent = '';
      submit.disabled = true;
      submit.textContent = ft('submitting');
      const slug = slugField.input.value.trim();
      try {
        const created = await call<CategoryRow>('/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            label: labelField.input.value.trim(),
            labelEs: labelEsField.input.value.trim(),
            description: descriptionField.input.value.trim(),
            descriptionEs: descriptionEsField.input.value.trim(),
            hidden: hiddenBox.checked,
          }),
        });
        rows = [...rows, created];
        const again = el('button', { class: 'results-button', text: ft('another') });
        again.addEventListener('click', () => body.replaceChildren(fields));
        const body = formHost.firstElementChild as HTMLElement;
        body.replaceChildren(el('p', { class: 'results-notice', text: ft('added', { label: created.label }), attrs: { role: 'status', tabindex: '-1' } }), el('div', { class: 'photo-form-buttons' }, again, closeButton()));
        (body.firstElementChild as HTMLElement)?.focus();
        paintList(); // the summary count and the list behind the form both change
      } catch (error) {
        const known = error instanceof ServiceError ? ERROR_KEYS[error.code] : undefined;
        problem.textContent = known ? ft(`errors.${known}`, { slug }) : ft('errors.failed', { message: error instanceof Error ? error.message : String(error) });
        submit.disabled = false;
        submit.textContent = ft('submit');
      }
    }

    const section = el('section', { class: 'photo-form', attrs: { 'aria-labelledby': 'category-form-heading' } }, el('h3', { text: ft('heading'), attrs: { id: 'category-form-heading' } }), el('p', { class: 'results-hint', text: ft('intro') }), fields);
    return section;
  }

  // --- Edit Categories (hide/show, rename) ----------------------------------------------------------------------

  function buildEditRow(row: CategoryRow): HTMLElement {
    const hiddenBox = el('input', { attrs: { type: 'checkbox' } });
    hiddenBox.checked = row.hidden;
    const labelInput = el('input', { attrs: { type: 'text', value: row.label, 'aria-label': t('editRow.labelAria', { category: row.label }) } });
    const labelEsInput = el('input', { attrs: { type: 'text', value: row.labelEs, 'aria-label': t('editRow.labelEsAria', { category: row.label }) } });
    const status = el('span', { class: 'category-edit-status', attrs: { role: 'status' } });
    const saveBtn = el('button', { class: 'results-button', text: t('editRow.save'), attrs: { type: 'button' } });
    saveBtn.addEventListener('click', () => void save());

    async function save() {
      for (const control of [hiddenBox, labelInput, labelEsInput, saveBtn]) control.disabled = true;
      status.textContent = t('editRow.saving');
      try {
        const updated = await call<CategoryRow>('/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: row.slug, hidden: hiddenBox.checked, label: labelInput.value.trim(), labelEs: labelEsInput.value.trim() }),
        });
        rows = rows.map((r) => (r.slug === row.slug ? updated : r));
        status.textContent = t('editRow.saved');
      } catch (error) {
        status.textContent = t('editRow.failed', { category: row.label, message: error instanceof Error ? error.message : String(error) });
      } finally {
        for (const control of [hiddenBox, labelInput, labelEsInput, saveBtn]) control.disabled = false;
      }
    }

    return el(
      'div',
      { class: 'category-edit-fields' },
      el('label', { class: 'photo-form-check' }, hiddenBox, el('span', { text: t('editRow.hiddenLabel') })),
      el('label', { class: 'category-field-inline' }, el('span', { class: 'visually-hidden', text: t('form.label') }), labelInput),
      el('label', { class: 'category-field-inline' }, el('span', { class: 'visually-hidden', text: t('form.labelEs') }), labelEsInput),
      saveBtn,
      status
    );
  }

  // --- Remove Categories -----------------------------------------------------------------------------------------

  interface RemovalBar {
    element: HTMLElement;
    update(): void;
  }

  function categoryRemovalBar(): RemovalBar {
    const rt = (key: string, values?: Record<string, string | number>) => t(`removal.${key}`, values);
    const element = el('div', { class: 'pics-remove-bar', attrs: { 'data-remove-bar': '' } });
    const chosen = () => rows.filter((row) => selected.has(row.slug));
    const plural = (base: string, count: number) => rt(count === 1 ? `${base}One` : base, { count });
    const button = (text: string, onClick: () => void, extra = '') => {
      const node = el('button', { class: `results-button ${extra}`.trim(), text, attrs: { type: 'button' } });
      node.addEventListener('click', onClick);
      return node;
    };

    const count = el('p', { class: 'pics-remove-count', attrs: { role: 'status' } });
    const allTicked = () => rows.every((row) => selected.has(row.slug));
    const toggleAll = button('', () => {
      selected.clear();
      if (!allTicked()) for (const row of rows) selected.add(row.slug);
      paintList();
    });
    const removeBtn = button(rt('delete'), () => confirmStep(), 'danger');
    const cancel = button(rt('cancel'), stopMode);

    function choosing() {
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', rt('barLabel'));
      element.removeAttribute('aria-labelledby');
      element.replaceChildren(count, el('div', { class: 'pics-remove-buttons' }, toggleAll, removeBtn, cancel));
      update();
    }

    function update() {
      count.textContent = rt('selected', { count: selected.size });
      toggleAll.textContent = allTicked() ? rt('selectNone') : rt('selectAll');
      removeBtn.disabled = selected.size === 0;
    }

    function confirmStep() {
      const targets = chosen();
      if (!targets.length) return;
      const warning = el('p', { class: 'pics-remove-warning', text: plural('confirm', targets.length), attrs: { id: 'category-remove-warning', tabindex: '-1' } });
      const named = targets.map((row) => el('li', { text: `${row.label} (/work/${row.slug}/)` }));
      const yes = button(plural('yes', targets.length), () => void run(targets), 'danger');
      const keep = button(rt('keep'), choosing);
      element.setAttribute('role', 'group');
      element.setAttribute('aria-labelledby', 'category-remove-warning');
      element.removeAttribute('aria-label');
      element.replaceChildren(warning, el('ul', { class: 'pics-remove-named' }, ...named), el('div', { class: 'pics-remove-buttons' }, yes, keep));
      keep.focus();
      element.addEventListener('keydown', escape);
    }

    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !element.querySelector('.pics-remove-warning')) return;
      element.removeEventListener('keydown', escape);
      choosing();
    }

    async function run(targets: CategoryRow[]) {
      element.removeEventListener('keydown', escape);
      element.setAttribute('aria-busy', 'true');
      element.replaceChildren(el('p', { class: 'pics-remove-count', text: plural('deleting', targets.length), attrs: { role: 'status' } }));
      const results = await Promise.all(
        targets.map(async (row) => {
          try {
            await call<{ slug: string }>('/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: row.slug }) });
            return { row, ok: true as const };
          } catch (error) {
            return { row, ok: false as const, message: error instanceof Error ? error.message : String(error) };
          }
        })
      );
      const removedSlugs = new Set(results.filter((r) => r.ok).map((r) => r.row.slug));
      rows = rows.filter((row) => !removedSlugs.has(row.slug));
      const done = removedSlugs.size;
      const failures = results.filter((r) => !r.ok).map((r) => rt('failed', { category: r.row.label, message: (r as { message: string }).message }));
      notice = { text: [done ? plural('done', done) : '', ...failures].filter(Boolean).join(' '), alert: failures.length > 0 };
      mode = 'none';
      selected.clear();
      paint();
    }

    choosing();
    return { element, update };
  }

  // --- Toggling Edit / Remove mode --------------------------------------------------------------------------------

  async function toggleMode(kind: 'edit' | 'remove', status: HTMLElement) {
    if (checking) return;
    if (mode === kind) return stopMode();
    checking = true;
    status.textContent = t('checking');
    const available = await serviceAvailable();
    checking = false;
    if (!available) {
      status.textContent = t('unavailable');
      return;
    }
    // A fresh look at the service's own data before letting anything be changed: the page's server-rendered
    // list can be stale (left open a while, or another tab already changed something).
    try {
      const fresh = await call<{ categories: CategoryRow[] }>('/status');
      rows = fresh.categories;
    } catch {
      // Stay with what the page already has rather than block Edit/Remove over a read that failed.
    }
    mode = kind;
    selected.clear();
    status.textContent = '';
    paint();
    container.querySelector<HTMLElement>(kind === 'remove' ? '.pic-check' : '.category-edit-fields input')?.focus();
  }

  function stopMode() {
    const was = mode;
    mode = 'none';
    selected.clear();
    bar = null;
    paint();
    container.querySelector<HTMLElement>(`[data-action="${was}"]`)?.focus();
  }

  // --- The list --------------------------------------------------------------------------------------------------

  function buildRow(row: CategoryRow): HTMLElement {
    const item = el('li', { class: 'category-row' });
    if (mode === 'edit') {
      item.append(el('div', { class: 'category-row-body' }, el('span', { class: 'category-name', text: row.label }), buildEditRow(row)));
      return item;
    }
    const metaText = `/work/${row.slug}/ — ${row.photoCount === 0 ? t('photoCountNone') : row.photoCount === 1 ? t('photoCountOne') : t('photoCount', { count: row.photoCount })}`;
    const info = el(
      'div',
      { class: 'category-info' },
      el('span', { class: 'category-name' }, row.label, row.hidden ? el('span', { class: 'results-badge', text: t('hiddenBadge') }) : null),
      el('span', { class: 'category-meta', text: metaText })
    );
    item.append(el('div', { class: 'category-row-body' }, info));
    if (mode === 'remove') {
      const box = el('input', { class: 'pic-check', attrs: { type: 'checkbox', 'data-slug': row.slug, 'aria-label': t('removal.select', { category: row.label }) } });
      box.checked = selected.has(row.slug);
      item.classList.toggle('selected', box.checked);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(row.slug);
        else selected.delete(row.slug);
        item.classList.toggle('selected', box.checked);
        bar?.update();
      });
      item.prepend(el('label', { class: 'pic-select' }, box));
    }
    return item;
  }

  /** Redraws just the list and the bar (the summary/count stays, since paint() rebuilds the whole panel and would drop keyboard focus mid-edit). */
  function paintList() {
    const list = root.querySelector<HTMLElement>('.category-list');
    if (!list) return paint();
    list.className = `category-list${mode !== 'none' ? ` selecting ${mode}` : ''}`;
    list.replaceChildren(...rows.map(buildRow));
    bar?.update();
    const count = root.querySelector<HTMLElement>('.results-count');
    if (count) count.textContent = rows.length === 1 ? t('countOne') : t('count', { count: rows.length });
  }

  function paint() {
    if (!rows.length) {
      mode = 'none';
      bar = null;
      show(...summary(), el('p', { class: 'results-empty', text: t('empty') }));
      return;
    }
    bar = mode === 'remove' ? categoryRemovalBar() : null;
    show(...summary(), formOpen ? formHost : null, bar?.element ?? null, el('ul', { class: `category-list${mode !== 'none' ? ` selecting ${mode}` : ''}` }, ...rows.map(buildRow)));
  }

  paint();

  // The tab has no remote data to (re)load, so it just needs to repaint once (its script only ever mounts
  // once per tab, but every :root re-render — e.g. a locale switch reload — starts this fresh) and again
  // whenever the panel is shown, in case another tab or the local service changed something meanwhile.
  new MutationObserver(() => !panel.hidden && paintList()).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}
