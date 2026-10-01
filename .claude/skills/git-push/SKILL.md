---
name: git-push
description: Push the current branch to its remote safely — set the upstream on first push, never force-push the default branch, use --force-with-lease when a rewrite is intended, and optionally open a pull request. Use when the user says push, publish the branch, upload, send to GitHub, or force-push.
argument-hint: "[--force] [--pr]"
---

# Push

Arguments: `$ARGUMENTS`.

## Steps

1. Check: current branch, `git status` (uncommitted changes aren't pushed — mention them), and what will go:
   `git log --oneline @{u}..HEAD` (or against `origin/<default>` for a branch with no upstream yet).
2. Push:
   - First push → `git push -u origin <branch>`.
   - Otherwise → `git push`.
3. **Rejected (non-fast-forward)?** The remote has commits you don't. Don't force. Sync first (/git-sync), then push.
4. **Force push** — only when the user asked, or when you rewrote this branch's history yourself on their request
   (squash, rebase, amend):
   - Never to the default branch, or to a branch others share, without the user explicitly confirming that branch.
   - Always `--force-with-lease` (refuses if the remote moved since your last fetch), never bare `--force`.
5. **Tags** aren't pushed by `git push`. Push one with `git push origin <tag>` (see /git-tag).
6. `--pr`, or the user wants a PR for the branch → hand over to /git-pr.

If pushing would trigger a deploy (e.g. a push to the default branch that a CI/CD pipeline builds from), say so
before pushing.

## Report

What was pushed (`<n> commits → origin/<branch>`), the compare/PR link GitHub prints, and any CI that the push
started (`gh run list --branch <branch> --limit 1`).
