---
name: git-branch
description: Create, switch, rename, list and delete git branches, move commits that landed on the wrong branch, and clean up branches that are already merged — locally and on the remote. Use when the user mentions branches — new branch, switch to, checkout, rename, delete, prune, "which branches are stale", or "I committed to main by mistake".
argument-hint: "new|switch|rename|delete|list|clean|move [name]"
---

# Branches

Arguments: `$ARGUMENTS`.

| Intent | Command |
|---|---|
| New branch from here | `git switch -c <name>` (uncommitted changes come along) |
| New branch from up-to-date main | `git fetch origin && git switch -c <name> origin/main` |
| Switch | `git switch <name>`; a remote-only branch → `git switch <name>` tracks `origin/<name>` automatically |
| Switch to a tag or commit | `git switch --detach <tag>` — say they're now detached and how to get back |
| Rename current | `git branch -m <new>`; if it was pushed: `git push origin -u <new>` and `git push origin --delete <old>` (confirm) |
| List | `git branch -vv` (local, with upstream and ahead/behind); `git branch -r` for remote |
| Delete merged | `git branch -d <name>` |
| Delete unmerged | `git branch -D` only after showing the commits that would be lost (`git log --oneline main..<name>`) and confirming |
| Delete on the remote | `git push origin --delete <name>` (confirm) |

**Switching with uncommitted changes** that would conflict: git refuses. Offer to commit, stash (/git-stash), or
carry them over — don't discard.

**Committed to main by mistake** (not pushed): `git switch -c <new-branch>` keeps the commits on the new branch, then
`git branch -f main origin/main` puts main back. Show the commits first. If they *were* pushed, don't rewrite main —
explain the options.

**Clean up** — find candidates and show them before deleting anything:
- merged into the default branch: `git branch --merged origin/main` (excluding main and the current branch)
- squash-merged (git can't tell they're merged): branches whose upstream is gone — `git fetch --prune`, then
  `git branch -vv | grep ': gone]'` — or whose PR is merged (`gh pr list --state merged --head <branch>`)
- stale: no commits in N weeks
  (`git for-each-ref --sort=committerdate refs/heads --format='%(committerdate:short) %(refname:short)'`)

Delete them as one confirmed batch.

## Report

The branch you're on now, what was created/renamed/deleted, and anything kept back and why.
