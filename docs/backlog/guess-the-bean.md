# Backlog: Guess the Bean

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from Guess the Bean Phase 4

- **Supabase Realtime unreliability on local dev stack for newly-published tables.**
  Originally built participant entry's close-watch using Supabase Realtime
  (postgres_changes). Live-testing proved Realtime does not reliably deliver events for
  newly-added-to-publication tables on this project's LOCAL dev stack (extensively
  debugged: pg_publication_tables, pg_replication_slots, realtime.subscription table, full
  container/stack restarts, a brand-new probe table — all ruled out any Guess-the-Bean-
  specific cause). Workaround in place: switched to 4-second polling (works everywhere, no
  open question). If a future phase wants real Postgres Changes Realtime on a new table,
  budget time to verify it actually works in the cloud deployment target (managed Supabase
  project, per CLAUDE.md's Repo section), not just assume the pre-existing `live_sessions`
  precedent generalizes — the local-stack anomaly was never tested against production.
  Flagged by: kb-sync during Phase 4 closeout.

---

## Known open items from the Guess the Bean Android widget (2026-09-19)

- **Honor MagicOS — fixed 2026-09-19; phone verified, tablet pending.** Cause was Glance's
  `Button` failing to render in Honor's launcher (shown as "Cannot add widget."), not launcher
  policy; replaced with Box+Text+clickable. Verified on the Magic V5 (cover + unfolded screens,
  live session, fresh signed release build installed in place). **Nothing Phone (2) also verified.** **Still to verify:** the
  Honor tablet. Honor Smart Services Card integration is not needed and is not
  planned.
- **No automated tests** for URL parsing, status mapping, API error/`Content-Range`
  parsing.
- **Distribution path undecided** (Play internal testing vs. managed signed release).

See `android/guess-the-bean-widget/CLAUDE.md`.

---

## Known open items from Guess the Bean Phase 1–2

- **Directory placement for Phase 3+ (session management UI) — RESOLVED (Phase 2).** New
  top-level module category `src/community/` created as a home for format-agnostic
  community/standalone games with auth (has real auth + Supabase, excluding `src/tools/`;
  no roster/scoring/advancement, excluding `src/formats/`). Guess the Bean now lives in
  `src/community/guess-the-bean/` with its own scoped CLAUDE.md. Root CLAUDE.md's
  architecture map updated.

- **guesses pre-reveal SELECT-by-creator behavior not yet confirmed against legacy.**
  The spec flags "confirm against legacy booth's own behavior, don't assume" for whether
  an unanswered guess is visible to its own creator before reveal. Phase 1's RLS policies
  allow it (creator can read pre-reveal via `guesses_select`); Phase 5 will depend on that
  being the right behavior. Before Phase 5 starts, verify against the real legacy code that
  this matches what the booth actually did. Flagged by: kb-sync during Phase 1 closeout.

- **Cross-cutting accessibility gap: aria-live "sending" state + focus recovery (task_cb9d63b0).**
  Affects both `src/community/guess-the-bean/authScreen.js` and `core/loginScreen.js`. No
  aria-live announcement of in-flight state, and native `disabled` attribute drops keyboard
  focus. Flagged by ui-accessibility-reviewer during Phase 2; spawned as separate background
  task since it's out of scope for auth-stub work and requires cross-module coordination.
  Not blocking Phase 2 closure. Flagged by: ui-accessibility-reviewer during Phase 2.

---
