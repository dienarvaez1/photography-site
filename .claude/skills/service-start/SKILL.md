---
name: service-start
description: Start this photography site's local services — the Astro dev server (port 4321, with the Admin page's photo and category services), the production preview in the Workers runtime (8787), or the results API Worker (8788) — in the background, wait until each answers, and report its address. Use when the user says start, run, launch or "bring up" the dev server, the site, the preview or the results API locally.
argument-hint: "[dev|preview|results-api|all] [--port N] [--remote]"
---

# Start a local service

Arguments: `$ARGUMENTS` (default `dev`). `all` starts dev and results-api; preview only when it's named. Read
`.claude/skills/SERVICES.md` first.

Production Workers have no process to start (SERVICES.md). If the user means production, explain that and offer
`/service-deploy`.

## Steps

1. **Already running?** Check the port as SERVICES.md describes. If it's ours and it answers, say so and stop; don't
   start a second copy. Held by something else → report who, and offer `--port <other>`.
2. **Start it in the background:**

| Service | Command |
|---|---|
| dev | `npx astro dev --background` (`--port N` if asked). Returns at once; `npx astro dev status` confirms. |
| preview | `npm run preview > <scratchpad>/preview.log 2>&1`, with Bash `run_in_background` (builds first, takes a minute or two). Another port: `npm run build` then `npx wrangler dev --port N`. |
| results-api | Make sure `workers/results-api/.dev.vars` has an `ADMIN_TOKEN` (SERVICES.md; create one if missing). Then `npm run results-api:dev > <scratchpad>/results-api.log 2>&1` with `run_in_background`. |

3. **Wait until it answers** (SERVICES.md's ready check). If it doesn't within the time limit, show the last 30
   lines of its log (`npx astro dev logs` for dev) and stop.
4. **After it starts:**
   - **preview:** check `localhost:8787/api/photos.json`. If it returns 500, local R2 isn't seeded. Seed it from
     production (SERVICES.md; this reads production only), then check `/`, `/work/all/` and `/es/` answer 200.
   - **results-api:** `curl -s localhost:8788/health` must say `"configured": true`.
   - **dev:** check `/`, then `/__photos/status`, `/__categories/status` and `/__results/status` (the local services).

`--remote` (preview or results-api) runs the Worker on Cloudflare's network against the **production** buckets
instead of local copies. Use it only when asked, and say so: the results API only reads, but a remote preview is a
real deployment-like session.

## Report

Each service started (or already running): its address (`http://localhost:<port>`), pid, log location, and what
the checks returned. Include useful next links: `http://localhost:4321/admin/`, and when both dev and the local
API are running, `http://localhost:4321/admin/?api=http://localhost:8788`. That link works only on the dev server, not
the preview (SERVICES.md, "The Admin page against the local API"). If you generated a local token, say it's in
`workers/results-api/.dev.vars` (git-ignored) for them to copy into the Admin page. Don't print it. Stop with
`/service-stop`.
