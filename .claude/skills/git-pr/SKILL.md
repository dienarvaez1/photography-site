---
name: git-pr
description: Run a GitHub pull request end to end with the gh CLI — open it with a good title and description, check or wait for CI, review its status, merge it (squash, merge or rebase), delete the branch, and bring the default branch up to date. Use when the user says open/create a PR, pull request, "is my PR green", check PR status, merge the PR, or land this branch.
argument-hint: "open|status|merge [PR number] [--squash|--merge|--rebase]"
---

# Pull requests

Arguments: `$ARGUMENTS`. With no action: open a PR for the current branch if it has none, otherwise show its status.

## Open

1. Make sure the branch is pushed and up to date (/git-push).
2. Read what the PR contains: `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD --stat`
   (use the repo's real default branch).
3. Title: the change in one line. Body: what and why, how it was tested, anything reviewers should look at
   (screenshots for UI changes, follow-ups). Match the style of recent PRs (`gh pr list --state merged --limit 5`)
   and add any attribution footer the session's instructions ask for.
4. `gh pr create --title … --body-file <file>` (write the body to a temp file; `--draft` if it isn't ready).

## Status

`gh pr view <n> --json state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,url` and `gh pr checks <n>`.
Report: checks (pass/fail/pending, with the failing one's name), reviews, conflicts, and whether it can merge.
For a failed check, read the failure (`gh run view <id> --log-failed`) and say what broke.

Waiting for CI: `gh pr checks <n> --watch --interval 30` in the background, with a long timeout.

## Merge

1. Only with checks green, or the user explicitly says to merge anyway. If conflicts or required reviews block it,
   say so — don't use `--admin` to bypass protection unless asked.
2. Method — follow the repo's habit (look at how recent PRs were merged) unless told otherwise:
   - `--squash`: one tidy commit on main (good for branches with messy history)
   - `--merge`: keeps every commit plus a merge commit
   - `--rebase`: replays each commit, no merge commit
3. `gh pr merge <n> --<method> --delete-branch`.
4. Afterwards: `git switch main && git pull --ff-only`, and delete the local branch if it's still there.
5. If merging to main triggers CI or a deploy, mention it and offer to watch the run.

## Report

The PR URL and state; after a merge, the merge commit on main and the CI run it started.
