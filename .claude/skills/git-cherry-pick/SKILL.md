---
name: git-cherry-pick
description: Copy specific commits from one branch onto another with git cherry-pick — one commit, several, or a range — skipping ones already applied, recording where each came from, and resolving conflicts or aborting cleanly. Use when the user says cherry-pick, "take that commit onto this branch", "backport this fix", "copy this commit to main/release", or "I only want that one change from the other branch".
argument-hint: "<sha|range|branch> [--onto <branch>] [--no-commit] | continue | skip | abort"
---

# Cherry-pick

Arguments: `$ARGUMENTS`.

Cherry-picking makes a *new* commit with the same changes, on the current branch. The original stays where it was.

## Before

1. Be on the branch that should receive the commits (`git switch <target>`; for main, prefer a branch + PR,
   /git-pr). Working tree clean — commit or stash first (/git-stash). `git fetch` if the commits are on the remote.
2. Note `git rev-parse HEAD`: `git reset --hard <it>` undoes the whole cherry-pick.
3. Identify the commits and show them before picking: `git log --oneline <target>..<source>` lists what the source
   branch has that this one doesn't.
4. Skip ones already here (e.g. squash-merged or picked earlier): `git cherry -v HEAD <source>` marks commits whose
   changes are already present with `-`; only pick the `+` ones.

## Pick

| Intent | Command |
|---|---|
| One commit | `git cherry-pick -x <sha>` |
| Several | `git cherry-pick -x <sha1> <sha2> …` (oldest first) |
| A range, excluding A | `git cherry-pick -x A..B` |
| A range, including A | `git cherry-pick -x A^..B` |
| The changes only, to edit or combine before committing | `git cherry-pick --no-commit <sha>…` |
| A merge commit | `git cherry-pick -x -m 1 <merge-sha>` (`-m 1` = relative to the mainline parent) |

Use `-x` by default: it appends "(cherry picked from commit …)" to the message so the copy can be traced. Leave
it off only for commits from a private local branch, where that hash will never exist anywhere else.

## Conflicts

1. List them: `git diff --name-only --diff-filter=U`. Read what the picked commit intended
   (`git show <sha>`) and what this branch has in that spot — the commit may depend on earlier changes that aren't
   here. If so, say which commit it depends on and ask whether to pick that too.
2. Resolve, remove every marker (`grep -nE '^(<<<<<<<|=======|>>>>>>>)' <file>`), `git add <file>`.
3. `GIT_EDITOR=true git cherry-pick --continue`. Picking several repeats this per commit.
4. A commit that becomes empty (its changes are already here) → `git cherry-pick --skip`.
5. `git cherry-pick --abort` returns to before the cherry-pick began.

## After

Run the relevant tests for what was picked. If the source branch will also be merged later, mention that git may
show the same change twice; that's harmless after a squash merge.

## Report

Each commit picked (original sha → new sha), any skipped and why, conflicts and how they were resolved, the new
`git log --oneline -5`, and whether a push is needed (/git-push).
