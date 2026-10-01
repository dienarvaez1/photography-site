---
name: test-eslint
description: Run ESLint over this project (`npm run lint`) and report the errors and warnings. Use whenever the user asks to lint, run ESLint, check code style, or check for lint errors.
argument-hint: "[path…]"
---

# Run ESLint

Arguments: `$ARGUMENTS`. Paths to lint just those, otherwise lint everything.

1. Run `npm run lint`, or `npm run lint -- <paths>` for particular paths. Its `prelint` hook runs `astro sync`
   first: the type-aware rules need the `astro:content` types it writes to `.astro/`. If you call `npx eslint`
   directly instead, run `npx astro sync` first, or you get spurious "unsafe any" errors.
2. Don't pass `--fix` unless the user asks for it. This skill reports, it doesn't change code.

## Report

The number of errors and warnings. For each problem, the `file:line`, the rule and the message, grouped by rule if
there are many.

## Failures

ESLint errors are failures. Warnings are worth listing but aren't filed. Follow `.claude/skills/REPORTING.md` and
use `[ESLint] <rule> in <file>` as the title: one issue per rule per file.
