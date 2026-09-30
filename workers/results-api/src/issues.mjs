// Read-only view of the site's GitHub issues for the Admin page's GitHub Issues tab. The repository is public, so no
// GitHub token is needed; one (GITHUB_TOKEN, any fine-grained token with read access to issues) only raises GitHub's
// rate limit from 60 to 5,000 requests an hour, which matters because Workers share their outgoing addresses.
// Pull requests are left out (GitHub's issues list includes them), and only the fields the tab shows are passed on.

export const ISSUE_STATES = ['open', 'closed', 'all'];
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const COLOR = /^[0-9a-fA-F]{6}$/;
const PER_PAGE = 100;

export class GitHubError extends Error {
  constructor(kind, status) {
    super(kind);
    this.kind = kind; // 'misconfigured', 'rate-limited' or 'upstream'
    this.status = status;
  }
}

const isRepo = (repo) => REPO.test(repo) && !repo.includes('..');

function slim(issue) {
  return {
    number: issue.number,
    title: String(issue.title ?? ''),
    state: issue.state === 'closed' ? 'closed' : 'open',
    stateReason: issue.state_reason ?? null,
    url: String(issue.html_url ?? ''),
    author: issue.user?.login ?? null,
    labels: (issue.labels ?? [])
      .map((label) => (typeof label === 'string' ? { name: label, color: null } : { name: String(label.name ?? ''), color: COLOR.test(label.color ?? '') ? label.color.toLowerCase() : null }))
      .filter((label) => label.name),
    comments: Number(issue.comments) || 0,
    createdAt: issue.created_at ?? null,
    updatedAt: issue.updated_at ?? null,
    closedAt: issue.closed_at ?? null,
  };
}

/**
 * The newest-updated issues of `env.GITHUB_REPO` in one state: { repo, state, issues, complete }. One page of GitHub's
 * list (100 entries, pull requests included), so `complete` is false when there may be more. `fetcher` is injectable for
 * tests.
 */
export async function listIssues(env, state, fetcher = fetch) {
  const repo = String(env.GITHUB_REPO ?? '');
  if (!isRepo(repo)) throw new GitHubError('misconfigured', 500);
  const url = `https://api.github.com/repos/${repo}/issues?state=${state}&sort=updated&direction=desc&per_page=${PER_PAGE}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'photography-site-results' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  let response;
  try {
    response = await fetcher(url, { headers });
  } catch {
    throw new GitHubError('upstream', 502);
  }
  if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') throw new GitHubError('rate-limited', 429);
  if (!response.ok) throw new GitHubError('upstream', 502);
  let list;
  try {
    list = await response.json();
  } catch {
    throw new GitHubError('upstream', 502);
  }
  if (!Array.isArray(list)) throw new GitHubError('upstream', 502);
  return { repo, state, issues: list.filter((issue) => !issue.pull_request).map(slim), complete: list.length < PER_PAGE };
}
