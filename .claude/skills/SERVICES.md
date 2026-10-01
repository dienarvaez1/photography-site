# The site's services

Shared by the `service-*` skills: what runs where, how to tell whether it's running, and the safety rules.

## Local (this computer)

| Service | Port | Start | What it is |
|---|---|---|---|
| **dev** | 4321 | `npx astro dev --background` | The site in development, plus the Admin page's local-only services: the photo service (`/__photos/*`) and the category service (`/__categories/*`). Reads the **production** R2 buckets (it uses your Cloudflare login). |
| **preview** | 8787 | `npm run preview` (builds, then `wrangler dev`) | The production build in the real Workers runtime (workerd). Its R2 is a **local** copy, empty until seeded (see below). |
| **results-api** | 8788 | `npm run results-api:dev` | The Admin page's read-only API Worker (`workers/results-api/`), over **local** R2 copies of the test and originals buckets. |

- `astro dev` has its own background mode (`astro dev status`, `astro dev logs`, `astro dev stop`, per `CLAUDE.md`). It
  also runs a workerd child of its own; that's normal.
- `wrangler dev` has no background mode. Start it with the Bash tool's `run_in_background`, and write its output to
  a log in the scratchpad (`… > <scratchpad>/<service>.log 2>&1`), so `tail` can show it later.
- Ready check: poll until the port answers, for up to 2 minutes for preview (it builds first) and 30 seconds otherwise:
  `for i in $(seq 1 120); do curl -s -o /dev/null localhost:<port>/ && break; sleep 1; done`.
- Wrangler also opens a devtools inspector port (9229 and up). Ignore it.

### Seeding the preview's R2

Pages that show photos (home, galleries, `/api/photos.json`) answer **500** in the preview until local R2 has the
photo manifest. Copy it from production. This reads production and writes only the local copy:

```
npx wrangler r2 object get photography-site-web/photos/index.json --remote --file <scratchpad>/index.json
npx wrangler r2 object put photography-site-web/photos/index.json --local --file <scratchpad>/index.json --content-type application/json
```

The photos themselves load from the public R2 host, so the manifest is all it needs.

### The local results API's token

The Worker refuses everything (`/health` says `"configured": false`) until it has an `ADMIN_TOKEN`. Locally, any
16+ character value works. Put it in `workers/results-api/.dev.vars` (git-ignored by `.dev.vars*`):
`ADMIN_TOKEN=<value>`. If the file doesn't exist, generate one straight into it
(`echo "ADMIN_TOKEN=$(openssl rand -hex 16)" >> workers/results-api/.dev.vars`) without printing it. Tell the user
**where** it is, not what it is: they open the file and paste the value into the Admin page at
`http://localhost:4321/admin/?api=http://localhost:8788`. Its local
buckets are empty unless results are published locally. Production data stays in production.

### The Admin page against the local API (`?api=`)

`?api=<address>` points the Admin page's tabs (Test Results, Lighthouse, Pics Viewer, GitHub Issues) at another
results API, but only on the **dev server**:
- The page must be on `localhost` (`resolveApiUrl` in `src/lib/results-view.ts`), and the API must allow the page's
  origin. Its `ALLOWED_ORIGINS` lists `http://localhost:4321`, so use `localhost`, not `127.0.0.1`.
- The page's Content-Security-Policy must allow the address. `src/middleware.ts` sends `public/_headers` everywhere,
  and only under `astro dev` it adds `http://localhost:*` and `http://127.0.0.1:*` to `connect-src` and `img-src`
  (`withLocalApi` in `src/lib/headers-file.ts`). The preview (8787) is a build, so its policy blocks `?api=`.

`curl` ignores the policy, so it can't prove the link works. Check it in a browser: no `connect-src` violation in the
console, and the tabs' requests going to `localhost:8788`. Category Maintenance never uses the API.

## Production (Cloudflare)

| Service | Worker | Address |
|---|---|---|
| **site** | `photography-site` | https://diego-narvaez-photography.org (also `photography-site.diego-narvaez.workers.dev`) |
| **results-api** | `photography-site-results` | https://photography-site-results.diego-narvaez.workers.dev |

- **Workers have no process.** There's nothing to start, stop or restart. Deploying replaces the version, and rolling
  back puts an older one back (`/service-deploy`).
- **Cloudflare's Git build deploys `main` on every push**, so a manual deploy of other code lasts only until the next
  push to `main`.
- The footer's build label says what's live: `curl -s https://diego-narvaez-photography.org/about/ | grep -oE 'Build [^<]*'`.
- Version history: `npx wrangler deployments list --name photography-site --json` (newest last), or
  `-c workers/results-api/wrangler.jsonc` for the API.
- The results API's health needs no token: `curl -s https://photography-site-results.diego-narvaez.workers.dev/health`.

## Is it running?

For each local port: `lsof -nP -iTCP:<port> -sTCP:LISTEN`, then `ps -o command= -p <pid>` to confirm it's this
project's process (its path contains this checkout). For dev, also `npx astro dev status`.

- A port held by **something else** (another checkout, another app): report it, don't stop it, and don't start on
  top of it. Offer another port (`--port`) instead.
- Orphaned `wrangler dev` processes (parent pid 1, often left by test runs) listen on random high ports. To find
  them: `ps -ax -o pid,ppid,lstart,command | grep 'wrangler.* dev' | grep -v grep`.

## Stopping a `wrangler dev` process

Stop the `wrangler … dev` process itself, and it shuts down its workerd and esbuild children. From the listening pid,
walk up the parents until the command contains `wrangler` and ` dev`:

```
P=$(lsof -nP -tiTCP:<port> -sTCP:LISTEN | head -1); W=$P
while [ -n "$W" ] && [ "$W" != 1 ]; do case "$(ps -o command= -p $W)" in *wrangler*" dev"*) break;; esac; W=$(ps -o ppid= -p $W | tr -d ' '); done
kill -TERM $W
```

Then wait up to 8 seconds for the port to free. If it's still held, `kill -TERM` the listening pid itself. Never use
`kill -9` without saying so first, and never `pkill`/`killall` by name: that would hit other checkouts and test runs.

## Safety rules

- **Production changes need a yes**, every time: deploy, rollback, and anything that sets or deletes a secret.
- The photo and category services **change the live site**: they write to production R2 or to source files. Show
  what will change and confirm before any `POST` (see `/service-photos` and `/service-categories`).
- The admin token is a secret. Never print it, never put it in a URL, and never write it outside a git-ignored
  file. Claude can't read the production token from Cloudflare, so the user saves it themselves, in their editor,
  as `ADMIN_TOKEN=<token>` in `workers/results-api/.dev.vars.production` (git-ignored by `.dev.vars*`). Don't ask
  them to paste it into the chat. Use it without echoing it:
  `-H "Authorization: Bearer $(sed -n 's/^ADMIN_TOKEN=//p' workers/results-api/.dev.vars.production)"`. The local
  token comes the same way from `workers/results-api/.dev.vars`.
