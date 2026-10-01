---
name: service-results-api
description: Query the results API Worker behind the Admin page — locally on port 8788 or in production — for its health, the recorded test runs and Lighthouse runs, a run's failures and signed report links, the original photos' metadata (Pics Viewer), and the site's GitHub issues, using the admin token without exposing it; and tail its logs. Use when the user asks about the results API, port 8788, the Admin page's data, "what does /latest say", recorded runs from the API, original photo metadata, or the API's logs.
argument-hint: "[local|prod] [health|runs|latest|run <id>|lighthouse [run <id>]|pics [id]|issues|logs]"
---

# The results API

Arguments: `$ARGUMENTS` (target defaults to `local` if port 8788 is ours and answering, otherwise `prod`). Read
`.claude/skills/SERVICES.md` first. The full contract is `docs/openapi.yaml`.

| Target | Base URL | Token file |
|---|---|---|
| local | `http://localhost:8788` | `workers/results-api/.dev.vars` |
| prod | `https://photography-site-results.diego-narvaez.workers.dev` | `workers/results-api/.dev.vars.production` (the user saves it; see SERVICES.md) |

The API is **read-only**: nothing here changes data. The local Worker reads **local** R2 copies, which are empty
unless something was published to them; the real runs and originals are in prod.

## Calling it

`/health` needs no token. Everything else:

```
T=workers/results-api/.dev.vars.production   # or .dev.vars for local
curl -s -H "Authorization: Bearer $(sed -n 's/^ADMIN_TOKEN=//p' $T)" <base><path>
```

Never echo the token or put it in a URL. If the token file is missing, ask the user to create it (SERVICES.md). A
`401` means the token is wrong. A `503`, or `/health` saying `configured: false`, means the Worker has no secret.

| Ask | Path |
|---|---|
| Up, and token set? | `GET /health` |
| Every test run, newest first | `GET /index` |
| Newest run's summary | `GET /latest` |
| One run, with signed links | `GET /runs/<runId>` |
| A run's file | the signed `url` from `/runs/<runId>`, as given (it expires in 15 minutes) |
| Lighthouse runs | `GET /lighthouse/index`, `/lighthouse/latest`, `/lighthouse/runs/<runId>` |
| Originals in the private bucket | `GET /pics`, and `GET /pics/<photoId>` for size, camera, date taken and copyright |
| The site's GitHub issues | `GET /github/issues` |

Summarize the JSON with node rather than dumping it, for example a run's result, counts per suite, each failure's
scenario and reason, or pics per category. To save a report, download its signed link to the scratchpad and say
where it is.

The runs also come from the CLIs, which read R2 directly without a token: `npm run results -- list|show|trend` and
`npm run lighthouse-results -- list|show`. Use them when the API isn't reachable.

## Logs

- local: `tail -n 50 <scratchpad>/results-api.log`
- prod: `npx wrangler tail photography-site-results --format pretty`, with `run_in_background`, filtered with
  `--status error` when needed. Stop it when done.

## Report

The answer to what was asked, from the JSON, plus which target and which run or photo id it came from. For
failures, quote the scenario and reason. Test failures found this way are already recorded; file new ones only per
`.claude/skills/REPORTING.md`, after checking for duplicates.
