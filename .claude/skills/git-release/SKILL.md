---
name: git-release
description: Release this photography site to production as a new version — check CI is green on main, pick the next version, tag it before building so the footer shows the version, deploy with smoke checks, and publish GitHub release notes. Use whenever the user says release, ship, cut a release, "deploy v1.2.0", new version, or "tag and deploy" for this project.
argument-hint: "[vX.Y.Z|major|minor|patch]"
---

# Release this site

Arguments: `$ARGUMENTS` — the version, or which part to bump. If neither is given, suggest one.

## Why the order matters

The footer shows a build label from `scripts/lib/build-info.mjs`. A build made **exactly at a tagged commit with no
uncommitted tracked changes** shows the tag (`v1.2.0`). Any other build shows the short hash, or `<hash>-dirty`.
Untracked files don't make a build dirty.

Cloudflare's Git build deploys `main` on every push, before any tag exists, so that build shows a hash. A release
therefore tags `main`'s tip and then deploys again from the tagged checkout (`npm run deploy`), so production's
footer shows the version.

## Steps

1. **Start from main, in sync and clean.**
   `git switch main && git pull --ff-only`. `git status` must show no changes to tracked files. Stop if there are
   any, and say what they are.
2. **CI must be green on this exact commit.** Use /test-ci for `main`: both the `test` and `live-smoke` jobs, on
   `git rev-parse HEAD`. If a run is still going, wait for it. If anything failed, stop: no release, and the failure
   gets filed (see `.claude/skills/REPORTING.md`).
3. **Choose the version.** Latest tag: `git describe --tags --abbrev=0`. Changes since then:
   `git log --oneline <last>..HEAD`.
   - **patch** for fixes and tweaks
   - **minor** for new features (e.g. a new Admin tab)
   - **major** for breaking changes, such as removed pages or URLs that change
   Propose a version and confirm it with the user if they didn't give one. Nothing since the last tag means nothing
   to release, so say that and stop.
4. **Tag and push the tag:**
   `git tag -a vX.Y.Z -m "vX.Y.Z"`, then `git push origin vX.Y.Z`.
5. **Deploy from the tagged checkout:** `npm run deploy`. This takes several minutes, so run it in the background.
   - `predeploy` checks the build env (the Web3Forms keys must come from the real `.env`; don't override them),
     runs the offline Cucumber suite and `photos:verify`.
   - Then it builds, runs `wrangler deploy`, and smoke-checks the live site (`smoke --wait`).
   - If predeploy or a smoke check fails, the release isn't done. Report it and file it. Keep the tag: it marks
     the code that was attempted. Fix forward with a new patch version rather than moving the tag.
6. **Verify the footer:** `curl -s <site>/ | grep -o 'Build v[0-9.]*'` must print `Build vX.Y.Z`. The site address
   is `SITE.url` in `src/config/site.ts`.
7. **GitHub release.** Write notes for `<last>..vX.Y.Z` the way /git-history's "Release notes" section describes:
   New / Fixed / Changed / Internal, in plain sentences, with PR links. Then:
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <file>`.
8. **Optional, ask first:** run `/test-lighthouse --publish` against production to record the new version's scores.

## Report

- the version
- the tag's commit
- the CI run that cleared it
- the Worker version id from `wrangler deploy`
- the smoke-check result
- the footer label that was confirmed
- the GitHub release URL
- anything that failed, and the issues filed for it
