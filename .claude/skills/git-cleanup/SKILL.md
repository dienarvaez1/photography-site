---
name: git-cleanup
description: Tidy up a git repo in one sweep — merged and squash-merged branches (local and on the remote), branches whose remote is gone, stale stashes, leftover untracked files, stray local-only tags, and abandoned worktrees — showing every candidate first and deleting only what the user confirms. Use when the user says clean up, tidy the repo, prune branches, delete old branches, "too many branches", housekeeping, or after merging PRs.
argument-hint: "[branches|remote|stashes|untracked|tags|worktrees|all] [--dry-run]"
---

# Clean up the repo

Arguments: `$ARGUMENTS`. With nothing given, check everything (`all`). `--dry-run` reports what it would remove and
changes nothing.

This skill deletes things, and some of them can't be brought back. Its shape is always: **survey, show, confirm,
delete, report.** Never delete in the survey step.

## 1. Survey (read-only)

Start with `git fetch --prune` so remote-tracking refs are current. Note the default branch
(`git symbolic-ref --short refs/remotes/origin/HEAD`, e.g. `origin/main`) and the current branch. Never offer
either for deletion.

Gather each category:

**Local branches**
- **Merged:** `git branch --merged origin/main`.
- **Squash-merged.** Git can't see these as merged, because the PR landed as a new commit. Treat a branch as
  squash-merged if either:
  - its upstream is gone after the prune (`git branch -vv | grep ': gone]'`), or
  - its PR is merged: `gh pr list --state merged --head <branch> --json number,mergedAt`.
- **Not merged:** everything else. List these as stale only if their last commit is more than ~4 weeks old
  (`git for-each-ref --sort=committerdate refs/heads --format='%(committerdate:short) %(refname:short)'`), and show
  `git log --oneline origin/main..<branch>` for each. That's the work deleting it would lose.

**Remote branches**
- `origin/*` branches whose PR is merged or closed, or that are fully merged into the default branch
  (`git branch -r --merged origin/main`). For squash-merged PRs, use the `gh pr list` check above.
- Skip `origin/HEAD` and the default branch, and any protected or release branches (`release/*`, `gh-pages`,
  anything the repo's docs name).

**Stashes:** `git stash list --format='%gd %cr %gs'`, plus `git stash show --stat` for each. Flag ones older than
~2 weeks, and ones whose changes are already in the default branch (try
`git stash show -p <stash> | git apply --check -R`; if it applies in reverse, the changes are already there).

**Untracked and ignored files**
- `git clean -nd` lists untracked files and folders. For each, say what it looks like and whether it's worth
  keeping (a real document or source file) or clutter (logs, temp files, `.DS_Store`).
- `git clean -nd` also lists **empty folders**, which `git status` never shows because git doesn't track them.
  Check with `find <dir> -type f | head` before describing one. An empty folder loses nothing if removed, but a
  tool may expect it to exist (e.g. a framework's content folder), so call it harmless and offer it as low priority.
- Ignored build output (`git clean -ndX`), like `dist/` or `test-results/`, can be listed for the space it takes,
  but it's normally harmless, so only offer it.
- For each untracked file, the choice is one of: **commit** it (/git-commit), **ignore** it (add to `.gitignore`),
  **delete** it, or **leave** it.

**Tags:** local tags that aren't on the remote (compare `git tag -l` with `git ls-remote --tags origin`). They may be
work in progress. Offer to push or delete each one; never delete a tag that's on the remote here (that's /git-tag's
job, with its own confirmation).

**Worktrees:** `git worktree list`, plus `git worktree prune --dry-run` for ones whose folder is gone.

## 2. Show the plan

One table per category that has candidates, with the reason for each: "PR #2 merged 30 Sep", "upstream gone",
"no commits since 12 Aug, 3 unmerged commits". Group by risk:

- **Safe:** fully merged, or squash-merged with a merged PR. Nothing is lost.
- **Check:** unmerged commits, untracked files that look like real work, old stashes with unique changes.

If nothing needs cleaning, say so and stop.

## 3. Confirm

Ask once, letting the user choose:
- all the safe items
- safe items plus specific risky ones
- per category
- nothing

Deleting remote branches affects everyone using the repo, so name that in the question. With `--dry-run`, stop
after the plan.

## 4. Delete what was confirmed

| What | Command |
|---|---|
| Merged local branch | `git branch -d <name>` |
| Squash-merged or confirmed-unmerged local branch | `git branch -D <name>` (git can't tell it's merged) |
| Remote branch | `git push origin --delete <name>` |
| Stash | `git stash drop <stash>`, newest index first so the others don't shift. Record each hash it prints. |
| Untracked file | `git clean -f -- <path>` (or `-fd` for a folder), one path at a time, never a blanket `git clean -fd` |
| Ignore instead | Append to `.gitignore` |
| Worktree | `git worktree remove <path>`, or `git worktree prune` for missing ones |
| Local-only tag | `git tag -d <tag>` |

Before deleting an unmerged branch, print its tip hash. Afterwards it can be restored with
`git branch <name> <sha>`, and that's the only easy undo.

## 5. Report

What was removed, by category, with the restore hashes for branches and stashes. Then list what was kept and why,
and what's left (`git branch -vv`, `git stash list`, `git status --short`).
