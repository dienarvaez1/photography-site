---
name: git-sync
description: Bring the current branch (or the default branch) up to date with its remote safely — fetch, then fast-forward or rebase, setting aside and restoring uncommitted work — and report what came in. Use when the user says pull, sync, update, get latest, catch up with main, or "is my branch behind".
argument-hint: "[--rebase|--merge] [branch]"
---

# Sync with the remote

Arguments: `$ARGUMENTS`.

## Steps

1. `git fetch --prune` and work out the situation: `git rev-list --left-right --count HEAD...@{u}` (ahead, behind).
   No upstream → say so and offer to set one (`git branch -u origin/<branch>`) rather than guessing.
2. Nothing behind → say it's up to date and stop.
3. Uncommitted changes → `git stash push -u -m "git-sync: before pull <date>"`, and restore it at the end with
   `git stash pop`. If the pop conflicts, stop, leave the stash in place, and explain.
4. Update:
   - **Only behind** → `git merge --ff-only @{u}`.
   - **Diverged** (ahead and behind) → don't pick silently. Default to `git rebase @{u}` for a personal feature
     branch with unpushed commits; use a merge if the user asked, or if the local commits are already pushed
     somewhere others use (rebasing would rewrite shared history). On the default branch, local commits that
     diverged usually mean work committed to the wrong branch — say so and suggest moving them to a branch
     (/git-branch) instead.
   - Conflicts → stop, list the files, and hand over to /git-merge's conflict steps. `git rebase --abort` /
     `git merge --abort` gets back to where you were.
5. Syncing a branch you're not on (e.g. update main while on a feature branch):
   `git fetch origin main:main` fast-forwards it without switching, and fails safely if it can't.

## Report

How many commits came in, `git log --oneline <old>..<new>` (summarize if long), any files changed in both
directions, and whether the stash was restored.
