---
name: test-ci
description: Check this project's GitHub Actions CI. Find the latest run for the current branch or a commit or PR, wait for it to finish if needed, and report each job and failed step. Use whenever the user asks whether CI passed, to check, watch or wait for CI, about a red build or GitHub checks, or before merging, tagging or deploying.
argument-hint: "[branch|commit|PR number|run id]"
---

# Check GitHub Actions CI

Arguments: `$ARGUMENTS`. A branch, a commit SHA, a PR number or a run id. If none is given, use the current
branch's latest commit.

The `CI` workflow (`.github/workflows/ci.yml`) runs on every push to main and every PR:
- **`test` job:** lint, `astro check`, offline Cucumber, browser Cucumber, `npm audit --audit-level=high`, then
  publish the results to R2.
- **`live-smoke` job:** on main only, after the test job. Waits about 5 minutes for Cloudflare's build, then
  smoke-checks the live site.

There is also a scheduled `smoke.yml`.

## Steps

1. Find the run:
   - branch: `gh run list --branch <branch> --workflow CI --limit 5`
   - commit: add `--commit <sha>`
   - PR: `gh pr checks <n>`, then the run id from there
   - run id: use it directly

   Make sure the run is for the commit you mean. If the latest commit has no run yet (just pushed), say so and wait
   for one to appear.
2. If the run is still in progress, wait for it:
   `gh run watch <id> --exit-status --interval 30`. Run it in the background with a long timeout. The test job takes
   about 17 minutes, and live-smoke on main adds about 8 more.
3. Get the outcome:
   `gh run view <id> --json conclusion,headSha,headBranch,url,jobs`.
   For a failed job, read the failing step's log with `gh run view <id> --log-failed`. Find the actual error (the
   failing scenario, lint rule or audit advisory) rather than quoting the tail of the log.

## Report

The run's URL, its commit, and its overall conclusion. Each job and its conclusion. For each failure, the job, the
step and the specific error.

If CI failed but the same check passes locally, say so. That points at an environment difference (Node version,
missing secrets, timing), which is worth knowing before anyone tries to fix the code.

## Failures

A failed job is a failure. A cancelled run isn't: a newer push cancels the older run (`cancel-in-progress`).
Follow `.claude/skills/REPORTING.md` and use `[CI] <job> / <step>: <error>` as the title. Include the run URL.
