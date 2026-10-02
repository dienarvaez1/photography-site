// Remove Results, on the Test Results and Lighthouse Test Results tabs: each run in the list gets a checkbox, with a
// bar above it (how many are chosen, select all / none, Delete selected, Cancel), then a confirmation that names every
// run before anything is deleted. Also the Lighthouse tab's Run in Production and the Test Results tab's Run in CI.
// All are done by the local results
// service (scripts/lib/results-form.mjs), which exists only in `astro dev`: the results API the tabs read from is
// read-only.
// Loaded when one of those buttons is first pressed. Built like the Pics Viewer's Remove Photos bar (photo-remove.ts),
// with its styles. Every answer is put on the page as text.
import { el, type Notice, type Reader } from './admin-common';

export const RESULTS_SERVICE = '/__results';

/** Which runs: the test results (`results/`) or the Lighthouse results (`lighthouse-results/`). */
export type Store = 'tests' | 'lighthouse';
export type RemovedRuns = { removed: string[]; missing: string[]; failed: { runId: string; error: string }[] };
export type { Notice };

/** Calls the local results service. Anything that isn't its JSON answer (the deployed site, no server) is "unavailable". */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RESULTS_SERVICE}${path}`, init);
  } catch {
    throw new Error('unreachable');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON: handled below
  }
  if (!response.ok || !body) throw new Error((body as { message?: string } | null)?.message || 'unavailable');
  return body as T;
}

const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Is the local results service there? (Only while the site runs on the owner's computer.) */
export async function resultsServiceAvailable(): Promise<boolean> {
  try {
    await call('/status');
    return true;
  } catch {
    return false;
  }
}

const removeRuns = (store: Store, runIds: string[]) => post<RemovedRuns>(store === 'lighthouse' ? '/lighthouse/remove' : '/remove', { runs: runIds });

/** Why a request to the service failed, in words: its own message, or that it isn't answering. */
const reason = (m: Reader, error: Error) => (error.message === 'unavailable' || error.message === 'unreachable' ? m('removal.unreachable') : error.message);

/** A Run in Production measurement, as the service reports it. */
export type Measurement = { target: string; startedAt: string; finishedAt: string | null; ok: boolean | null; exitCode: number | null; error: string | null; log: string[] };

/** How often the tab asks how a measurement is going (a request to this computer, nothing more). */
export const MEASURE_POLL_MS = 3000;

/**
 * Starts measuring the production site with Lighthouse on this computer (or finds the measurement already running).
 * Returns it, or what to say when it can't start (only on the owner's computer, the service refused).
 */
export async function startProductionRun(m: Reader): Promise<Measurement | Notice> {
  if (!(await resultsServiceAvailable())) return { text: m('lighthouse.production.onlyLocal'), alert: false };
  try {
    const response = await fetch(`${RESULTS_SERVICE}/lighthouse/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = (await response.json()) as { run?: Measurement; message?: string };
    if ((response.status === 202 || response.status === 409) && body.run) return body.run;
    throw new Error(body.message || 'unavailable');
  } catch (error) {
    return { text: m('lighthouse.production.failed', { message: reason(m, error instanceof Error ? error : new Error(String(error))) }), alert: true };
  }
}

/** The measurement now (null when the service has none, or isn't answering). */
export async function productionRunNow(): Promise<Measurement | null> {
  try {
    return (await call<{ run: Measurement | null }>('/lighthouse/run')).run;
  } catch {
    return null;
  }
}

/** What to say about a measurement: under way, done within budget, or how it ended (its own last line). */
export function measurementNotice(m: Reader, run: Measurement): Notice {
  if (!run.finishedAt) return { text: m('lighthouse.production.measuring', { target: run.target }), alert: false };
  if (run.ok) return { text: m('lighthouse.production.done'), alert: false };
  const last = run.error ?? run.log.at(-1) ?? m('lighthouse.production.noOutput');
  return { text: m('lighthouse.production.ended', { message: last }), alert: true };
}

/** A Run in CI run, as the service reports it (GitHub's status and, once completed, its conclusion). */
export type CiRun = { ref: string; startedAt: string; id: string | null; url: string | null; status: string; conclusion: string | null; finishedAt: string | null; error: string | null };
type CiAnswer = { run: CiRun | null; pollMs: number; message?: string };

/**
 * Starts the CI workflow (every Cucumber test) on GitHub, or finds the run started from here that is still going.
 * Returns it with how often to ask about it, or what to say when it can't start.
 */
export async function startCiRun(m: Reader): Promise<{ run: CiRun; pollMs: number } | Notice> {
  if (!(await resultsServiceAvailable())) return { text: m('ci.onlyLocal'), alert: false };
  try {
    const response = await fetch(`${RESULTS_SERVICE}/tests/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = (await response.json()) as CiAnswer;
    if ((response.status === 202 || response.status === 409) && body.run) return { run: body.run, pollMs: body.pollMs };
    throw new Error(body.message || 'unavailable');
  } catch (error) {
    return { text: m('ci.failed', { message: reason(m, error instanceof Error ? error : new Error(String(error))) }), alert: true };
  }
}

/**
 * The CI run now: null when the service has none (the dev server restarted and forgot it), 'unreachable' when the
 * service isn't answering (it may be restarting).
 */
export async function ciRunNow(): Promise<CiRun | null | 'unreachable'> {
  try {
    return (await call<CiAnswer>('/tests/run')).run;
  } catch {
    return 'unreachable';
  }
}

/** How many checks in a row may go unanswered (a dev server restart) before the tab stops following the run. */
const CI_MISSES_ALLOWED = 5;

/**
 * Run in CI from start to end: starts the run, tells `update` how it is going after each check, and resolves to what to
 * say at the end and whether a run was started at all. A check nobody answers (the dev server restarting) is tried
 * again, up to CI_MISSES_ALLOWED in a row; an answer without the run means the dev server restarted and forgot it, so
 * it may still be going on GitHub.
 */
export async function runCiAndFollow(m: Reader, update: (notice: Notice) => void): Promise<{ notice: Notice; started: boolean }> {
  const started = await startCiRun(m);
  if ('text' in started) return { notice: started, started: false };
  let known = started.run;
  const onGitHub = () => (known.url ? { href: known.url, linkText: m('ci.open') } : {});
  update(ciRunNotice(m, known));
  for (let misses = 0; !known.finishedAt; ) {
    await new Promise((resolve) => setTimeout(resolve, started.pollMs));
    const now = await ciRunNow();
    if (now === 'unreachable') {
      if (++misses < CI_MISSES_ALLOWED) continue;
      return { notice: { text: m('ci.unreachable'), alert: true, ...onGitHub() }, started: true };
    }
    misses = 0;
    if (!now) return { notice: { text: m('ci.lost'), alert: true, ...onGitHub() }, started: true };
    known = now;
    if (!known.finishedAt) update(ciRunNotice(m, known));
  }
  return { notice: ciRunNotice(m, known), started: true };
}

/** What to say about a CI run: under way, or how GitHub says it ended; with a link to it on GitHub when known. */
export function ciRunNotice(m: Reader, run: CiRun): Notice {
  const link = run.url ? { href: run.url, linkText: m('ci.open') } : {};
  if (!run.finishedAt) return { text: m('ci.running', { ref: run.ref }), alert: false, ...link };
  if (run.conclusion === 'success') return { text: m('ci.passed'), alert: false, ...link };
  if (run.conclusion === 'unknown') return { text: m('ci.started', { ref: run.ref }), alert: false, ...link };
  return { text: m('ci.ended', { conclusion: run.conclusion ?? '?' }), alert: true, ...link };
}

/** How many runs the confirmation names one by one before "…and N more". */
const NAMED = 10;

export interface RunRemoval {
  /** Choosing runs, or confirming: the list shows checkboxes and the bar instead of the Remove Results button. */
  readonly active: boolean;
  /** The bar for the runs listed now (newest first). */
  bar(runs: { runId: string; label: string }[]): HTMLElement;
  /** A run's checkbox. */
  check(runId: string): HTMLInputElement;
  /** Leaves choosing without deleting anything. */
  cancel(): void;
}

/**
 * Remove Results for one tab. `redraw` draws the list again from what it last read (ticking never asks the API);
 * `done` gets what to say after a removal and reads the list again. Returns null (with the reason) when the local
 * service isn't there, as on the deployed site.
 */
export async function startRunRemoval(options: { m: Reader; store: Store; root: HTMLElement; redraw: () => void; done: (notice: Notice) => void }): Promise<RunRemoval | Notice> {
  const { m, store, root, redraw, done } = options;
  if (!(await resultsServiceAvailable())) return { text: m('removal.onlyLocal'), alert: false };

  const t = (key: string, values?: Record<string, string | number>) => m(`removal.${key}`, values);
  const plural = (base: string, count: number) => t(count === 1 ? `${base}One` : base, { count });
  const selected = new Set<string>();
  let active = true;
  let runs: { runId: string; label: string }[] = [];

  const element = el('div', { class: 'pics-remove-bar', attrs: { 'data-remove-bar': '' } });
  const button = (text: string, onClick: () => void, extra = '') => {
    const node = el('button', { class: `results-button ${extra}`.trim(), text, attrs: { type: 'button' } });
    node.addEventListener('click', onClick);
    return node;
  };

  // --- Choosing ------------------------------------------------------------------------------------------------------

  const count = el('p', { class: 'pics-remove-count', attrs: { role: 'status' } });
  const allTicked = () => runs.length > 0 && runs.every((run) => selected.has(run.runId));
  const toggleAll = button('', () => {
    const all = !allTicked();
    selected.clear();
    if (all) for (const run of runs) selected.add(run.runId);
    for (const box of root.querySelectorAll<HTMLInputElement>('input.run-check')) box.checked = selected.has(box.dataset.runId ?? '');
    update();
  });
  const remove = button(t('delete'), () => confirm(), 'danger');
  const cancelButton = button(t('cancel'), () => cancel());

  function choosing() {
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', t('barLabel'));
    element.removeAttribute('aria-labelledby');
    element.removeAttribute('aria-busy');
    element.replaceChildren(count, el('div', { class: 'pics-remove-buttons' }, toggleAll, remove, cancelButton));
    update();
  }

  function update() {
    count.textContent = t('selected', { count: selected.size });
    toggleAll.textContent = allTicked() ? t('selectNone') : t('selectAll');
    remove.disabled = selected.size === 0;
  }

  function cancel() {
    active = false;
    selected.clear();
    redraw();
  }

  // --- Confirming: every run is named before anything is deleted -------------------------------------------------------

  function confirm() {
    const chosen = runs.filter((run) => selected.has(run.runId));
    if (!chosen.length) return;
    const warning = el('p', { class: 'pics-remove-warning', text: plural('confirm', chosen.length), attrs: { id: `${store}-remove-warning`, tabindex: '-1' } });
    const named = chosen.slice(0, NAMED).map((run) => el('li', { text: run.label }));
    const more = chosen.length > NAMED ? [el('li', { text: t('more', { count: chosen.length - NAMED }) })] : [];
    const yes = button(plural('yes', chosen.length), () => void run(chosen.map((r) => r.runId)), 'danger');
    const keep = button(t('keep'), choosing);
    element.setAttribute('aria-labelledby', warning.id);
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
    remove.focus();
  }

  // --- Deleting ----------------------------------------------------------------------------------------------------------

  async function run(runIds: string[]) {
    element.removeEventListener('keydown', escape);
    element.setAttribute('aria-busy', 'true');
    element.replaceChildren(el('p', { class: 'pics-remove-count', text: plural('deleting', runIds.length), attrs: { role: 'status' } }));
    let notice: Notice;
    try {
      const outcome = await removeRuns(store, runIds);
      const parts = [outcome.removed.length ? plural('done', outcome.removed.length) : ''];
      if (outcome.missing.length) parts.push(t('missing', { runs: outcome.missing.join(', ') }));
      for (const f of outcome.failed) parts.push(t('failed', { id: f.runId, message: f.error }));
      notice = { text: parts.filter(Boolean).join(' '), alert: outcome.failed.length > 0 || outcome.missing.length > 0 };
    } catch (error) {
      notice = { text: t('requestFailed', { message: reason(m, error instanceof Error ? error : new Error(String(error))) }), alert: true };
    }
    active = false;
    selected.clear();
    done(notice);
  }

  choosing();
  return {
    get active() {
      return active;
    },
    bar(listed) {
      runs = listed;
      for (const id of [...selected]) if (!runs.some((r) => r.runId === id)) selected.delete(id);
      update();
      return element;
    },
    check(runId) {
      const box = el('input', { class: 'run-check', attrs: { type: 'checkbox', 'data-run-id': runId, 'aria-label': t('select', { id: runId }) } });
      box.checked = selected.has(runId);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(runId);
        else selected.delete(runId);
        update();
      });
      return box;
    },
    cancel,
  };
}
