// The Admin page's GitHub Issues viewer. It reads the site's issues through the results API (which asks GitHub), behind
// the same admin token as the other tabs, and links each one to GitHub, where it is answered or closed: the tab only
// reads. Built like the Lighthouse viewer (lighthouse-viewer.ts); everything from the API is put on the page as text.
import { formatDate, resolveApiUrl } from './results-view';
import { AUTH_EVENT, REFRESH_EVENT, ApiError, apiGet, el, errorMessage, messageReader, parseJson, remembered, type Child, type Messages, type Reader, leaveToGate } from './admin-common';

export const ISSUE_STATES = ['open', 'closed', 'all'] as const;
export type IssueState = (typeof ISSUE_STATES)[number];
type Label = { name: string; color: string | null };
type Issue = { number: number; title: string; state: 'open' | 'closed'; stateReason: string | null; url: string; author: string | null; labels: Label[]; comments: number; createdAt: string | null; updatedAt: string | null; closedAt: string | null };
type Answer = { repo: string; state: IssueState; issues: Issue[]; complete: boolean };

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/** Only links to GitHub itself are ever followed. */
const isGitHubLink = (link: string) => {
  try {
    return new URL(link).origin === 'https://github.com';
  } catch {
    return false;
  }
};

/** The results service's own errors for this tab (GitHub's rate limit, GitHub down, no repository set). */
function issuesError(m: Reader, error: unknown) {
  const kind = error instanceof ApiError && error.kind === 'generic' ? { 429: 'rateLimited', 502: 'upstream', 500: 'misconfigured' }[error.status] : undefined;
  return kind ? m(`issues.errors.${kind}`) : errorMessage(m, error);
}

export function mountIssuesViewer(container: HTMLElement, panel: HTMLElement) {
  const root = container.querySelector<HTMLElement>('[data-issues-root]')!;
  const messages = parseJson<Messages>(container.dataset.messages ?? '{}');
  const locale = container.dataset.locale ?? 'en';
  const apiUrl = resolveApiUrl(container.dataset.api ?? '', location.search, location.hostname);
  const m = messageReader(messages);

  let token = remembered.get();
  let wanted: IssueState = 'open';
  let generation = 0; // a newer render makes older, slower answers stale
  let displayed: IssueState | null = null;

  const show = (...nodes: Child[]) => {
    root.replaceChildren(...(nodes.filter(Boolean) as Node[]));
    root.removeAttribute('aria-busy');
  };

  // Signing in is the page's own token box (admin-gate.ts); without a token this tab shows nothing.
  const renderGate = (problem?: unknown) => leaveToGate(root, problem);

  function externalLink(text: string, href: string, className?: string) {
    const link = el('a', { class: className, text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
    link.append(el('span', { class: 'visually-hidden', text: ` ${m('issues.newTab')}` }));
    return link;
  }

  /** Open / Closed / All, as toggle buttons: the pressed one is what the list shows. */
  function filterBar(repo: string | null) {
    const buttons = ISSUE_STATES.map((state) => {
      const button = el('button', { class: 'results-button', text: m(`issues.filter.${state}`), attrs: { type: 'button', 'aria-pressed': String(state === wanted), 'data-state': state } });
      button.addEventListener('click', () => {
        if (state === wanted) return;
        wanted = state;
        void render();
      });
      return button;
    });
    const links = repo
      ? [externalLink(m('issues.new'), `https://github.com/${repo}/issues/new`, 'results-button primary issues-new'), externalLink(m('issues.onGitHub'), `https://github.com/${repo}/issues`, 'issues-all')]
      : [];
    return el('div', { class: 'pics-summary issues-toolbar' },
      el('div', { class: 'issues-filter', attrs: { role: 'group', 'aria-label': m('issues.filter.label') } }, ...buttons),
      el('div', { class: 'pics-actions' }, ...links));
  }

  function statusBadge(issue: Issue) {
    const notPlanned = issue.state === 'closed' && issue.stateReason === 'not_planned';
    const key = issue.state === 'open' ? 'open' : notPlanned ? 'notPlanned' : 'closed';
    return el('span', { class: `results-badge issue-state ${key === 'open' ? 'ok' : ''}`, text: m(`issues.status.${key}`) });
  }

  function labelList(labels: Label[]) {
    if (!labels.length) return null;
    return el('ul', { class: 'issue-labels', attrs: { 'aria-label': m('issues.labels') } },
      ...labels.map((label) => {
        const chip = el('li', { class: 'issue-label', text: label.name });
        // A style property, not a style attribute: the page's policy allows no inline styles.
        if (label.color) chip.style.setProperty('--label', `#${label.color}`);
        return chip;
      }));
  }

  function issueRow(issue: Issue) {
    const meta = [
      m('issues.opened', { number: issue.number, date: formatDate(issue.createdAt, locale), author: issue.author ?? '–' }),
      issue.state === 'closed' ? m('issues.closed', { date: formatDate(issue.closedAt, locale) }) : m('issues.updated', { date: formatDate(issue.updatedAt, locale) }),
      m('issues.comments', { count: issue.comments }),
    ].join(' · ');
    const title = isGitHubLink(issue.url) ? externalLink(issue.title, issue.url, 'issue-title') : el('span', { class: 'issue-title', text: issue.title });
    return el('li', { class: 'issue' },
      el('div', { class: 'issue-head' }, title, statusBadge(issue)),
      el('p', { class: 'issue-meta', text: meta }),
      labelList(issue.labels));
  }

  async function renderList(run: number) {
    const answer = await apiGet<Answer>(apiUrl, token, `/github/issues?state=${wanted}`);
    if (run !== generation) return;
    const repo = REPO.test(answer.repo) ? answer.repo : null;
    const { issues } = answer;
    const nodes: Child[] = [filterBar(repo)];
    if (!issues.length) nodes.push(el('p', { class: 'results-empty', text: m(`issues.empty.${wanted}`) }));
    else {
      nodes.push(
        el('p', { class: 'results-count', text: answer.complete ? m('issues.count', { count: issues.length }) : m('issues.more', { count: issues.length }) }),
        el('ul', { class: 'issue-list' }, ...issues.map(issueRow))
      );
    }
    displayed = wanted;
    show(...nodes);
  }

  async function render() {
    const run = ++generation;
    if (!token) {
      displayed = null;
      return renderGate();
    }
    root.setAttribute('aria-busy', 'true');
    show(el('p', { class: 'results-loading', text: m('loading') }));
    try {
      await renderList(run);
    } catch (error) {
      if (run !== generation) return;
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'notConfigured')) {
        token = '';
        displayed = null;
        remembered.set('');
        renderGate(error);
      } else {
        displayed = null;
        show(filterBar(null), el('p', { class: 'results-error', text: issuesError(m, error), attrs: { role: 'alert' } }));
      }
    }
  }

  // Nothing is requested while the tab is hidden; showing it loads the list, unless it is already shown.
  const sync = () => {
    if (!panel.hidden && (token ? displayed !== wanted : !root.querySelector('form'))) void render();
  };
  // A sign-in or sign-out in another tab of the page applies here too.
  window.addEventListener(AUTH_EVENT, () => {
    const next = remembered.get();
    if (next === token) return;
    token = next;
    displayed = null;
    generation++;
    sync();
  });
  window.addEventListener(REFRESH_EVENT, () => {
    if (!panel.hidden && token) void render();
  });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(sync, 0);
}
