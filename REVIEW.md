# Review instructions

Instructions for automated pull request review. Project-wide rules live in `CLAUDE.md`
and `CONVENTIONS.md`; this file only changes what a review flags, at what severity, and
what it skips. The local review protocol (find, verify, rank) is in `CLAUDE.md` under
"Review protocol".

## What Important means here

Reserve Important for a finding that would break behaviour, expose one organisation's data
to another, or make a change impossible to roll back:

- A tenant table or RPC reachable across organisations: a missing `app.is_org_member(...)`
  check, a write policy without `WITH CHECK`, a `SECURITY DEFINER` function without
  `set search_path = ''`, a cross-reference trigger that does not start with
  `app.refuse_non_member(...)`, or anon reading a table instead of using a narrow door.
- An admin function that skips `app.require_platform_admin()`, or any path that lets the
  admin console read participant data.
- A migration that edits one already pushed to the cloud project, has no tested
  `-- rollback:` block, or is not forward-only.
- A standings position or tally persisted as a column, or `elapsed_secs` written anywhere
  but `clampElapsed()`.
- An outbox or sync change that can apply an operation twice, drop one silently, or swallow
  a persistence failure in a bare `catch`.
- A live surface that renders an `is_test` event without the unmistakable test treatment.
- Format-specific logic in `src/core/`, or a `core/` primitive reimplemented in a format.

Everything else (naming, structure, comments, small refactors, missing tests for
unchanged behaviour) is Nit at most.

## Cap the nits

Report at most five Nits per review. If there are more, keep the five that are most likely
to confuse the next reader and drop the rest.

## Pre-existing bugs

Report a Pre-existing finding only when it sits in a file the pull request changes and
could realistically bite a user. At most three per review.

## Do not report

- Anything CI already enforces: Prettier, ESLint (including `no-trio-vocabulary`,
  `no-core-format-import`, `no-derived-storage`, `no-raw-elapsed-write`), the pgTAP
  cross-organisation matrices (`040` tables, `041` RPCs), and `check:admin-leak`
- `package-lock.json`, `dist/`, `test-results/`, `playwright-report/`, and everything
  under `android/` that Gradle generates
- Prose wording in `CHANGELOG.md` and `ROADMAP.md`, unless it states something false about
  the code
- `Handoffs and Specs/`, which is frozen by design and never edited for progress
- Test-only code that intentionally breaks a production rule to prove the rule fails

For `supabase/tests/` and `tests/e2e/`, only report a test that cannot fail (asserts
nothing about the invariant it names) or a negative case the task names that is missing.

## Always check

- A new tenant table or RPC has its entry in the cross-organisation matrices and a
  parent-freeze trigger.
- A new migration has a rollback block, and the pull request says whether it has been
  pushed to the cloud project (merging does not push it).
- A new live-surface rendering path carries the `is_test` treatment from its first commit.
- A new `src/` module passes the question "can a future format reuse this without editing
  it?"
- A UI change names how it behaves at 360px.

## Evidence before posting

Every finding needs a `file:line` citation and a concrete failing input or state. A claim
about behaviour must cite the source that proves it, not an inference from a function or
variable name. If you cannot trace a realistic path from a real caller to the failure,
do not post it.

## Summary and re-reviews

Start the summary with a count per severity (for example "Important 1, Nit 2, Pre-existing
0"). When there is nothing to fix, say so in one line and stop.

After the second pass on a pull request, review only the new diff. Do not repeat a finding
already posted. When you flag a bug, name its class so the author fixes every instance in
one commit. After three rounds, ask the author to reconsider the approach rather than
posting a fourth round of findings.
