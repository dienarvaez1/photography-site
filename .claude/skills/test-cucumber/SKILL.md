---
name: test-cucumber
description: Run this project's Cucumber suites (offline, browser, or both) and optionally publish the results to R2 for the Admin page's Test Results tab. Use whenever the user asks to run the Cucumber tests, the feature tests, the offline or browser tests, `npm test` or `npm run test:browser`, or to record or publish test results to R2. Not for Lighthouse, which has its own skill (test-lighthouse).
argument-hint: "[offline|browser|all] [--publish]"
---

# Run the Cucumber suites

Arguments: `$ARGUMENTS`. The first word picks the suite: `offline`, `browser` or `all`. If none is given, use `all`.
`--publish` (or the user saying "report", "record" or "publish to R2") also stores the run in R2.

The suites, from `cucumber.js`:
- **offline**: `npm test`. Everything except `@browser` and `@lighthouse`. Builds the site, no network needed.
- **browser**: `npm run test:browser`. The `@browser` scenarios in real Chromium (Playwright).
- Lighthouse scenarios aren't part of either suite. They belong to test-lighthouse.

## Steps

1. Note the branch and commit (`git rev-parse --abbrev-ref HEAD`, `git describe --tags --always --dirty`) for the
   report.
2. Run the suites. These take minutes, so give Bash a long timeout (up to 600000 ms) or run it in the background.
   - Without publishing:
     - offline: `npm test`
     - browser: `npm run test:browser`
     - all: run both, offline first, and report each.
   - With publishing:
     ```
     npm run test:record -- --suite <offline|browser|all>
     ```
     This writes JSON and HTML reports to `test-results/`, then publishes the run to R2 (bucket
     `photography-site-test`, `results/`). It needs wrangler to be logged in. A run with failures is still
     published, which is what the Admin tab is for. The exit code says whether anything failed.
3. Use the real `.env`. Don't set the CI placeholder `PUBLIC_WEB3FORMS_KEY*` values locally: they override `.env`
   and make the contact-form scenarios fail for a reason unrelated to the code.
4. If the browser suite fails because Chromium is missing, run `npx playwright install chromium` and rerun. That's
   an environment fix, not a failure to file.

## Report

- **Each suite:** scenarios and steps passed/failed/skipped, from the summary lines at the end of Cucumber's output.
- **Publish:** the run id (e.g. `2026-09-30T19-55-39Z-be91e90-dirty-local`) if the run was published, or the
  publish error if it failed.
- **Each failure:** the feature and scenario name, the failing step, the error, and the `file:line`.

## Failures

Follow `.claude/skills/REPORTING.md`: check open issues for duplicates, then file one GitHub issue per distinct
failing scenario. Use `[Cucumber offline]` or `[Cucumber browser]` in the title. The reproduce command is the
single-scenario form:
`npx cucumber-js [--profile browser] features/<path>.feature:<line>`.
