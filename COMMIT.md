# Git Commit Guide

## Format
(<action>) <content>

## Rules
* **Structure:** Wrap the action in parentheses, followed by a single space and the content.
* **Style:** Use lowercase, imperative mood ("add" not "added"), and no trailing period.
* **Length:** Keep the entire message short, direct, and under 50 characters.
* **Single Line Only:** Do not include a commit body or footer unless explicitly requested.
* **Strict AI Restriction:** NEVER append `Co-Authored-By: Claude`, `Generated with Claude Code`, or any AI attribution trailers/tags to commit messages.

## Allowed Actions
* `(feat)` - new feature or functionality
* `(fix)` - bug or error fix
* `(refactor)` - code restructuring without behavior change
* `(perf)` - performance or latency optimization
* `(docs)` - documentation changes
* `(test)` - adding or updating tests
* `(chore)` - build scripts, configs, or dependencies

## Examples
Good:
* `(feat) implement spsc lock-free ring buffer`
* `(fix) resolve memory leak in packet parser`
* `(perf) align cache lines in worker queue`
* `(chore) update cmake build flags`

Bad:
* `feat: add ring buffer` (wrong format, uses colon instead of parentheses)
* `(feat) Added a new ring buffer to the system.` (past tense, capitalized, period)
* `(fix) fix bug \n\n Co-Authored-By: Claude <noreply@anthropic.com>` (violates AI tag restriction)