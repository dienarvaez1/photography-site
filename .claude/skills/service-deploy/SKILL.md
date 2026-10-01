---
name: service-deploy
description: Deploy this photography site's code to production on Cloudflare — the site Worker (guarded deploy with tests and live smoke checks) or the results API Worker — check what's live, and roll either one back to an earlier version. Use when the user says deploy, push to production, redeploy, "put this live", roll back, revert the deploy, or asks which version is deployed. For a versioned release with a tag and release notes, use /git-release instead.
argument-hint: "[site|results-api|both] [--unchecked] | status | rollback [site|results-api] [version-id]"
---

# Deploy

Arguments: `$ARGUMENTS` (default `site`). Read `.claude/skills/SERVICES.md` first.

**Every deploy and rollback changes production, so it needs the user's yes, every time.** Show what will go live
first.

## status

What's live, read-only:
- the footer label
- each Worker's newest deployments: `npx wrangler deployments list --name photography-site --json`, newest last,
  showing the time, author, version id and message (`-c workers/results-api/wrangler.jsonc` for the API)
- the API's `/health`

Compare the label with `origin/main`.

## Deploy the site

1. **What's going out:**
   - the branch and commit
   - `git status --short`: uncommitted tracked changes make the footer say `<hash>-dirty`
   - `git log --oneline <live hash>..HEAD`, where the live hash comes from the footer label (resolve a tag with
     `git rev-list -n1 <tag>`)
2. **Warn when it applies:**
   - Not on `main`: Cloudflare's Git build redeploys `main` on the next push, replacing this.
   - Uncommitted changes: no commit holds exactly this code.
   - Behind `origin/main`: this would put older code live.
   - A tagged version with release notes: that's /git-release, not this skill.
3. **Confirm**, naming the commit and the label production will show.
4. **Deploy:** `npm run deploy`, with Bash `run_in_background` and a 20-minute timeout. It runs:
   1. predeploy: the Web3Forms key check, which needs the real keys in `.env`; don't override them
   2. `npm test`
   3. `photos:verify`
   4. the build
   5. `wrangler deploy`
   6. `smoke --wait` against the live site

   Read the output for the **Worker version id**.
5. **Check:** the footer label now matches, and the smoke check passed.
6. A failure in predeploy means nothing was deployed: the old version is still live. A failed smoke check means it
   **is** deployed and broken. Offer a rollback right away. Either way, file it per `.claude/skills/REPORTING.md`.

`--unchecked` (`npm run deploy:unchecked`: build + deploy, no tests, keys or smoke check) is for emergencies such as
R2 being unreachable. Use it only when the user asks for it by name, say what it skips, and run
`npm run smoke -- --wait` yourself afterwards.

## Deploy the results API

1. Show what changed: `git log --oneline -- workers/results-api/` since its last deployment's time.
2. Confirm, then `npm run results-api:deploy`.
3. Check `curl -s https://photography-site-results.diego-narvaez.workers.dev/health` returns `{"ok":true,"configured":true}`.
   `configured: false` means the `ADMIN_TOKEN` secret is missing. The user sets it themselves with
   `! npx wrangler secret put ADMIN_TOKEN -c workers/results-api/wrangler.jsonc`.
4. If the API's address changed, `src/config/results.ts` and `public/_headers` must change too, and the site must be
   redeployed (a test fails if they disagree).

## Rollback

1. List the versions (`wrangler deployments list … --json`): time, version id, message, and which is live.
2. Pick the target: the one before the bad deploy, unless the user named one. Say what code it is, using its
   message or the footer label it had.
3. Confirm, then run, with the reason in the message:
   - site: `npx wrangler rollback <version-id> --name photography-site -m "<reason>" -y`
   - results-api: the same, with `-c workers/results-api/wrangler.jsonc`
4. Check it: for the site, `npm run smoke -- --wait` and the footer label; for the API, `/health`.
5. **A rollback lasts only until the next deploy**, and Cloudflare's Git build deploys `main` on every push. The fix
   has to land on `main` (`git revert`, /git-undo) before anyone pushes again.

## Report

What was deployed or rolled back (Worker, commit or label, version id), the smoke or health result, the footer label
now live, any warnings that applied (branch, dirty, Git build will overwrite), and anything filed as an issue.
