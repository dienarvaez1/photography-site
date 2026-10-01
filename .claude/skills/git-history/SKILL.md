---
name: git-history
description: Answer questions about a repo's git history — what happened recently, who changed a line and why (blame), when something was introduced or removed (pickaxe search), what changed between releases (release notes), and which commit broke something (bisect). Use when the user asks for the log/history, "when did this change", "who wrote this", "why is this here", "what's in this release", changelog/release notes, or "what broke this".
argument-hint: "[file|range|search term]"
---

# History

Arguments: `$ARGUMENTS`.

| Question | Command |
|---|---|
| Recent work | `git log --oneline --graph --decorate -20` (add `--all` for every branch) |
| A file's story | `git log --follow --oneline -- <file>` (follows renames), then `git show <sha> -- <file>` |
| Who/why for these lines | `git blame -w -L <start>,<end> <file>`, then `git show <sha>` for the commit's reason. `-w` ignores whitespace; `-C` follows moved code |
| When was this text added or removed | `git log -S '<text>' --oneline` (pickaxe); `-G '<regex>'` for a pattern |
| Commits by message | `git log --grep='<words>' -i --oneline` |
| By date or author | `--since='2 weeks ago'`, `--author='<name>'` |
| What a branch adds | `git log --oneline main..<branch>` |
| Between releases | `git log --oneline v1.1.0..v1.1.1` |
| Where a commit has landed | `git branch -a --contains <sha>`, `git tag --contains <sha>` |
| A lost commit | `git reflog` (see /git-undo) |

Answer the question asked — "this was added in abc123 on 12 Sep to fix the login redirect" — with the evidence,
rather than pasting the log.

## Release notes

For "what's in v1.2.0" or a changelog between two refs:
1. `git log --no-merges --format='%h %s' <from>..<to>`, plus merged PRs:
   `gh pr list --state merged --search "merged:>=<date>"`.
2. Group by kind — **New**, **Fixed**, **Changed**, **Internal** (tests, CI, chores) — and rewrite subjects into
   plain sentences for the reader. Link PR numbers.
3. Previous tag when only one is given: `git describe --tags --abbrev=0 <to>^`.

## Bisect: which commit broke it

Needs a known good ref, a known bad ref (often HEAD), and — ideally — a command that exits 0 when good and non-zero
when bad (a test, a build, a script).
1. Clean working tree first (stash if needed).
2. `git bisect start <bad> <good>` then `git bisect run <command>`. Without a command, test each step yourself and
   mark `git bisect good|bad`; mark untestable commits `git bisect skip`.
3. Report the first bad commit (`git show --stat`), then **always** `git bisect reset` to get back to where you were.
