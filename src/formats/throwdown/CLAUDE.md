# src/formats/throwdown/ — Throwdown format

**Phase TD.1 (core) built, 2026-11-03.** An individual 1v1 knockout: judges tap for one of two
competitors, the majority wins, the winner advances. Spec (local only, never edited for
progress): `Handoffs and Specs/THROWDOWN-SPEC-DRAFT.md`. Modules (redemption, lucky loser,
revival, latte art) are later phases (TD.3 to TD.6); TD.1 ships only the toggle mechanism with
no module in it.

Root non-negotiables apply here unconditionally — see
[the repo root CLAUDE.md](../../../CLAUDE.md) for the full list, especially the module
boundary: this directory may import from `src/core/`, never the reverse, and never from
another format. [src/formats/cup-taster/CLAUDE.md](../cup-taster/CLAUDE.md) and
[src/formats/btc/CLAUDE.md](../btc/CLAUDE.md) are the worked examples.

## Rules that hold this format together

- **Votes are rows, results are derived.** `td_votes` has one row per tap and NO judge identity
  (a test pins the column list). Totals, the leader and the winner are computed (`votes.js`,
  `bracket.js`, and in SQL `td_match_results`); the only stored result facts are
  `td_matches.result_kind` (`votes | walkover | bye`), `confirmed_at` and, for a walkover, the
  explicit winner's slot position. A walkover is never a tally.
- **Confirm is disabled while votes are level**, in the UI (`canConfirm`) and in the database
  (`td_votes_level`). `td_confirm_match` also takes the slot the organiser saw leading
  (`td_leader_changed` if the votes moved since).
- **Nothing is projected.** A round exists only once the previous main round is fully decided
  (`app.td_advance`, in the same transaction as the result; idempotent, so a second Continue
  cannot duplicate a round). The 3rd place match is created together with the Final, only when
  the event has it on, there are exactly two winners from a round of exactly two matches, and
  BOTH semi-final losers exist and are active (`event_entries.withdrawn` false; T-TD.1.9, owner
  decision 2026-11-03). A walkover does not block it (its loser is the other slot's competitor);
  a bye does (no loser), and so does a withdrawn loser. Both are live at once.
- **Shape is general.** A match has 2..4 `td_slots` (a pair round's exactly 2); a round has
  `kind` (`pair` now, `pool` reserved) and `phase` (`main | third_place | redemption`). A module
  must not change these shapes; if it has to, the core was not ready.
- **All writes are SECURITY DEFINER functions** (`td_save_settings`, `td_start_event`,
  `td_cast_vote`, `td_undo_vote`, `td_confirm_match`, `td_record_walkover`); the API roles hold
  SELECT only on the six `td_*` tables. Each function opens with `app.td_guard` (membership,
  org/event agreement, format, Per-event window lock: one answer, "event not found"), takes an
  advisory lock per event, and is idempotent through `processed_operations` (an outbox replay of
  a tap, undo, confirm, walkover or start does nothing the second time).
- **Setup is locked when Round 1 exists** (trigger plus function). Module toggles live in
  `td_settings.modules`; `modules.js` and `app.td_module_registry()` are the registry (both
  empty), with declared dependencies and a per-module entitlement key slot. A module that is
  off leaves no trace on any surface (tested).
- **Writes go through the shared outbox** (`data.js`). The screen shows server counts plus the
  taps still waiting (`pendingSnapshot`); a queued confirm or walkover closes voting on that
  match and says so; the queue is read before and after the server read and re-read if it
  changed. `droppedErrorFor` compares the OUTBOX operation id, not the database's idempotency key.
- **Live payload is public** (`liveSession.js`): names and results only, vote counts only for a
  decided vote result. The TEST banner on the phone and projector is the shared viewer shell's
  (from the live row's `is_test`); the console and results page draw their own.
- **Entitlements**: `throwdown_participants` (Community 8) is enforced by the existing
  `event_entries` cap trigger (branch for `throwdown`); competitors are `event_entries`, so
  `withdrawn` is the status (whether a withdrawn competitor counts toward the cap is open, Q8b).
  Four module keys are declared (slots only). No code branches on a tier (D14).

## Assumed defaults (owner may overrule)

Timer display-only (nothing recorded, no `clampElapsed`); the random draw stores its shuffle
seed (`core/seededShuffle.js`; the browser shuffles, the database stores the seed and checks the
shape only, it cannot replay a browser PRNG); any judge count is accepted and not capped
(`judge_count` is shown to the organiser, an extra tap resolves an even panel); the 3rd place match
is skipped when a semi-final was a bye or a loser has withdrawn (a walkover does not skip it).

## Module history

TD.1 (2026-11-03): schema `20261103111000`, functions `20261103120000`, keys and cap branch
`20261103101000`, window lock `20261103130000`; pgTAP `072`, matrices `040`/`041`; pure modules
`votes`, `bracket`, `seeding`, `modules`; `data`, `liveSession`, `outboxHandlers`; console
`eventScreen`, `resultsScreen` (printable match log and podium); phone `viewerBody`, projector
`projectorScreens`/`projectorBody`; Playwright `dev-throwdown` (full 8-competitor test event).
Out of TD.1 by design: redemption, lucky loser, revival draw, latte art, formatted PDF report,
archive write, any lift of the Random Selector engine.
