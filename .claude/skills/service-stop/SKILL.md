---
name: service-stop
description: Stop this photography site's local services — the Astro dev server (4321), the preview (8787), the results API (8788), or orphaned wrangler dev processes left by test runs — cleanly, only this checkout's processes, and confirm the ports are free. Also explains what "stopping" means for the production Workers. Use when the user says stop, kill, shut down or "free the port" for the dev server, preview, results API or wrangler.
argument-hint: "[dev|preview|results-api|orphans|all|prod]"
---

# Stop a service

Arguments: `$ARGUMENTS` (default: whichever local services are running; ask if more than one is and none is named).
Read `.claude/skills/SERVICES.md` first.

## Local

1. Find the process as SERVICES.md describes, and confirm its command path is this checkout. Not ours → report it
   and leave it.
2. Stop it:

| Service | Command |
|---|---|
| dev | `npx astro dev stop`. If it wasn't started in background mode (status says so), stop its listening pid with `kill -TERM`. |
| preview, results-api | SERVICES.md's "Stopping a `wrangler dev` process": find the `wrangler … dev` ancestor and `kill -TERM` it. |
| orphans | List them first (pid, start time, checkout path, ports). Stop them only after the user confirms, even ones from this checkout. Ones from **another checkout** need that named explicitly in the confirmation. |

3. Wait up to 8 seconds for the port to free (`lsof -nP -tiTCP:<port> -sTCP:LISTEN` empty). Still held → `kill -TERM`
   the listening pid, and check again. Only offer `kill -9` (say so first) if that fails too.
4. Check no children were left: `ps -ax -o pid,ppid,command | grep '<this checkout>.*\(wrangler\|workerd\)'`. The dev
   server's own workerd child goes when dev stops.

Never `pkill`/`killall` by name, and never stop processes on other ports "while you're at it".

## Production (`prod`)

The Workers have no process, so they can't be stopped and started. Explain the real options, and do none of them
without an explicit yes naming the option:

- **results-api:** delete its secret: `npx wrangler secret delete ADMIN_TOKEN -c workers/results-api/wrangler.jsonc`.
  The API then refuses everything, and the Admin page's tabs stop loading. To undo it, the user sets it again with
  `! npx wrangler secret put ADMIN_TOKEN -c workers/results-api/wrangler.jsonc`, typing the value themselves.
- **site:** there's no safe off switch. Taking it offline means removing its custom domain and workers.dev route in
  the Cloudflare dashboard, or deleting the Worker (`wrangler delete`, which can't be undone and loses its settings).
  Recommend against both. To undo a bad release, use `/service-deploy rollback` instead.

## Report

What was stopped (service, pid), that its port is now free, anything left running and why (not ours, not
confirmed), and how to start it again (`/service-start <service>`).
