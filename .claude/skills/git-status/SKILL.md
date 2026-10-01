---
name: git-status
description: Give a clear picture of where the git repo stands — current branch, ahead/behind its remote, staged/unstaged/untracked files, stashes, and any merge/rebase/cherry-pick in progress — and suggest the sensible next step. Use when the user asks "where am I", "what's the state of the repo", "what's changed", "am I up to date", git status, or seems lost mid-operation.
---

# Where the repo stands

Read-only: this skill never changes anything.

## Gather (in parallel)

- `git status --porcelain=v2 --branch` — branch, upstream, ahead/behind, and every file's state
- `git fetch --quiet` first if the user wants to know whether they're up to date (ahead/behind is only as fresh as
  the last fetch — say which you're reporting)
- `git stash list`
- `git log --oneline -5`
- In-progress operations: check for `MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`,
  `REVERT_HEAD`, `BISECT_LOG` (locate each with `git rev-parse --git-path <name>` so it works in worktrees)
- Detached HEAD: `git symbolic-ref -q HEAD` fails

## Report

Short, in this order, skipping empty sections:

1. **Branch** — name (or "detached at <sha>"), upstream, ahead/behind. Flag being on the default branch with local
   commits that aren't pushed.
2. **In progress** — a merge/rebase/cherry-pick/bisect, with how to continue or abort.
3. **Changes** — staged, unstaged, untracked, conflicted; counts, then the files (group if many).
4. **Stashes** — count and the newest few names.
5. **Next step** — one suggestion, e.g. "commit these (/git-commit)", "pull 3 new commits (/git-sync)", "finish the
   rebase".
