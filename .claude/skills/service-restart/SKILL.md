---
name: service-restart
description: Restart one of this photography site's local services — the Astro dev server (4321), the preview build (8787) or the results API (8788) — stopping it cleanly, starting it again in the background, and checking it answers; for production, explains that a Worker restarts by redeploying. Use when the user says restart, reload or "bounce" the dev server, preview or results API, or after changing config (astro.config.mjs, wrangler.jsonc, .env, .dev.vars) that needs a fresh start.
argument-hint: "[dev|preview|results-api|all] [--port N]"
---

# Restart a service

Arguments: `$ARGUMENTS` (default `dev`; `all` = every local service that's currently running). Read
`.claude/skills/SERVICES.md` first.

## When it's needed

- **dev:** most code changes hot-reload without a restart. Restart after changes to `astro.config.mjs`,
  `.env`, the integrations in `scripts/lib/*-server.mjs`, or the dependencies, or when the build label should
  update (it's read once at start).
- **preview:** it serves a build, so **any** code change needs a restart, which rebuilds. Its local R2 copy survives.
- **results-api:** wrangler reloads `src/` on its own. Restart after changes to `wrangler.jsonc` or `.dev.vars`.

## Steps

1. Note how it's running now: the port, the flags it was started with (`ps -o command= -p <pid>`), and any
   `--port` or `--remote`. Restart it the same way unless the user asked otherwise.
2. Stop it as `/service-stop` does, and wait for the port to free. If it wasn't running, say so and just start it.
3. Start it as `/service-start` does, including that skill's checks after starting (seeding, health, local services).
4. If it fails to come back, show the log tail, and say it's now **stopped**. Don't leave the user thinking it's up.

## Production

A Worker has no process to restart. A new deploy (`/service-deploy`) replaces the running version within seconds,
and that is the restart. If they want "the same code, freshly deployed", that's a redeploy of the current checkout,
and it needs their yes like any production deploy.

## Report

Each service restarted: old pid → new pid, address, uptime reset, and the check results. Mention it if the restart
picked up a new build label.
