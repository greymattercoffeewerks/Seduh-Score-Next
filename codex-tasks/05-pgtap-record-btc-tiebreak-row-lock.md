# 05 — pgTAP: prove `record_btc_tiebreak` holds its row lock

Read `README.md` in this folder first. Branch: `codex/pgtap-tiebreak-row-lock`.

**Needs the local Supabase stack (Docker).** This task adds a **test only**. It must not
change any migration or any function, and it never touches the cloud project.

## Why

ROADMAP, "Known open items from T-BTC.knockout-tiebreak": _"No test of
`record_btc_tiebreak`'s row lock. Removing `FOR UPDATE` survives the pgTAP suite. The
`pgrowlocks` technique `028` now uses (assert the row is held `FOR UPDATE` after the call,
in one session; not `xmax`, which foreign-key checks also set) would prove it without a
second session."_

The lock is what stops two organisers recording a tie-break (or a confirm landing) for the
same knockout at the same instant. If someone "simplifies" the function and drops
`FOR UPDATE`, nothing currently fails.

## Where

- Function: `record_btc_tiebreak` in `supabase/migrations/20261009110000_btc_knockout_tiebreak.sql`
  (**already applied to the cloud project — never edit it**; a fix would be a new migration,
  which is out of scope here).
- Existing tests for it: `supabase/tests/027_btc_tiebreak.sql`. Read its structure, its
  `plan(N)` count, and how it builds fixtures.
- The technique to copy: `supabase/tests/028_btc_load_demo.sql` ~L231–240 —
  `create extension if not exists pgrowlocks;` then
  `exists (select 1 from pgrowlocks('public.events') r where 'For Update' = any (r.modes))`
  evaluated **in the same transaction** after calling the function (pgTAP runs each file in
  one transaction, so the lock is still held).
- Run tests: `npm run supabase -- start` (first time), then `npm run db:reset` and
  `npm run db:test`. One file: `npx supabase test db --local supabase/tests/027_btc_tiebreak.sql`.
  Do not run two reviewers/agents against the same local DB at once (they share it; use
  unique fixture ids and roll back).

## What to do

1. In `027_btc_tiebreak.sql`, after a successful `record_btc_tiebreak` call on a fixture
   match, assert that the **match row** (`public.btc_matches`, the one the function locks —
   read the function body to see exactly which row and which lock mode it takes) is held
   `For Update` by the current transaction. Assert it for the right row only (filter
   `pgrowlocks` by the match's `ctid` or compare to an unrelated match in the same event,
   which must **not** be locked).
2. Also assert the negative: before the call, the same row is not locked.
3. Bump `select plan(N)` by exactly the number of assertions you add.
4. Prove the test bites **without editing the migration**: in a scratch SQL session against
   the local DB, inside a transaction you roll back, `create or replace function` a copy of
   `record_btc_tiebreak` with `for update` removed, run the new assertions, confirm they fail,
   `rollback`. Paste the failing output in the PR. Then run the real suite and confirm it
   passes. (If you reset the DB afterwards, say so.)

## Acceptance

- `npm run db:reset && npm run db:test` fully green; the count of assertions in
  `027_btc_tiebreak.sql` goes up by the number you added, `plan()` matches.
- The mutation demonstration is in the PR body.
- Diff touches only `supabase/tests/027_btc_tiebreak.sql`, plus CHANGELOG/ROADMAP (mark the
  item CLOSED, T-BTC.tiebreak-lock-test).

## Do not

- Edit `supabase/migrations/**`, add migrations, or run anything against the cloud.
- Use a second database session to test the lock (the point of the technique is that one
  session suffices).
