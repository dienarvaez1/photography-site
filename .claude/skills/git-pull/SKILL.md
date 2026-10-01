---
name: git-pull
description: Pull remote changes into a branch safely — fast-forward when possible, rebase or merge when the branch has diverged, set aside and restore uncommitted work, pull a different branch (like main) into the current one, or update main without switching — and report what came in. Use when the user says pull, git pull, "get the latest", "pull main into my branch", "update from origin", or a push was rejected because the remote has new commits.
argument-hint: "[--ff-only|--rebase|--merge] [<remote> <branch>]"
---

# Pull

Arguments: `$ARGUMENTS`.

A pull is a fetch (/git-fetch) plus integrating the result into the current branch. Do it as those two steps, so
you can see what's coming before it lands. Note `git rev-parse HEAD` first: `git reset --hard <it>` undoes the pull.

## Steps

1. `git fetch --prune origin`. Find the upstream: `git rev-parse --abbrev-ref @{u}`. No upstream → say so and offer
   `git branch -u origin/<branch>` if that branch exists on the remote; don't guess.
2. Count: `git rev-list --left-right --count HEAD...@{u}` (ahead, behind). Nothing behind → up to date, stop.
3. Show what's coming: `git log --oneline HEAD..@{u}` and `git diff --stat HEAD...@{u}`.
4. Uncommitted changes that touch the incoming files → `git stash push -u -m "git-pull: before pull <date>"` and
   `git stash pop` at the end. If the pop conflicts, stop, keep the stash, and explain (/git-stash). Changes to
   other files can stay where they are.
5. Integrate:

| Situation | Command |
|---|---|
| Only behind | `git merge --ff-only @{u}` |
| Diverged, my local commits aren't pushed | `git rebase @{u}` (linear history) |
| Diverged, my commits are already pushed or shared | `git merge @{u}` (don't rewrite shared history) |
| User asked for a specific mode | `--rebase` → `git rebase @{u}`; `--merge` → `git merge @{u}`; `--ff-only` → stop if it can't fast-forward |
| On the default branch and diverged | Don't merge. Local commits on main usually belong on a branch — suggest /git-branch's "committed to main by mistake" |

**Pull another branch into this one** (e.g. main into a feature branch): `git fetch origin main`, then
`git merge origin/main` (or `git rebase origin/main` if this branch isn't pushed yet). After a rebase of a pushed
branch, the next push needs `--force-with-lease` (/git-push).

**Update main without switching:** `git fetch origin main:main` fast-forwards it in place, and refuses if main has
local commits.

**Conflicts:** stop, list them (`git diff --name-only --diff-filter=U`) and follow /git-merge's conflict steps.
`git merge --abort` or `git rebase --abort` returns to before the pull.

Avoid a bare `git pull` — its behavior depends on `pull.rebase` config and can create surprise merge commits.

## Report

How many commits came in and their one-line log (summarized if long), how they were integrated (fast-forward,
rebase or merge), any conflicts and how they were resolved, whether the stash was restored, and whether a push
is now needed.
