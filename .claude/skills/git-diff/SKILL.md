---
name: git-diff
description: Explain what changed in git in plain language — uncommitted work, staged changes, a commit, or the difference between two branches, tags or commits — summarizing by intent and pointing out risky changes, not just dumping the diff. Use when the user asks what changed, to see/explain/review a diff, compare branches or releases, or "what's different between X and Y".
argument-hint: "[staged|<commit>|<a>..<b>|<a>...<b>] [-- path]"
---

# Diff, explained

Arguments: `$ARGUMENTS`.

## Pick the comparison

| Asked for | Command |
|---|---|
| Uncommitted, not staged | `git diff` |
| Staged (what would be committed) | `git diff --cached` |
| Everything uncommitted | `git diff HEAD` |
| One commit | `git show <sha>` |
| A branch versus main (what the branch adds) | `git diff main...<branch>` — three dots: since they split, ignoring main's newer commits |
| Two releases | `git diff v1.1.0..v1.1.1` |
| One file across commits | `git diff <a> <b> -- <path>` |

Unsure which the user means → use the most likely and say which you used.

## Read before explaining

Start with `--stat` for the shape, then read the real hunks. Large diffs: go file by file and skip generated files
(lockfiles, snapshots, build output) — mention them in one line ("lockfile: 3 packages bumped"). For renames, use
`-M`. To see just the names: `--name-status`.

## Report

1. **One-line summary** of the overall change.
2. **By intent**, not by file — "adds X", "fixes Y", "renames Z" — each with the files involved
   (`file:line` for specifics).
3. **Worth a look** — anything risky: deleted tests, changed config or security settings (CSP, auth, permissions),
   secrets, migrations, large deletions, dependency changes, debug leftovers (`console.log`, `TODO`), commented-out code.
4. Size: files, insertions, deletions.

Only show raw hunks if the user asks or a specific hunk matters.
