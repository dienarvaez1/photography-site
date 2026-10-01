---
name: git-commit
description: Turn the current changes into well-formed git commits — review the diff, split unrelated changes into separate commits, write messages that match the repo's style, and never commit straight onto the default branch. Use whenever the user says commit, "save this", "check this in", or asks for a commit message.
argument-hint: "[message or hint]"
---

# Commit

Arguments: `$ARGUMENTS` — a message to use, or a hint about what the commit is.

## Steps

1. **Look first.** `git status`, `git diff`, `git diff --cached`, and `git log --oneline -15` to learn the repo's
   message style (imperative? prefixes like `feat:`? capitalized? length?). Match it.
2. **Branch check.** On the default branch (`main`/`master`, or what `git symbolic-ref refs/remotes/origin/HEAD`
   says)? Create a branch first (`git switch -c <short-kebab-name>` named after the change) unless the user has said
   committing to it directly is fine for this repo.
3. **What goes in.** If something is already staged, commit what's staged — the user chose it. If nothing is,
   stage the changes that belong to this piece of work (follow /git-stage's safety check: no secrets, build output,
   large files, personal config). Leave unrelated changes — files the user didn't touch in this task, pre-existing
   untracked files — out, and mention them.
4. **Split if it's two things.** Unrelated changes (a bug fix and a refactor, two features) go in separate commits,
   each one buildable. Say how you split them.
5. **Message.**
   - Subject: what the commit does, under ~72 characters, in the repo's style.
   - Body (when it isn't obvious): *why*, and anything a reviewer needs — not a file-by-file list.
   - Add any attribution trailer the session's instructions ask for.
   - Pass it through a quoted heredoc to `git commit -F -` so quotes and newlines survive.
6. **Hooks.** If a pre-commit hook fails, fix the cause and make a *new* commit attempt; don't use `--no-verify`
   unless the user asks. If a hook modified files, stage them and commit again.
7. **Amend** only when asked, and only if the commit isn't pushed; otherwise make a new commit.

## Report

The commit hash(es) and subject(s), the branch, what was left uncommitted, and that nothing was pushed (offer
/git-push).
