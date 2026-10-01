---
name: git-merge
description: Combine work between git branches — merge or rebase a branch onto another, bring main into a feature branch, cherry-pick specific commits, and resolve conflicts file by file (or abort cleanly). Use when the user says merge, rebase, "update my branch with main", cherry-pick, "take that commit onto this branch", or has merge conflicts.
argument-hint: "merge|rebase|pick <branch|sha> | conflicts | abort"
---

# Merge, rebase, cherry-pick

Arguments: `$ARGUMENTS`.

Start from a clean working tree (commit or stash first) and fresh refs (`git fetch`). Note `git rev-parse HEAD`
so it's easy to undo.

## Choose

| Goal | Command |
|---|---|
| Bring main into my feature branch, keep history as-is | `git merge origin/main` |
| Replay my unpushed branch on top of the latest main (linear history) | `git rebase origin/main` |
| Land a branch into main locally | Prefer a PR (/git-pr). Otherwise `git switch main && git merge --no-ff <branch>` (or `--ff-only`) |
| Take one or a few commits from elsewhere | `git cherry-pick <sha>…` (`-x` records where it came from) |

Don't rebase commits other people already have (pushed to a shared branch) — merge instead. Rebasing your own
pushed feature branch is fine but needs `--force-with-lease` afterwards.

## Conflicts

1. List them: `git diff --name-only --diff-filter=U`.
2. For each file, read both sides and *why* each changed (`git log --oneline -3 <side> -- <file>`). Resolve to what
   both changes intended, not just one side. Lockfiles: take one side, then regenerate with the package manager.
3. Remove every conflict marker (`grep -nE '^(<<<<<<<|=======|>>>>>>>)' <file>`), run the relevant tests or build,
   then `git add <file>`.
4. Continue: `git merge --continue`, `git rebase --continue` (repeats per commit) or `git cherry-pick --continue`.
   Set `GIT_EDITOR=true` so no editor opens for the message.
5. When a resolution is a judgment call (both sides changed behavior), show it to the user before continuing.

**Abort** at any point to get back to before it started: `git merge --abort`, `git rebase --abort`,
`git cherry-pick --abort`.

## Report

What was combined, the new `git log --oneline --graph -10`, each conflict and how it was resolved, and whether a
push (or force push) is now needed.
