# 07 — OPTIONAL, medium risk: one shared "reason" validator in `core/`

Read `README.md` in this folder first. Branch: `codex/core-reason-validator`.

**Do this one last, and only if the earlier tasks are done.** It edits Cup Taster and BTC
code and a `core/` module. The owner will run `module-boundary-checker`, `test-auditor` and
`code-reviewer` on it and expects findings.

## Why

The module-boundary review of the BTC seeding tie-break named this as owed. The rule "a
reason is trimmed, non-empty, at most 120 characters" is now written separately in:

1. `src/formats/btc/tiebreak.js` — `validateTiebreak` (~L54–69): returns `{ field, message }`
   or `null`; `TIEBREAK_REASON_MAX = 120`.
2. `src/formats/btc/seeding.js` — the seeding form's reason check and `SEEDING_REASON_MAX`
   (only on `origin/dev` after PR #188).
3. `src/formats/cup-taster/timeCorrection.js` — `validateReason` (~L60–71): **throws**
   `CorrectionInputError` with `field: 'reason'`; `REASON_MAX_LENGTH = 120`.
4. The SQL CHECK constraints in the database (leave these alone: they are the real
   enforcement and live in migrations).

The wording of the messages differs on purpose in places ("Give a reason, so the decision
can be explained later." vs "Choose or type a reason for the change.") and the return shape
differs (value/null vs throw). A second ROADMAP note: the JS validators are intentionally
slightly stricter than the SQL (they trim NBSP and count UTF-16 units) — the safe direction
(client refuses what the database would accept, never the reverse).

## What to do

1. Add `src/core/reason.js` (format-agnostic; no import from `src/formats/`):

   ```js
   export const REASON_MAX = 120;
   // Pure. Returns { ok: true, reason } with the trimmed text, or
   // { ok: false, kind: 'empty' | 'too_long', max }.
   export function checkReason(raw, { max = REASON_MAX } = {}) { … }
   ```

   Non-string input counts as empty. Keep trimming semantics at least as strict as today's
   (`String.prototype.trim()`, which already removes NBSP). The caller supplies its own
   words from the returned `kind` — core must not contain user-facing prose that is
   specific to a format.

2. Rewrite the three JS validators to call `checkReason`, **keeping each one's own message
   text, return shape and exported names exactly** (their callers and tests must not need
   to change). For the "too long" message, keep each format's existing sentence
   ("Keep the reason to 120 characters or fewer.") built from the returned `max`.

3. Point the existing max constants at `REASON_MAX` (re-export under the old names if
   other code imports them).

4. New `src/core/reason.test.js`: empty, whitespace-only, NBSP-only, exactly 120, 121,
   non-string, custom `max`.

## Acceptance

- Behaviour-preserving: every existing test in `tiebreak.test.js`, `seeding.test.js`,
  `timeCorrection.test.js`, `timeCorrectionEditor.test.js`, the bracket/seeding screen
  tests passes **without edits**. If you must edit an existing test, stop and explain why in
  the PR.
- No import from `src/formats/` inside `src/core/`; the ESLint rule `no-core-format-import`
  stays green.
- Mutation check in the PR: change `REASON_MAX` to 119 and 121 and show a test in each of
  the three formats' suites fails.
- `npm test`, `npm run lint`, `npm run format:check`, `npm run build` green.
- CHANGELOG entry; ROADMAP item (2) in "Core extractions the boundary review named" noted
  as done (keep the other three items open).

## Do not

- Touch the SQL, the RPCs, or the other three extractions in that ROADMAP bullet
  (tie-group detection, the refusal-table helper, the move-up/down control).
- Change any user-visible wording.
