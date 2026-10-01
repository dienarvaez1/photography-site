---
name: git-tag
description: Manage git tags for versions — suggest the next semantic version from the commits since the last tag, create annotated tags, list them, push them, and delete or move one safely. Use when the user says tag, version tag, "what's the latest version", next version, bump the version, list/delete/push tags.
argument-hint: "[new [vX.Y.Z|major|minor|patch]|list|push|delete <tag>]"
---

# Tags

Arguments: `$ARGUMENTS`.

## List

`git tag -l --sort=-v:refname -n1 | head -20` (newest first, with messages). Which tag HEAD is on or past:
`git describe --tags`. Local tags missing on the remote: compare with `git ls-remote --tags origin`.

## Create

1. Follow the repo's existing scheme (`v1.2.3` versus `1.2.3`).
2. Next version — if not given, suggest it from `git log --oneline <last-tag>..HEAD`:
   - **major**: breaking changes (removed features, incompatible APIs, `!` or `BREAKING CHANGE` in messages)
   - **minor**: new features
   - **patch**: only fixes, tweaks, docs, tests
   Show the commits and the reasoning; let the user override.
3. Tag the right commit: normally the default branch's tip after it's synced and CI is green. Check for uncommitted
   changes — a tag marks the commit, not the working tree.
4. Annotated, not lightweight: `git tag -a v1.2.3 -m "v1.2.3"` (a short summary in the message is better still).
5. Push it: `git push origin v1.2.3` (`git push` alone doesn't send tags). Avoid `git push --tags`, which pushes
   every local tag, including stray ones.

If the project has its own release process (a release skill, a RELEASING doc, a build that stamps the version),
the tag is one step of that — use it instead.

## Delete or move

A pushed tag may already be used by others (CI, deploys, someone's checkout). Confirm first.
- Delete: `git tag -d <tag>` and `git push origin --delete <tag>`.
- Move to another commit: delete as above, re-create it on the right commit, push again. Prefer a new version
  number over moving a tag that's been released.

## Report

The tag, the commit it points at (`git rev-list -n1 <tag>`), whether it's pushed, and the commits it includes
since the previous tag.
