// Remove Results, on the Test Results and Lighthouse Test Results tabs: each run in the list gets a checkbox, with a
// bar above it (how many are chosen, select all / none, Delete selected, Cancel), then a confirmation that names every
// run before anything is deleted. Also the Lighthouse tab's Run in Production and the Test Results tab's Run in CI, which
// each ask for a branch and start a GitHub workflow there.
// All are done by the dev server's local results service (scripts/lib/results-form.mjs), which exists only in
// `astro dev` on the dev box (SITE_ENV=development): writing to R2 is allowed only there.
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


/** Deletes these runs through the local results service (POST /__results/remove or /__results/lighthouse/remove). */
const removeRunsLocally = (store: Store, runIds: string[]) =>
  call<RemovedRuns>(store === 'lighthouse' ? '/lighthouse/remove' : '/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runs: runIds }) });

/** Why a request to the service failed, in words: its own message, or that it isn't answering. */
const reason = (m: Reader, error: Error) => (error.message === 'unavailable' || error.message === 'unreachable' ? m('removal.unreachable') : error.message);

/** A run of a GitHub workflow started from a tab (Run in CI, Run in Production), as the service reports it: GitHub's
 *  status and, once completed, its conclusion. */
export type WorkflowRun = { ref: string; startedAt: string; id: string | null; url: string | null; status: string; conclusion: string | null; finishedAt: string | null; error: string | null; source?: string; target?: string; log?: string[] };
export type CiRun = WorkflowRun;
/** A Run in Production run also names the site it measures and, once ended, the run it published and how the pages did. */
export type LighthouseRun = WorkflowRun & { target: string; runId: string | null; summary: string | null };
type RunAnswer<R> = { run: R | null; pollMs: number; message?: string };

/** Once a Run in Production run has ended, how often the tab asks the results API for the run it published, and for how long at most. */
export const CONFIRM_POLL_MS = 2000;
export const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * The two workflows a tab can start. `keys` is where its texts are (failed, open, lost, unreachable,
 * notFound, branchesFailed, dialog.*); `path` its service addresses (POST/GET `<path>/run`); `prefer` the branch the
 * dialog has chosen when it opens: this checkout's (Run in CI) or main (Run in Production).
 */
export type WorkflowKind = { keys: string; path: string; id: string; prefer: 'checkout' | 'main'; local?: boolean };
/** Run in CI also offers to run every test here, in the local checkout (`local`). */
export const CI_KIND: WorkflowKind = { keys: 'ci', path: '/tests', id: 'ci', prefer: 'checkout', local: true };
/** The dialog's "local checkout" choice: a value no git branch can have (a colon), so never taken for one. */
export const LOCAL_CHECKOUT = ':local';
export const LIGHTHOUSE_KIND: WorkflowKind = { keys: 'lighthouse.production', path: '/lighthouse', id: 'lighthouse', prefer: 'main' };
/** The branch Run in Production chooses unless another is picked. */
export const DEFAULT_BRANCH = 'main';

/**
 * Starts the workflow on GitHub on that branch, or finds the run started from here that is still going. Returns it with
 * how often to ask about it, or what to say when it can't start.
 */
async function startWorkflowRun<R extends WorkflowRun>(m: Reader, kind: WorkflowKind, ref: string): Promise<{ run: R; pollMs: number } | Notice> {
  try {
    const body = JSON.stringify(ref === LOCAL_CHECKOUT ? { where: 'local' } : { ref });
    const response = await fetch(`${RESULTS_SERVICE}${kind.path}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const answer = (await response.json()) as RunAnswer<R>;
    if ((response.status === 202 || response.status === 409) && answer.run) return { run: answer.run, pollMs: answer.pollMs };
    throw new Error(answer.message || 'unavailable');
  } catch (error) {
    return { text: m(`${kind.keys}.failed`, { message: reason(m, error instanceof Error ? error : new Error(String(error))) }), alert: true };
  }
}

/**
 * The run now: null when the service has none (the dev server restarted and forgot it), 'unreachable' when the
 * service isn't answering (it may be restarting).
 */
async function workflowRunNow<R extends WorkflowRun>(kind: WorkflowKind): Promise<R | null | 'unreachable'> {
  try {
    return (await call<RunAnswer<R>>(`${kind.path}/run`)).run;
  } catch {
    return 'unreachable';
  }
}

type Branches = { branches: string[]; current: string; currentOnGitHub: boolean };

/**
 * Asks which branch to run on, before anything starts: a dialog listing the branches on GitHub. Run in CI has the branch
 * this checkout is on chosen (listed even when it isn't on GitHub yet, and then saying it must be pushed first, with
 * Start unavailable until another is chosen); Run in Production has main chosen (or the first branch, if GitHub has no
 * main). Resolves to the branch, null when cancelled (Cancel, Escape), or what to say when the branches couldn't be listed.
 */
export async function chooseBranch(m: Reader, kind: WorkflowKind): Promise<string | null | Notice> {
  const t = (key: string, values?: Record<string, string | number>) => m(`${kind.keys}.${key}`, values);
  let known: Branches;
  try {
    known = await call<Branches>('/branches');
  } catch (error) {
    return { text: t('branchesFailed', { message: reason(m, error instanceof Error ? error : new Error(String(error))) }), alert: true };
  }
  const fromCheckout = kind.prefer === 'checkout';
  const names = !fromCheckout || known.currentOnGitHub || known.current === 'HEAD' ? known.branches : [known.current, ...known.branches];
  const chosen = fromCheckout ? known.current : known.branches.includes(DEFAULT_BRANCH) ? DEFAULT_BRANCH : names[0];
  const selectId = `${kind.id}-branch`;
  const select = el('select', { class: 'ci-branch-select', attrs: { id: selectId, name: 'ref' } });
  for (const name of names) {
    const option = el('option', { text: name === known.current ? t('dialog.thisCheckout', { branch: name }) : name, attrs: { value: name } });
    option.selected = name === chosen;
    select.append(option);
  }
  if (kind.local) select.append(el('option', { text: t('dialog.localCheckout', { branch: known.current }), attrs: { value: LOCAL_CHECKOUT } }));
  const warning = el('p', { class: 'ci-branch-warning', attrs: { id: `${selectId}-warning`, role: 'status' } });
  const start = el('button', { class: 'results-button', text: t('dialog.start'), attrs: { type: 'submit', value: 'start' } });
  const cancel = el('button', { class: 'results-button', text: t('dialog.cancel'), attrs: { type: 'button' } });
  const check = () => {
    const away = select.value !== LOCAL_CHECKOUT && !known.branches.includes(select.value);
    warning.textContent = away ? t('dialog.notOnGitHub', { branch: select.value }) : '';
    start.disabled = away;
    if (away) select.setAttribute('aria-describedby', warning.id);
    else select.removeAttribute('aria-describedby');
  };
  select.addEventListener('change', check);
  const dialog = el('dialog', { class: 'ci-branch-dialog', attrs: { 'aria-labelledby': `${selectId}-title`, 'data-branch-dialog': kind.id } },
    el('form', { attrs: { method: 'dialog' } },
      el('h3', { text: t('dialog.title'), attrs: { id: `${selectId}-title` } }),
      el('p', { class: 'results-hint', text: t('dialog.hint') }),
      el('label', { text: t('dialog.branch'), attrs: { for: selectId } }),
      select,
      warning,
      el('div', { class: 'pics-remove-buttons' }, start, cancel)));
  cancel.addEventListener('click', () => dialog.close(''));
  check();
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      const picked = dialog.returnValue === 'start' && !start.disabled ? select.value : null;
      dialog.remove();
      resolve(picked);
    }, { once: true });
    dialog.showModal();
    select.focus();
  });
}

/** How many checks in a row may go unanswered (a dev server restart) before the tab stops following the run. */
const MISSES_ALLOWED = 5;

/**
 * A workflow run from start to end: asks which branch (nothing starts when the dialog is cancelled), starts the run,
 * tells `update` how it is going after each check, and resolves to the last known run (null when none was started or
 * it was lost) and what to say when following it stopped short or it never started (null: say what the run says). A
 * check nobody answers (the dev server restarting) is tried again, up to MISSES_ALLOWED in a row; an answer without the
 * run means the dev server restarted and forgot it, so it may still be going on GitHub.
 */
export async function runWorkflowAndFollow<R extends WorkflowRun>(
  m: Reader,
  kind: WorkflowKind,
  describe: (run: R) => Notice,
  update: (notice: Notice) => void,
  onStart: () => void,
  /** The page's SITE_ENV (data-site-env): starting runs is the dev box's alone, so anywhere else nothing starts. */
  siteEnv: string
): Promise<{ run: R | null; notice: Notice | null; started: boolean }> {
  const t = (key: string) => m(`${kind.keys}.${key}`);
  // SITE_ENV decides, not a probe of the dev server: on the dev box the branch dialog opens straight away (if the dev
  // server isn't reachable, listing the branches says so); anywhere else, where the button is hidden, nothing starts.
  if (siteEnv !== 'development') return { run: null, notice: null, started: false };
  const chosen = await chooseBranch(m, kind);
  if (chosen === null) return { run: null, notice: null, started: false }; // cancelled: nothing started, nothing to say
  if (typeof chosen !== 'string') return { run: null, notice: chosen, started: false };
  onStart();
  const started = await startWorkflowRun<R>(m, kind, chosen);
  if ('text' in started) return { run: null, notice: started, started: false };
  let known = started.run;
  const onGitHub = () => (known.url ? { href: known.url, linkText: t('open') } : {});
  update(describe(known));
  for (let misses = 0; !known.finishedAt; ) {
    await new Promise((resolve) => setTimeout(resolve, started.pollMs));
    const now = await workflowRunNow<R>(kind);
    if (now === 'unreachable') {
      if (++misses < MISSES_ALLOWED) continue;
      return { run: null, notice: { text: t('unreachable'), alert: true, ...onGitHub() }, started: true };
    }
    misses = 0;
    if (!now) return { run: null, notice: { text: t('lost'), alert: true, ...onGitHub() }, started: true };
    known = now;
    if (!known.finishedAt) update(describe(known));
  }
  return { run: known, notice: null, started: true };
}

/** What to say about a run in the local checkout: under way, passed, or how it ended (its own last line). */
function localRunNotice(m: Reader, run: CiRun): Notice {
  if (!run.finishedAt) return { text: m('ci.local.running', { ref: run.ref }), alert: false };
  if (run.conclusion === 'success') return { text: m('ci.local.passed'), alert: false };
  if (run.conclusion === 'interrupted') return { text: m('ci.local.interrupted'), alert: true };
  return { text: m('ci.local.ended', { message: run.error ?? run.log?.at(-1) ?? run.conclusion ?? '?' }), alert: true };
}

/** Run in CI from start to end (see runWorkflowAndFollow), resolving to what to say at the end and whether a run was started. */
export async function runCiAndFollow(m: Reader, update: (notice: Notice) => void, onStart: () => void, siteEnv: string): Promise<{ notice: Notice | null; started: boolean }> {
  const ended = await runWorkflowAndFollow<CiRun>(m, CI_KIND, (run) => ciRunNotice(m, run), update, onStart, siteEnv);
  return { notice: ended.notice ?? (ended.run ? ciRunNotice(m, ended.run) : null), started: ended.started };
}

/** What to say about a CI run: under way, or how GitHub says it ended; with a link to it on GitHub when known. */
export function ciRunNotice(m: Reader, run: CiRun): Notice {
  if (run.target === 'local checkout') return localRunNotice(m, run);
  const link = run.url ? { href: run.url, linkText: m('ci.open') } : {};
  if (!run.finishedAt) return { text: m('ci.running', { ref: run.ref }), alert: false, ...link };
  if (run.conclusion === 'success') return { text: m('ci.passed'), alert: false, ...link };
  if (run.conclusion === 'not-found') return { text: m('ci.notFound'), alert: true, ...link };
  return { text: m('ci.ended', { conclusion: run.conclusion ?? '?' }), alert: true, ...link };
}

/**
 * What to say about a Run in Production run: under way on GitHub, or how it ended (every page within budget, or its own
 * summary line, or GitHub's conclusion); with a link to it on GitHub when known.
 */
export function lighthouseRunNotice(m: Reader, run: LighthouseRun): Notice {
  const link = run.url ? { href: run.url, linkText: m('lighthouse.production.open') } : {};
  if (!run.finishedAt) return { text: m('lighthouse.production.measuring', { target: run.target, ref: run.ref }), alert: false, ...link };
  if (run.conclusion === 'success') return { text: m('lighthouse.production.done'), alert: false, ...link };
  if (run.conclusion === 'not-found') return { text: m('lighthouse.production.notFound'), alert: true, ...link };
  return { text: m('lighthouse.production.ended', { message: run.summary ?? run.error ?? run.conclusion ?? '?' }), alert: true, ...link };
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
export function startRunRemoval(options: {
  m: Reader;
  store: Store;
  root: HTMLElement;
  redraw: () => void;
  done: (notice: Notice) => void;
  /** The page's SITE_ENV (data-site-env): removing runs is the dev box's alone, so anywhere else nothing starts. */
  siteEnv: string;
}): RunRemoval | null {
  const { m, store, root, redraw, done, siteEnv } = options;
  if (siteEnv !== 'development') return null;

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
      const outcome = await removeRunsLocally(store, runIds);
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
