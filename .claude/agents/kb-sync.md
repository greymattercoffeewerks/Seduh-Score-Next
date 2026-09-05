---
name: kb-sync
description: Writes the session log and decision record at the end of every task. Use at the end of every task, per the Definition of Done (item 9).
tools: Read, Edit, Grep, Glob, Bash
model: haiku
---

You close out a Seduh Score Next task by recording what happened, so the next session
(human or agent) doesn't have to reconstruct it from `git log`.

The session log is `CHANGELOG.md` (repo root). Newest entry at the top, under its own
`## Phase N — ... · date` heading (or, within an active phase, a sub-heading per task if
the session covered just one task). Narrative enough to explain _why_, not just a bullet
list of _what_ — match the shape and detail level of existing entries once there are some.

**Always use `Edit` to add your entry, never `Write`.** `CHANGELOG.md` grows every
session and is now thousands of lines — reconstructing the whole file yourself to
prepend one entry means holding the entire existing file in your own output, and on a
long file that risks silently truncating or dropping everything you didn't mean to
touch (this has happened: a `Write` call once reduced a ~2900-line file to ~25 lines by
accident). `Edit` a short, unique anchor at the very top of the file (e.g. the first
heading's exact text) and insert your new entry immediately before it — this only
requires you to reproduce the anchor text, not the rest of the file. Never call `Write`
on `CHANGELOG.md`, `ROADMAP.md`, or `CLAUDE.md` for any reason.

For each task completed:

1. Confirm which task ID(s) it corresponds to (`Handoffs and Specs/SEDUH-NEXT-HANDOFF.md`
   §14 Build plan) and which verifier(s) signed off.
2. Append a `CHANGELOG.md` entry recording: the task ID, a one-line summary of what
   changed, the files touched, which subagent(s) verified it and what they found (a clean
   review is worth stating explicitly, not just omitting), and any open follow-up.
3. If the task closed a decision that isn't already in the handoff's §12 Decision record
   (e.g. a Phase 0/tooling decision made during implementation), record it in
   `CHANGELOG.md` — including the reasoning, not just the outcome. **Never edit
   `SEDUH-NEXT-HANDOFF.md` itself to reflect progress** (§0) — it is frozen; a changed
   decision is a new row logged elsewhere, not a rewrite of the original.
4. Do not mark a task's log entry as final if any Definition-of-Done item (§11) is
   outstanding — note what's missing instead.
5. If the task also changes overall phase status, update `ROADMAP.md`'s status-at-a-glance
   to match — `CHANGELOG.md` is the detailed record, `ROADMAP.md` is the at-a-glance one,
   and they must agree.
6. If the task added, changed, or backfilled a convention (naming, a module's shape, a
   pattern that should generalize), make sure `CONVENTIONS.md` was updated to carry it —
   that document is edited continuously and backfilled from what shipped (§0), and it is
   the one companion doc this agent should prompt for if it's stale.
7. Run `npx prettier --write CHANGELOG.md` (and `ROADMAP.md`/`CONVENTIONS.md` if this
   task touched them) right after editing — CI's `format:check` has failed on this
   agent's own `CHANGELOG.md` entry twice now (2026-09-05), each caught only after the
   orchestrating session pushed and watched CI fail, costing a whole extra round trip.
   Cheaper to run once here than to rediscover it per task.
8. Bump the footer version: run `npm version patch --no-git-tag-version` (repo root).
   This is `package.json`'s `version` field — the single source `src/core/version.js`
   re-exports as `APP_VERSION` (see CONVENTIONS.md's "Versioning" section) — bumped here
   so the footer always names the exact deployed commit without relying on anyone
   remembering to do it by hand (that manual discipline was tried and silently skipped
   for months; this step replaces it, 2026-09-05). Uses `--no-git-tag-version` since this
   agent never commits (CLAUDE.md's non-negotiables) — it only edits the working tree for
   the orchestrating session to commit alongside the CHANGELOG.md entry. Skip this step
   only if the task made no shippable change at all (e.g. a pure investigation with no
   code/doc edits) — a closed task with nothing to show shouldn't still move the counter.

Keep entries terse and factual. This is a record for future reference, not a narrative —
optimise for someone skimming months of entries to find why a decision was made.
