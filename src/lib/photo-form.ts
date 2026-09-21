// The Admin page's New Photo form (opened by the Pics Viewer's Upload Photos button). The person picks a JPEG
// and the form reads what the photo itself knows (its id, size and camera line) through the local photo
// service; they add a title, a category and an order (suggested as one past the highest in the category, and
// updated when the category changes), and the service uploads the photo to R2 and writes its entry, exactly as
// `npm run photos:add` does. See scripts/lib/photo-form.mjs.
//
// The service exists only in `astro dev` (it needs the owner's Cloudflare login and writes into the project),
// so on the deployed page the form says so instead of failing. Every answer is put on the page as text.
import { el, storage, type Reader } from './admin-common';

export type FormCategory = { slug: string; label: string };
type Order = { count: number; max: number; next: number };
type Analysis = { id: string; width: number; height: number; camera: string | null; inCategories: string[] };
type Added = { path: string; entry: string; id: string; order: number; camera: string | null };

const SERVICE = '/__photos';

// The dev server reloads the page as soon as a new entry appears, which would wipe the confirmation (or even come
// before the service's answer). So the form remembers, for this tab, that it is adding a photo, and after a reload
// asks the service what was written and shows that.
const JUST_ADDED_KEY = 'admin-photo-added';
const JUST_ADDED_MS = 2 * 60 * 1000;
export type JustAdded = { id: string; title: string; category: string; at: number };

export function readJustAdded(): JustAdded | null {
  try {
    const found = JSON.parse(storage.get(JUST_ADDED_KEY) ?? 'null');
    const fresh = found && Date.now() - found.at < JUST_ADDED_MS && Date.now() >= found.at;
    return fresh && typeof found.id === 'string' && typeof found.title === 'string' && typeof found.category === 'string' ? found : null;
  } catch {
    return null;
  }
}

export const forgetJustAdded = () => storage.set(JUST_ADDED_KEY, null);

class ServiceError extends Error {
  constructor(readonly code: string, message = '') {
    super(message);
  }
}

/** Calls the local photo service. Anything that is not its JSON answer (the deployed site's 404 page, no server) is "unavailable". */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE}${path}`, init);
  } catch {
    throw new ServiceError('unreachable');
  }
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // not JSON: handled below
  }
  if (!response.ok) throw new ServiceError(body?.error ?? 'unavailable', body?.message ?? '');
  if (!body) throw new ServiceError('unavailable');
  return body as T;
}

/** Service error codes -> the message keys under pics.form.errors. */
const ERROR_KEYS: Record<string, string> = {
  unavailable: 'unavailable',
  'not-found': 'unavailable',
  unreachable: 'unreachable',
  'not-jpeg': 'notJpeg',
  unreadable: 'unreadable',
  'too-large': 'tooLarge',
  duplicate: 'duplicate',
  'not-local': 'notLocal',
};

export function photoForm(options: {
  m: Reader;
  categories: FormCategory[];
  onAdded: () => void;
  onClose: () => void;
  /** After a reload: show what was just added (`onGone` when the service knows of no such entry). */
  resume?: JustAdded;
  onGone?: () => void;
}): HTMLElement {
  const { m, categories, onAdded, onClose, resume, onGone } = options;
  const t = (key: string, values?: Record<string, string | number>) => m(`pics.form.${key}`, values);
  const labelOf = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug;

  const body = el('div', { class: 'photo-form-body', attrs: { 'aria-live': 'polite' } });
  const root = el('section', { class: 'photo-form', attrs: { 'aria-labelledby': 'photo-form-heading', 'data-photo-form': '' } },
    el('h3', { text: t('heading'), attrs: { id: 'photo-form-heading' } }),
    el('p', { class: 'results-hint', text: t('intro') }),
    body);

  const closeButton = () => {
    const button = el('button', { class: 'results-button', text: t('close'), attrs: { type: 'button', 'data-action': 'close-form' } });
    button.addEventListener('click', () => {
      forgetJustAdded();
      onClose();
    });
    return button;
  };

  const showProblem = (slot: HTMLElement, error: unknown, category = '') => {
    const known = error instanceof ServiceError ? ERROR_KEYS[error.code] : undefined;
    const message = error instanceof ServiceError ? error.message : '';
    slot.textContent = known ? t(`errors.${known}`, { category: labelOf(category) }) : t('errors.failed', { message });
  };

  // --- Is the local service there? -------------------------------------------------------------------------------------

  function start() {
    body.replaceChildren(el('p', { class: 'results-loading', text: t('checking') }));
    call<{ categories: Record<string, Order> }>('/status').then(
      ({ categories: orders }) => renderForm(orders),
      (error) => {
        const key = ERROR_KEYS[error instanceof ServiceError ? error.code : 'unavailable'] ?? 'unavailable';
        body.replaceChildren(el('p', { class: 'results-error', text: t(`errors.${key}`), attrs: { role: 'alert' } }), closeButton());
      }
    );
  }
  /** After a reload: what the service wrote for the photo that was being added. */
  function showAddedBeforeReload({ id, title, category }: JustAdded) {
    body.replaceChildren(el('p', { class: 'results-loading', text: t('checking') }));
    call<Added>(`/entry?category=${encodeURIComponent(category)}&id=${encodeURIComponent(id)}`).then(
      (added) => renderDone(added, title, category),
      () => {
        forgetJustAdded();
        (onGone ?? onClose)();
      }
    );
  }

  if (resume) showAddedBeforeReload(resume);
  else start();

  // --- The form ----------------------------------------------------------------------------------------------------------------

  function renderForm(orders: Record<string, Order>) {
    let analysis: Analysis | null = null;
    let reading = 0; // which file's reading is current (a slower, older one is ignored)
    let orderTouched = false;

    const input = (id: string, attrs: Record<string, string> = {}) => el('input', { attrs: { id: `photo-form-${id}`, name: id, autocomplete: 'off', ...attrs } });
    const field = (id: string, label: string, control: HTMLElement, hint?: HTMLElement) => el('div', { class: 'photo-form-field' }, el('label', { text: label, attrs: { for: `photo-form-${id}` } }), control, hint);

    const file = input('photo', { type: 'file', accept: 'image/jpeg', required: '' });
    const reader = el('p', { class: 'results-hint', attrs: { role: 'status' } });

    // What the photo itself says: shown once it has been read.
    const facts = el('dl', { class: 'pic-facts photo-form-facts' });
    const camera = input('camera', { type: 'text', spellcheck: 'false', 'aria-describedby': 'photo-form-camera-hint' });
    const cameraHint = el('p', { class: 'results-hint', attrs: { id: 'photo-form-camera-hint' } });
    const extracted = el('div', { class: 'photo-form-extracted', attrs: { hidden: '' } }, el('h4', { text: t('extracted') }), facts, field('camera', t('camera'), camera, cameraHint));

    const title = input('title', { type: 'text', required: '' });
    const titleEs = input('titleEs', { type: 'text' });
    const category = el('select', { attrs: { id: 'photo-form-category', name: 'category', required: '' } },
      el('option', { text: t('chooseCategory'), attrs: { value: '' } }),
      ...categories.map((c) => el('option', { text: c.label, attrs: { value: c.slug } })));
    const order = input('order', { type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-describedby': 'photo-form-order-hint' });
    const orderHint = el('p', { class: 'results-hint', text: t('orderChoose'), attrs: { id: 'photo-form-order-hint' } });
    const featured = input('featured', { type: 'checkbox' });

    const problem = el('p', { class: 'results-error', attrs: { role: 'alert' } });
    const status = el('p', { class: 'results-hint', attrs: { role: 'status' } });
    const submit = el('button', { class: 'results-button primary', text: t('submit'), attrs: { type: 'submit' } });
    const form = el('form', { class: 'photo-form-fields', attrs: { 'data-photo-form-fields': '' } },
      field('photo', t('file'), file, reader),
      extracted,
      field('title', t('title'), title),
      field('titleEs', t('titleEs'), titleEs),
      field('category', t('category'), category),
      field('order', t('order'), order, orderHint),
      el('div', { class: 'photo-form-check' }, featured, el('label', { text: t('featured'), attrs: { for: 'photo-form-featured' } })),
      problem, status,
      el('div', { class: 'photo-form-buttons' }, submit, closeButton()));

    /** The order suggested for the chosen category (one past its highest), and what the hint says about it. */
    function suggestOrder() {
      const seen = orders[category.value];
      if (!seen) {
        orderHint.textContent = t('orderChoose');
        return;
      }
      orderHint.textContent = seen.count ? t('orderHint', { category: labelOf(category.value), max: seen.max, next: seen.next }) : t('orderNone', { category: labelOf(category.value), next: seen.next });
      if (!orderTouched) order.value = String(seen.next);
    }

    /** The same photo cannot be in a category twice. */
    function checkDuplicate() {
      problem.textContent = '';
      if (analysis && category.value && analysis.inCategories.includes(category.value)) showProblem(problem, new ServiceError('duplicate'), category.value);
    }

    category.addEventListener('change', () => {
      suggestOrder();
      checkDuplicate();
    });
    order.addEventListener('input', () => {
      orderTouched = order.value.trim() !== ''; // an emptied field goes back to following the category
    });

    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      const run = ++reading;
      analysis = null;
      extracted.hidden = true;
      problem.textContent = '';
      reader.textContent = '';
      if (!chosen) return;
      reader.textContent = t('reading');
      const upload = new FormData();
      upload.set('photo', chosen);
      try {
        const result = await call<Analysis>('/analyze', { method: 'POST', body: upload });
        if (run !== reading) return;
        analysis = result;
        facts.replaceChildren(
          el('dt', { text: t('id') }), el('dd', { text: result.id }),
          el('dt', { text: t('size') }), el('dd', { text: t('sizeValue', { width: result.width, height: result.height }) }));
        camera.value = result.camera ?? '';
        cameraHint.textContent = result.camera ? t('cameraHint') : t('noCamera');
        extracted.hidden = false;
        reader.textContent = '';
        checkDuplicate();
      } catch (error) {
        if (run !== reading) return;
        reader.textContent = '';
        showProblem(problem, error);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      problem.textContent = '';
      if (!analysis || !file.files?.[0]) {
        problem.textContent = t('errors.needFile');
        return;
      }
      const given = order.value.trim();
      if (given !== '' && !/^\d+$/.test(given)) {
        problem.textContent = t('errors.badOrder');
        return;
      }
      if (analysis.inCategories.includes(category.value)) return checkDuplicate();

      const upload = new FormData();
      upload.set('photo', file.files[0]);
      upload.set('title', title.value.trim());
      upload.set('titleEs', titleEs.value.trim());
      upload.set('category', category.value);
      upload.set('order', given);
      upload.set('featured', String(featured.checked));
      upload.set('camera', camera.value.trim());
      submit.disabled = true;
      status.textContent = t('submitting');
      storage.set(JUST_ADDED_KEY, JSON.stringify({ id: analysis.id, title: title.value.trim(), category: category.value, at: Date.now() }));
      try {
        const added = await call<Added>('/add', { method: 'POST', body: upload });
        renderDone(added, title.value.trim(), category.value);
        onAdded();
      } catch (error) {
        forgetJustAdded();
        status.textContent = '';
        submit.disabled = false;
        showProblem(problem, error, category.value);
      }
    });

    body.replaceChildren(form);
    file.focus();
  }

  // --- Done ------------------------------------------------------------------------------------------------------------------

  function renderDone(added: Added, photoTitle: string, category: string) {
    const another = el('button', { class: 'results-button primary', text: t('another'), attrs: { type: 'button', 'data-action': 'add-another' } });
    another.addEventListener('click', () => {
      forgetJustAdded();
      start(); // a fresh form, with the order suggestions read again
    });
    const done = el('div', { class: 'photo-form-done', attrs: { tabindex: '-1', role: 'status' } },
      el('p', { class: 'results-notice', text: t('added', { title: photoTitle, category: labelOf(category), order: added.order }) }),
      el('p', { text: t('written', { path: `src/content/photos/${added.path}` }) }),
      // A scrollable region must be reachable by keyboard, and named.
      el('pre', { class: 'photo-form-entry', text: added.entry, attrs: { tabindex: '0', role: 'region', 'aria-label': t('entryLabel') } }),
      el('p', { class: 'results-hint', text: t('commitNote') }),
      el('div', { class: 'photo-form-buttons' }, another, closeButton()));
    body.replaceChildren(done);
    done.focus();
  }

  return root;
}
