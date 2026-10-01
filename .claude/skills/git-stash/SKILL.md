---
name: git-stash
description: Set work aside and get it back with git stash — save (with a name, optionally including untracked files or just some paths), list with what each holds, show, apply/pop, turn into a branch, and drop. Use when the user says stash, "put this aside", "save my changes for later", "switch branches without committing", or wants something back from a stash.
argument-hint: "save|list|show|apply|pop|drop|branch [name or index]"
---

# Stash

Arguments: `$ARGUMENTS`.

| Intent | Command |
|---|---|
| Save, with a name | `git stash push -u -m "<what this is>"` (`-u` includes untracked files — usually wanted) |
| Save only some files | `git stash push -m "<name>" -- <paths>` |
| Keep staged changes in place | `--keep-index` |
| List | `git stash list`, plus `git stash show --stat stash@{n}` for each one worth describing |
| Look inside | `git stash show -p stash@{n}` (`--include-untracked` for the new files) |
| Restore and keep the stash | `git stash apply stash@{n}` |
| Restore and remove it | `git stash pop stash@{n}` |
| Restore onto a new branch | `git stash branch <name> stash@{n}` — best when applying would conflict |
| Delete one | `git stash drop stash@{n}` |

Always give a name — `stash@{3}` means nothing a week later. Refer to stashes by what they contain, not just the
index, because indexes shift as stashes are added and dropped.

**Conflicts on apply/pop**: the stash is *kept* when a pop conflicts. Resolve the files (see /git-merge), then drop
the stash yourself once the changes are safe.

**Dropping is hard to undo.** Show what's in the stash and confirm before `drop`; never `git stash clear` without
listing what will go and confirming. A just-dropped stash can be recovered from the hash git printed:
`git stash apply <hash>`.

## Report

What was stashed or restored, the current `git stash list`, and `git status --short`.
