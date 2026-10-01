---
name: service-photos
description: Use the dev server's photo service (localhost:4321/__photos) — the API behind the Admin page's New Photo form and bulk photo actions — to see per-category counts, read a photo's EXIF before uploading, add a photo, move photos to another category, set or clear the home page's hero backgrounds, or permanently remove photos. These change the LIVE site through production R2, so every change is shown and confirmed first. Use when the user asks to add, upload, remove, delete, recategorize or move photos, set hero background photos, or call /__photos.
argument-hint: "status | analyze <file> | add <file> --category <slug> --title <t> | move <ids> --to <slug> | hero <ids> on|off | remove <ids>"
---

# The photo service

Arguments: `$ARGUMENTS`. Read `.claude/skills/SERVICES.md` first. The contract is `docs/openapi.yaml`
(Photo service).

It exists only in `astro dev`, on `http://localhost:4321`. If dev isn't running, offer `/service-start dev`. It
answers only requests addressed to localhost, and a `POST` must send `Origin: http://localhost:4321` (the page's own
origin, which is what the browser would send). Requests are handled one at a time.

**It writes to production.** Adding, moving, hero changes and removals are on the live site as soon as the call
answers, with no commit and no deploy. So for every `POST` except `analyze`: show exactly what will change, with
titles and categories and not just ids, and get a yes. **`remove` deletes the originals permanently**, so name every
photo and say so plainly.

The same work is available as a CLI, `npm run photos -- help` (add, replace, remove, verify, sync…). Use it when the
user prefers it or the dev server isn't running.

## Finding photos

- Entries (id, category, title, featured, hero): `curl -s localhost:4321/api/photos.json`, summarized with node.
- Counts and the next `order` per category: `curl -s localhost:4321/__photos/status`.
- An original's key, needed for `remove`: `photos/<id>/original.jpg`. Check it with the results API's `/pics/<id>`
  (/service-results-api).
- Category slugs: `src/config/categories.json`, or `/service-categories status`.

## Calls

All of these use `-H 'Origin: http://localhost:4321'`.

| Action | Request |
|---|---|
| Status | `curl -s localhost:4321/__photos/status` |
| Read a photo's EXIF (no upload) | `curl -s -F photo=@<file.jpg> localhost:4321/__photos/analyze` |
| Add | `curl -s -F photo=@<file.jpg> -F title='…' -F category=<slug> [-F titleEs='…'] [-F order=N] [-F featured=true] [-F camera='…'] localhost:4321/__photos/add` |
| Move to another category | `POST /__photos/recategorize`, JSON `{"photos":[{"id":"…","category":"<current>"}],"toCategory":"<slug>"}` |
| Hero background on/off | `POST /__photos/hero-background`, JSON `{"photos":[{"id":"…","category":"…"}],"value":true}` |
| Remove permanently | `POST /__photos/remove`, JSON `{"photos":[{"id":"…","key":"photos/<id>/original.jpg"}]}` |

JSON calls: `-H 'Content-Type: application/json' --data @<scratchpad>/body.json` (write the body to a file, so quoting
can't break). Limits are 100 photos per call and JPEGs up to 100 MB.

**Add**: run `analyze` first and show what it read (id, size, camera line, date taken), so the user can correct the
title, camera or category before anything is uploaded. A `409 duplicate` means the photo is already in that
category.

## After

- Re-read `/api/photos.json` and confirm the change: present, moved, or gone.
- Errors come as `{ "error": "<code>", "message": "…" }`. A `403 not-local` means the address or the `Origin` header
  is wrong. A `500` means the service failed; per the contract, nothing half-done was published.
- `remove` reports per photo. A photo with an `error` wasn't fully deleted, and running it again is safe.

## Report

Each photo affected (title, id, category from → to), what the service answered per photo, and the check against
`/api/photos.json`. Pages may take a moment to show the change (caching).
