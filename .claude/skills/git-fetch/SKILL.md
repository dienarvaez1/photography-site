---
name: git-fetch
description: Download what's new on the remote without touching your branches or files — fetch everything or one branch, prune branches deleted on GitHub, fetch tags or a pull request's branch — and report exactly what came in. Use when the user says fetch, "what's new on GitHub", "did anyone push", "check the remote", "get that PR's branch", or wants to look at remote changes before pulling.
argument-hint: "[all|<branch>|tags|pr <number>] [--prune]"
---

# Fetch

Arguments: `$ARGUMENTS`.

Fetching only updates remote-tracking refs (`origin/*`) and tags. It never changes local branches, the working tree,
or the index, so it's always safe to run. To bring the changes into a branch, that's /git-pull.

## Steps

1. Snapshot the remote refs first, so the report can say what moved:
   `git for-each-ref --format='%(refname:short) %(objectname:short)' refs/remotes refs/tags > <scratch>/before`.
2. Fetch:

| Intent | Command |
|---|---|
| Everything from origin, dropping branches deleted there | `git fetch --prune origin` (default) |
| Every remote | `git fetch --all --prune` |
| One branch | `git fetch origin <branch>` (updates `origin/<branch>`) |
| A branch that doesn't exist locally yet | `git fetch origin <branch>`, then `git switch <branch>` (/git-branch) |
| Tags, including ones deleted on the remote | `git fetch --tags --prune-tags origin` — check `git tag -l` first; `--prune-tags` deletes local tags the remote doesn't have |
| A pull request's branch | `gh pr checkout <n>`, or without switching: `git fetch origin pull/<n>/head:pr-<n>` |
| Fast-forward local main without switching to it | `git fetch origin main:main` (fails safely if main has local commits) |

3. Snapshot again and compare (`diff before after`). For each remote branch that moved:
   `git log --oneline <old>..<new>`. Note new branches, deleted (pruned) branches, and new tags.
4. Relate it to where the user is: `git rev-list --left-right --count HEAD...@{u}` (ahead, behind) for the current
   branch, and the same against `origin/main` if they're on a feature branch.

**Fetch fails?** Authentication errors → suggest `! gh auth login` or checking the remote URL (`git remote -v`).
A `would clobber existing tag` error means a tag was moved on the remote — show both commits; don't force-overwrite
without asking.

## Report

What came in, per branch (`origin/main: 3 new commits` plus their one-line logs, summarized if long), branches
created or pruned, new tags, and whether the current branch is now behind. Suggest /git-pull if it is.
