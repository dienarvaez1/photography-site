// The Admin page's Category Maintenance tab. Gated by the same admin token as Pics Viewer and Test Results
// (checked against the results API — the same one they already use — the moment it's entered; this tab needs
// none of that API's own data, only its yes/no on the token). Once past the gate, the list itself comes
// straight from the page's own server-rendered data — categories are public information, unlike Pics
// Viewer's private originals, so nothing further is fetched just to show it. Add, Edit (hide/show, rename and
// re-describe) and Remove each go through the local Category Maintenance service (category-service.ts,
// scripts/lib/category-form.mjs), which exists only in `astro dev`: it writes the site's own source files
// (src/config/categories.json and each locale's `categories.<slug>` in src/i18n/*.json) directly — real
// source, so a change still needs a commit and a deploy to reach the live site, but no hand-editing of the
// files. Every answer from either service is put on the page as text.
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, gateForm, icon, messageReader, parseJson, remembered, type Messages } from './admin-common';
import { ServiceError, call, serviceAvailable } from './category-service';
import { resolveApiUrl } from './results-view';

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
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);

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

  let token = remembered.get();
  let verified = false; // the token above has been checked against the results API this page view
  let generation = 0; // a newer render() makes an older, slower one's answer stale

  const show = (...nodes: (Node | string | null | undefined | false)[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as (Node | string)[]));
    root.removeAttribute('aria-busy');
  };

  // --- Sign in -------------------------------------------------------------------------------------------------

  function renderGate(problem?: unknown) {
    const { form, input } = gateForm(m, 'categories', (given) => {
      token = given;
      remembered.set(given);
      void render();
    }, problem);
    show(form);
    if (problem) input.focus();
  }

  /** Shows the sign-in gate, or checks a not-yet-verified token against the results API (the same one Pics
   *  Viewer and Test Results use — this tab needs none of its data, only its yes/no on the token) before
   *  revealing the list. Already-verified tokens repaint straight away: nothing here changes per token. */
  async function render() {
    const run = ++generation;
    if (!token) {
      verified = false;
      return renderGate();
    }
    if (verified) return paint();
    root.setAttribute('aria-busy', 'true');
    show(el('p', { class: 'results-loading', text: m('loading') }));
    try {
      await apiGet<unknown>(apiUrl, token, '/index');
      if (run !== generation) return;
      verified = true;
      paint();
    } catch (error) {
      if (run !== generation) return;
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'notConfigured')) {
        token = '';
        remembered.set('');
        renderGate(error);
      } else {
        show(el('p', { class: 'results-error', text: errorMessage(m, error), attrs: { role: 'alert' } }));
      }
    }
  }

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
    const field = (idSuffix: string, labelText: string, value: string, wide = false) => {
      const id = `category-edit-${idSuffix}-${row.slug}`;
      const input = el('input', { attrs: { type: 'text', id, value } });
      return { input, node: el('div', { class: wide ? 'category-field-inline wide' : 'category-field-inline' }, el('label', { text: labelText, attrs: { for: id } }), input) };
    };
    const slugField = field('slug', t('form.slug'), row.slug);
    const labelField = field('label', t('form.label'), row.label);
    const labelEsField = field('label-es', t('form.labelEs'), row.labelEs);
    // Much wider than the name field (see .category-field-inline.wide in admin.astro) — a description runs
    // much longer than a name.
    const descriptionField = field('description', t('form.description'), row.description, true);
    const descriptionEsField = field('description-es', t('form.descriptionEs'), row.descriptionEs, true);
    const hiddenBox = el('input', { attrs: { type: 'checkbox' } });
    hiddenBox.checked = row.hidden;
    const status = el('span', { class: 'category-edit-status', attrs: { role: 'status' } });
    const saveBtn = el('button', { class: 'results-button', text: t('editRow.save'), attrs: { type: 'button' } });
    const controls = [slugField.input, labelField.input, labelEsField.input, descriptionField.input, descriptionEsField.input, hiddenBox, saveBtn];
    saveBtn.addEventListener('click', () => void save());

    async function save() {
      for (const control of controls) control.disabled = true;
      status.textContent = t('editRow.saving');
      const newSlug = slugField.input.value.trim();
      const renaming = newSlug !== row.slug;
      try {
        const updated = await call<CategoryRow>('/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: row.slug,
            newSlug: renaming ? newSlug : undefined,
            hidden: hiddenBox.checked,
            label: labelField.input.value.trim(),
            labelEs: labelEsField.input.value.trim(),
            description: descriptionField.input.value.trim(),
            descriptionEs: descriptionEsField.input.value.trim(),
          }),
        });
        rows = rows.map((r) => (r.slug === row.slug ? updated : r));
        if (renaming) {
          // The row's own identity just changed slug, so it needs rebuilding against the new one — a save
          // that doesn't rename stays in place instead, so editing doesn't keep losing keyboard focus.
          paintList();
        } else {
          status.textContent = t('editRow.saved');
          for (const control of controls) control.disabled = false;
        }
      } catch (error) {
        status.textContent = t('editRow.failed', { category: row.label, message: error instanceof Error ? error.message : String(error) });
        for (const control of controls) control.disabled = false;
      }
    }

    const hiddenLabel = el('label', { class: 'photo-form-check' }, hiddenBox, el('span', { text: t('editRow.hiddenLabel') }));

    return el(
      'div',
      { class: 'category-edit-fields' },
      // Slug and Hidden sit together — both are about the category's identity, not its wording — with the
      // slug's own hint directly under them; each language then gets its own line, name next to its own
      // description, so translating one language doesn't mean jumping between two separate rows.
      el('div', { class: 'category-edit-row' }, slugField.node, hiddenLabel),
      el('p', { class: 'results-hint', text: t('editRow.slugHint') }),
      el('div', { class: 'category-edit-row' }, labelField.node, descriptionField.node),
      el('div', { class: 'category-edit-row' }, labelEsField.node, descriptionEsField.node),
      el('div', { class: 'category-edit-row' }, saveBtn, status)
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

  // Nothing is requested while the tab is hidden; showing it checks the token (once) and paints the list.
  function sync() {
    if (panel.hidden) return;
    if (!verified) return void render();
    // Already signed in and drawn once: just refresh the list in case another tab or the local service
    // changed something meanwhile, the same way every other reveal of this tab already did before the gate.
    paintList();
  }
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    verified = false;
    generation++;
    formOpen = false;
    formHost.replaceChildren(); // signing out (or in as someone else) closes the form
    mode = 'none'; // ...and any bulk-action checkboxes
    selected.clear();
    bar = null;
    notice = null;
    if (!panel.hidden) void render();
    else root.replaceChildren();
  });
  // The page's Refresh button asks the local service for the current list when this tab is showing (the
  // token itself needs no re-checking: AUTH_EVENT already covers a token that changed).
  window.addEventListener(REFRESH_EVENT, () => {
    if (panel.hidden || !verified) return;
    call<{ categories: CategoryRow[] }>('/status')
      .then((fresh) => {
        rows = fresh.categories;
        paintList();
      })
      .catch(() => {
        // The local service isn't reachable (e.g. this is the deployed site): nothing to refresh from.
      });
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  // Look once the tabs have applied the address (a link to another tab must not load this one).
  setTimeout(sync, 0);
}
