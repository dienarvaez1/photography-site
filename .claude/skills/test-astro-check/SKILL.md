---
name: test-astro-check
description: Type-check this Astro project with `astro check` (TypeScript plus .astro component diagnostics) and report the errors. Use whenever the user asks to type-check, run astro check, or check for TypeScript or type errors.
---

# Run astro check

1. Run `npx astro check`. CI runs exactly this. It takes a minute or two.
   Don't run it at the same time as `npm run lint` or a build: they all regenerate `.astro/`, and the clash crashes
   astro check with a Vite `_createServer` stack trace. That's not a real failure: rerun it alone.

## Report

The final line's error, warning and hint counts. For each error, the `file:line:col` and the message.

## Failures

Errors are failures. Warnings and hints aren't filed. Follow `.claude/skills/REPORTING.md` and use
`[astro check] <short message> in <file>` as the title. Errors with the same cause go in one issue.
