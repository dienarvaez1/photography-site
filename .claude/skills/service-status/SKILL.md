---
name: service-status
description: Show what's running for this photography site, locally and in production — the dev server (4321), the preview build (8787) and the results API (8788) on this computer, plus the live site's build and the production results API's health — and suggest the next step. Read-only. Use when the user asks "is the dev server running", "what's running", which ports are in use, what version is live, or service status.
argument-hint: "[local|prod|all]"
---

# Service status

Arguments: `$ARGUMENTS` (default `all`). Read `.claude/skills/SERVICES.md` first for the services, ports and checks.

Read-only: this skill never starts, stops or changes anything.

## Local

For each of 4321 (dev), 8787 (preview) and 8788 (results-api), run in parallel:
- `lsof -nP -iTCP:<port> -sTCP:LISTEN`, then `ps -o pid,lstart,command -p <pid>` to see who owns it and since when.
  Only call it "ours" if the command's path is this checkout.
- Whether it answers: `curl -s -o /dev/null -w '%{http_code}' localhost:<port>/` (and `/health` for 8788, which also
  says whether a token is configured).
- For dev: `npx astro dev status` (pid, uptime, background or not).
- For preview: whether local R2 is seeded. `curl -s -o /dev/null -w '%{http_code}' localhost:8787/api/photos.json`
  returning 500 means it isn't.

Also list orphaned `wrangler dev` processes (parent pid 1, see SERVICES.md), with their checkout path and start time.

## Production

- Live site: the footer's build label (SERVICES.md), plus `curl -s -o /dev/null -w '%{http_code}'` for `/`.
- Compare the label with `git rev-parse --short origin/main` (after `git fetch --quiet`): the same hash, or a tag on
  it, means production runs `main`.
- Newest deployment of each Worker: `npx wrangler deployments list --name photography-site --json` (newest last),
  showing when, who, the version id and its message. Use `-c workers/results-api/wrangler.jsonc` for the API.
- Results API: `curl -s https://photography-site-results.diego-narvaez.workers.dev/health`.
- Latest CI and live smoke check on `main`: `gh run list --branch main --limit 3`.

## Report

A short table per side:

| Service | State | Port/address | Details |
|---|---|---|---|

Details covers the pid and uptime, whether it answers, whether a token is set or R2 is seeded, and the build label.
Then flag anything odd: a port held by another program, orphaned wrangler processes, production not on `main`'s
tip, an unhealthy API. End with one suggested next step (`/service-start`, `/service-stop`, `/service-deploy`).
