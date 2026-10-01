---
name: git-undo
description: Undo things in git safely — uncommit, unstage, discard file changes, revert a pushed commit, abort a merge or rebase, recover a deleted branch or lost commit from the reflog — always showing what would be lost and asking before anything destructive. Use when the user says undo, revert, go back, "I messed up", reset, discard changes, restore a file, recover, or "I lost my commit".
argument-hint: "<what to undo>"
---

# Undo

Arguments: `$ARGUMENTS`.

**First, protect.** Before any destructive step, show exactly what will be lost (the commits, the diff) and get a
yes. When in doubt, save a safety copy first: `git stash push -u -m "before undo"` or `git branch backup/<date>`.
Prefer the undo that keeps the most.

## Pick the undo

| Situation | Undo | Destroys? |
|---|---|---|
| Unstage a file | `git restore --staged <file>` | no |
| Throw away edits to a file | `git restore <file>` | **yes** — the edits |
| Throw away all uncommitted changes | `git restore .` + `git clean -fd` for untracked files (dry run first: `git clean -nd`) | **yes** |
| Undo the last commit, keep its changes staged | `git reset --soft HEAD~1` | no |
| …keep its changes unstaged | `git reset HEAD~1` | no |
| …and throw the changes away | `git reset --hard HEAD~1` | **yes** |
| Fix the last commit's message or contents | `git commit --amend` (only if not pushed) | no |
| Undo a commit that's already pushed | `git revert <sha>` — a new commit that undoes it; history stays intact | no |
| Undo a pushed merge commit | `git revert -m 1 <merge-sha>` | no |
| Restore one file from an earlier commit | `git restore --source=<sha> -- <file>` | overwrites that file's current edits |
| Get out of a merge/rebase/cherry-pick | `git merge --abort` / `git rebase --abort` / `git cherry-pick --abort` | no |

**Pushed commits:** don't `reset` and force-push shared branches — use `revert`. Resetting a personal branch and
force-pushing (`--force-with-lease`) is acceptable when the user confirms.

## Recover

- Lost commit, or a reset/rebase gone wrong: `git reflog` shows every position HEAD has been in. Find the entry
  from before the mistake, check it with `git show <sha>`, then `git branch rescue <sha>` (safe) or
  `git reset --hard <sha>` (if that's where the branch should be).
- Deleted branch: `git reflog` (or the hash git printed on delete) → `git branch <name> <sha>`.
- Dropped stash: the hash printed on drop → `git stash apply <hash>`; otherwise
  `git fsck --unreachable | grep commit` lists candidates.
- Never-committed changes that were discarded can't be recovered by git. Say so plainly (the editor's local history
  may still have them).

## Report

What was undone, the state now (`git status`, `git log --oneline -3`), and how to undo the undo (the reflog entry
or backup branch).
