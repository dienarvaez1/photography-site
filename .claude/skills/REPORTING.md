# Reporting test failures to GitHub Issues

Shared by the `test-*` skills. The project owner's standing rule: any failure in any test framework gets filed
on `dienarvaez1/photography-site`, so it shows up in the Admin page's GitHub Issues tab next to the test results.

## What counts

File real failures of the code or the suite as it ran: a failing scenario, a lint or type error, a page over its
Lighthouse budget, a red CI job, a publish to R2 that failed.

Don't file:
- a problem in a command you ran wrong and reran correctly in the same step (a typo, a wrong flag)
- an environment problem you fixed on the spot (Chromium not installed, `astro sync` not yet run). Mention it in
  the reply instead.

If you aren't sure whether it's the code or the environment, file it and say so in the issue.

## Before filing: check for duplicates

```
gh issue list --repo dienarvaez1/photography-site --state open --search "<framework> <scenario or rule>" --limit 20
```

If an open issue already covers the same failure (same scenario, rule, page or job), add a comment with this run's
details (`gh issue comment <n> --body-file …`) instead of opening a new one. One issue per distinct failure: 12
ESLint errors from the same rule in one file are one issue. Unrelated failures get separate issues.

## The issue

Title: `[<framework>] <what failed>`, for example `[Cucumber browser] Lightbox: tooltips stay on screen fails on phone`
or `[ESLint] no-unused-vars in src/lib/issues-viewer.ts`.

Body (write it to a file in the scratchpad and pass `--body-file`, so quoting can't break it):

````markdown
**Framework:** <framework and suite/profile>
**Failing:** <scenario / rule / page / job>, at `<file>:<line>`
**Branch / commit:** <branch> @ <short sha> (<clean, or "with uncommitted changes">)

### Error
```
<the relevant output: the failing step and its error. Trim it; don't paste whole logs>
```

### Reproduce
```
<the exact command>
```

<Published run id or CI run URL, if there is one.>
````

Add the existing `bug` label (`--label bug`). Don't create new labels.

## In the reply

List each issue opened or commented on, with its number and URL. If nothing failed, say nothing was filed.
