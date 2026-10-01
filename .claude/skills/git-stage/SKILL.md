---
name: git-stage
description: Stage, unstage, remove or stop tracking files in git — by path, pattern, or "everything except…" — with a check for files that shouldn't be committed (secrets, .env, large binaries, build output). Use when the user says git add, stage, unstage, git rm, remove from git, untrack, stop tracking, or add something to .gitignore.
argument-hint: "add|unstage|rm|untrack <paths…>"
---

# Stage and unstage

Arguments: `$ARGUMENTS`.

| Intent | Command |
|---|---|
| Stage files | `git add -- <paths>` |
| Stage everything | `git add -A` — but run the safety check first |
| Stage part of a file | Claude can't use `git add -p` (interactive). Build a patch of just the wanted hunks and `git apply --cached <patch>`, or ask the user to run `! git add -p <file>` |
| Unstage (keep the edits) | `git restore --staged -- <paths>` |
| Delete a file and stage the deletion | `git rm -- <paths>` |
| Stop tracking but keep the file on disk | `git rm --cached -- <paths>` (`-r` for a folder), then add it to `.gitignore` |
| Ignore a file | Append to `.gitignore`. If it's already tracked, it also needs `git rm --cached` — ignoring alone does nothing |

## Safety check before staging

Look at what's about to be staged (`git status --porcelain`, plus `git diff --cached --stat` afterwards) and stop to
ask if any of it looks like:
- **Secrets** — `.env*` (not `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `.dev.vars`, tokens in the
  diff (`grep -iE 'api[_-]?key|secret|token|password'` over the staged diff)
- **Large files** — over ~5 MB (`git diff --cached --numstat` shows `-` for binaries; check sizes with `ls -l`)
- **Generated output** — `node_modules/`, `dist/`, `.astro/`, `.wrangler/`, `test-results/`, coverage, `.DS_Store`
- **Personal config** — editor folders, `settings.local.json`

These usually belong in `.gitignore`; offer to add them there.

`git rm` (without `--cached`) deletes the file from disk too. If it has uncommitted edits, git refuses; don't add
`-f` without asking.

## Report

`git status --short` afterwards, staged versus not, and anything you held back and why.
