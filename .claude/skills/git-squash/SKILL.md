---
name: git-squash
description: Tidy a branch's commits without an interactive editor — squash several commits into one, fold fixups into the commit they fix, reword messages, or reorder — and push the rewrite safely. Use when the user says squash, combine commits, clean up history, fixup, reword/edit a commit message, or "make this one commit before merging".
argument-hint: "[all|last N|<base>] [message]"
---

# Squash and tidy commits

Arguments: `$ARGUMENTS`.

Claude Code can't drive `git rebase -i` (it opens an editor), so use the non-interactive equivalents below.

## Before rewriting

1. Clean working tree (commit or stash first).
2. Show the commits that will be rewritten: `git log --oneline <base>..HEAD`.
3. Are they pushed? (`git branch -r --contains <oldest>`.) If they're on the default branch or a branch others use,
   stop and ask — rewriting shared history breaks everyone else's copy. On a personal feature branch it's fine, but
   it will need a `--force-with-lease` push.
4. Note the current tip so it can be undone: `git rev-parse HEAD` (also in the reflog).

## Recipes

**Whole branch → one commit**: `git reset --soft $(git merge-base HEAD origin/main)`, then commit with a message
that summarizes the whole branch (write it from all the squashed commits' messages; don't just keep the first).

**Last N commits → one**: `git reset --soft HEAD~N`, then commit as above.

**Fold fixes into an earlier commit**: `git commit --fixup=<sha>` for each fix, then
`GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <sha>~1`. `GIT_SEQUENCE_EDITOR=:` accepts the generated todo list
unchanged, so no editor opens.

**Reword the last commit**: `git commit --amend -F -` with the new message.
**Reword an older one**: `git commit --fixup=reword:<sha>` (git 2.32+) with the new message, then the autosquash
rebase above.

**Reorder or drop**: write the todo list yourself and pass it as the editor:
`GIT_SEQUENCE_EDITOR="cp /path/to/todo" git rebase -i <base>`.

## After

1. Check nothing was lost: `git diff <old-tip> HEAD` should be empty for a pure squash or reword.
2. If the branch was pushed: `git push --force-with-lease` (see /git-push).
3. Undo if needed: `git reset --hard <old-tip>` (only right after, with nothing new uncommitted).

## Report

Before and after (`git log --oneline`), the new message(s), and whether it still needs a force push.
