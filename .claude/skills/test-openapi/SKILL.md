---
name: test-openapi
description: Lint the results API's OpenAPI spec (docs/openapi.yaml) with Redocly and report the errors. Use whenever the user asks to lint or validate the OpenAPI spec or API docs, or after editing docs/openapi.yaml or the results API routes.
---

# Lint the OpenAPI spec

1. Run `npx --yes @redocly/cli@latest lint docs/openapi.yaml --format=stylish`.
2. If the results API's routes changed (`workers/results-api/src/`), also check that the spec still describes them:
   the paths, query parameters, status codes and auth. A spec that is valid but out of date is worth pointing out
   even though the linter passes.

## Report

Whether the spec is valid, and the number of errors and warnings. For each problem, the line, the rule and the
message.

A common trap: a YAML flow-map (`{ … }`) value containing a comma breaks parsing. The fix is to quote the string.

## Failures

Errors are failures. Follow `.claude/skills/REPORTING.md` and use `[OpenAPI lint] <rule>` as the title.
