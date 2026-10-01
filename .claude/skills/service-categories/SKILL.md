---
name: service-categories
description: Use the dev server's category service (localhost:4321/__categories) — the API behind the Admin page's Category Maintenance tab — to list categories in both languages, add one, rename, re-describe, hide or show one, change its slug (which moves its photos), or remove an empty one. Edits the site's source files (and, for a slug change, production R2), so each change is shown and confirmed first. Use when the user asks to add, rename, hide, show, edit or remove a gallery category, or call /__categories.
argument-hint: "status | add <slug> | edit <slug> [--new-slug s] [--label …] [--hidden true|false] | remove <slug>"
---

# The category service

Arguments: `$ARGUMENTS`. Read `.claude/skills/SERVICES.md` first. The contract is `docs/openapi.yaml`
(Category service).

It exists only in `astro dev`, on `http://localhost:4321`. If dev isn't running, offer `/service-start dev`. Same
rules as the photo service: localhost only, and a `POST` needs `-H 'Origin: http://localhost:4321'`.

**What a change touches:**
- `src/config/categories.json` and the category text in each `src/i18n/*.json`. These are source files: the live
  site changes only after a commit and a deploy (`/git-commit`, then `/service-deploy` or a merge to `main`).
- A **slug change** also moves every photo filed under it **in production R2** and republishes them. That part is
  live at once.

So show the change, including how many photos a slug change moves, and confirm before every `POST`.

## Calls

| Action | Request |
|---|---|
| List (hidden too, both languages) | `curl -s localhost:4321/__categories/status`, summarized: slug, labels, hidden |
| Add | `POST /__categories/add`, JSON `{"slug":"night-sky","label":"Night Sky","labelEs":"Cielo nocturno","description":"…","descriptionEs":"…","hidden":false}` |
| Edit (only the fields sent change) | `POST /__categories/edit`, JSON `{"slug":"nature","label":"Wildlife"}`; also `labelEs`, `description`, `descriptionEs`, `hidden`, `newSlug` |
| Remove (must have no photos) | `POST /__categories/remove`, JSON `{"slug":"…"}` |

Send JSON with `-H 'Content-Type: application/json' --data @<scratchpad>/body.json`.

The rules:
- A slug is lowercase words joined by hyphens, starting with a letter, at most 40 characters.
- Labels and descriptions are at most 200 characters.
- Every category needs both English and Spanish text. If the user gives only one, propose the other and confirm it.

Before a remove or a slug change, count its photos: `curl -s localhost:4321/__photos/status` or `/api/photos.json`.
A `409 in-use` on remove means photos still use it; offer to move them first (`/service-photos move`).

## After

- `git diff --stat` shows the source files changed. Summarize the diff, and suggest committing it on a branch and
  deploying (`/git-commit`, `/git-pr`).
- For a slug change, check `/api/photos.json`: no entries remain under the old slug.
- Errors: `400` (invalid field), `404 not-found`, `409 duplicate` or `in-use`, `403 not-local` (address or Origin).

## Report

The category before → after, the files changed, the photos moved (count), and what's still needed for it to be live
(commit, deploy).
