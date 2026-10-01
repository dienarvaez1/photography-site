---
name: test-lighthouse
description: Run this project's Lighthouse suite, which measures performance, accessibility, best-practices and SEO against per-page budgets, and optionally publish the run to R2 for the Admin page's Lighthouse tab. Use whenever the user asks to run Lighthouse, check page speed or scores, measure the live site or a preview, or report or publish Lighthouse results.
argument-hint: "[--publish] [url]"
---

# Run the Lighthouse suite

Arguments: `$ARGUMENTS`. `--publish` (or the user saying "report", "record" or "publish to R2") stores the run in R2.
A URL measures that site instead of production.

The suite is the `@lighthouse` Cucumber profile. By default it measures the live production site. It runs every
page `LIGHTHOUSE_RUNS` times (3 by default) and judges the median run against that page's budget.

## Steps

1. Note the branch and commit, and which site is being measured. The scores are for the site at that URL, not
   for the local working tree, so say so if the two differ (e.g. uncommitted changes that aren't deployed yet).
2. Set `LIGHTHOUSE_URL=<url>` if a URL was given, e.g. `http://localhost:8787` from `npm run preview`. Don't point it
   at `astro dev`: dev-mode scores are meaningless.
3. Run it. It takes several minutes, so use a long timeout or run it in the background.
   - Without publishing: `npm run test:lighthouse`
   - With publishing: `npm run test:lighthouse:record`. This writes `test-results/lighthouse/` and publishes to R2
     (`photography-site-test`, `lighthouse-results/`). It needs wrangler to be logged in. A run over budget is still
     published. The exit code says whether every page was within budget.

## Report

- **Each page and device:** the four scores against their budgets, from the output or
  `test-results/lighthouse/index.html`.
- **Close to budget:** a score within a point or two of its budget is worth pointing out, even when it passes.
  Network noise can push it over on the next run.
- **Publish:** the run id if the run was published.

## Failures

A page over budget is a failure. Follow `.claude/skills/REPORTING.md` and use `[Lighthouse]` in the title. Include
the page, the device, the score against the budget, and the main opportunities Lighthouse lists for it. A single
borderline miss can be network noise: rerun that page once (`LIGHTHOUSE_RUNS=5`) before filing, and say in the
issue that you did.
