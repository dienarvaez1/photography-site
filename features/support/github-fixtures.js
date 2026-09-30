// A stand-in for GitHub's REST API (GET /repos/<owner>/<name>/issues), for the results API's GitHub Issues route. It
// answers the way GitHub does, pull requests included, from a table of made-up issues, and records every request.

/** One GitHub issue as GitHub's API returns it, from a table row: number, title, state, labels, author, comments, updated. */
export function gitHubIssue(row, repo = 'owner/site') {
  const number = Number(row.number);
  const labels = (row.labels ?? '').split(',').map((l) => l.trim()).filter(Boolean);
  const closed = row.state === 'closed' || row.state === 'not planned';
  return {
    number,
    title: row.title,
    state: closed ? 'closed' : 'open',
    state_reason: row.state === 'not planned' ? 'not_planned' : closed ? 'completed' : null,
    html_url: `https://github.com/${repo}/issues/${number}`,
    user: { login: row.author || 'someone' },
    labels: labels.map((name, i) => ({ id: i, name, color: ['d73a4a', '0e8a16', 'fbca04'][i % 3], description: '' })),
    comments: Number(row.comments || 0),
    created_at: '2026-09-01T10:00:00Z',
    updated_at: row.updated ?? '2026-09-20T10:00:00Z',
    closed_at: closed ? row.updated ?? '2026-09-20T10:00:00Z' : null,
    body: 'Not passed on by the API.',
    ...(row.kind === 'pull request' ? { pull_request: { url: `https://api.github.com/repos/${repo}/pulls/${number}` } } : {}),
  };
}

/**
 * A fetcher answering like GitHub. `mode`: 'ok', 'rate-limited', 'down' (a 500) or 'unreachable' (no answer at all).
 * Filters by ?state= and sorts by update time, newest first, as GitHub does for sort=updated&direction=desc.
 */
export function fakeGitHub(rows = [], { repo = 'owner/site' } = {}) {
  const github = { mode: 'ok', calls: [], issues: rows.map((row) => gitHubIssue(row, repo)) };
  github.fetcher = async (url, init = {}) => {
    github.calls.push({ url: String(url), headers: { ...init.headers } });
    if (github.mode === 'unreachable') throw new TypeError('fetch failed');
    if (github.mode === 'rate-limited') return new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    if (github.mode === 'down') return new Response('oops', { status: 500 });
    const state = new URL(url).searchParams.get('state') ?? 'open';
    const list = github.issues.filter((issue) => state === 'all' || issue.state === state).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return new Response(JSON.stringify(list), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '59' } });
  };
  return github;
}

/** Stands in for GitHub where a scenario sets none up: the tests never reach the real one. */
export const noGitHub = async () => {
  throw new TypeError('GitHub is not reachable from the tests');
};
