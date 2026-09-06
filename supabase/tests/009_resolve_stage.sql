-- Standings/advancement follow-up: resolve_stage RPC — handoff §9, §5.2/§7.2/§7.3.
-- Proves: resolving a stage flushes as one operation (no partial commit leaves
-- some ct_stage_entries rows written and others not), a retry after timeout
-- does not duplicate (both the exact-same operation id via the
-- processed_operations ledger, AND a fresh operation id for the identical
-- payload via ct_stage_entries' own (stage_id, entry_id) unique constraint),
-- org-scoping is real (RLS actually blocks a non-member, not just a
-- client-side trust), an entry that isn't a member of the resolving stage is
-- refused (closes the same "two independently-FK'd columns" class of gap
-- already fixed elsewhere in this schema), and the terminal-stage champion
-- branch recomputes the coin-toss note from the advancing-entries array
-- rather than trusting a separate boolean. Runs under a real `authenticated`
-- role with RLS actually in force throughout, matching 005_confirm_heat.sql/
-- 007_timing_outbox_rpcs.sql's own established discipline.
begin;
select plan(27);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- the caller below is NOT a member of Other Org

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Test Event'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000020',
   'cup_taster', 'Other Org Event');

-- b1: prelims (cutoff 1), ordinal 1 — the stage under resolution.
-- b2: finals (cutoff null, terminal), ordinal 2 — b1's own next stage, and
--     later resolved on its own to prove the terminal/champion branch.
-- b9: Other Org's own stage, for the org-scoping tests.
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs, cutoff) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 2, 480, 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1',
   'finals', 2, 2, 480, null),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e9',
   'prelims', 1, 1, 480, 1);

insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Cupper One'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'Cupper Two'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', 'Cupper Three'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1', 'Cupper Four'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000e1', 'Cupper Five'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000e9', 'Other Org Cupper');

-- a1/a2/a3 seeded into b1 — the "real" resolution below. a4 seeded separately
-- (own INSERT, below) just before the atomicity test uses it. a5 deliberately
-- NEVER gets a b1 stage-entries row — it's the "not a member of this stage"
-- fixture. a9 (Other Org's own roster) never appears in b1 either.
insert into ct_stage_entries (id, stage_id, entry_id, source) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a1', 'seed'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a2', 'seed'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a3', 'seed');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ org-scoping: a caller who isn't really a member is blocked by RLS ============
-- p_org_id here IS b9's own true org (Other Org) — the security-definer
-- org_id_for_stage check alone would pass this. The plain, RLS-filtered
-- `perform` is what actually catches it: this caller is a Test Org member
-- only, so ct_stages_read's policy filters b9 to zero rows regardless of
-- which org id was claimed.

select throws_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000b9', null,
       '[]'::jsonb, null, '[]'::jsonb, null, '[]'::jsonb, null
     ) $$,
  null,
  'resolve_stage: stage 00000000-0000-0000-0000-0000000000b9 not found',
  'a caller who is not really a member of the stage''s org sees it as not found,
   even though the org id argument matched the stage''s own true org'
);

-- ============ a caller passing the WRONG org id for a stage they CAN see ============

select throws_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000b1', null,
       '[]'::jsonb, null, '[]'::jsonb, null, '[]'::jsonb, null
     ) $$,
  null,
  'resolve_stage: stage 00000000-0000-0000-0000-0000000000b1 not found',
  'a caller who passes the wrong org id for a real, visible stage is rejected too'
);

-- ============ an advancing entry that isn't a member of the resolving stage ============

select throws_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       '[{"entry_id":"00000000-0000-0000-0000-0000000000a5","source":"advanced"}]'::jsonb,
       null, '[]'::jsonb, null, '[]'::jsonb, null
     ) $$,
  null,
  'resolve_stage: entry 00000000-0000-0000-0000-0000000000a5 is not a member of stage 00000000-0000-0000-0000-0000000000b1',
  'an entry with no ct_stage_entries row in the resolving stage is refused —
   both the correctness check and the anti-forgery one'
);

select is(
  (select count(*)::int from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a5'),
  0,
  'nothing was inserted into the next stage for the rejected non-member entry'
);

-- ============ p_next_stage_id belonging to a different org ============

select throws_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b9',
       '[]'::jsonb, null, '[]'::jsonb, null, '[]'::jsonb, null
     ) $$,
  null,
  'resolve_stage: next stage 00000000-0000-0000-0000-0000000000b9 not found',
  'a next stage belonging to a different org is refused, even though p_stage_id itself is valid'
);

-- ============ atomicity: a failure partway through rolls back EVERYTHING ============
-- a4 is a genuinely valid advancing entry (seeded into b1 right here) — this
-- INSERT would succeed entirely on its own. Paired in the SAME call with a
-- bogus eliminated stage_entry_id, the whole call must fail and leave NO
-- trace of the otherwise-valid insert behind.

insert into ct_stage_entries (id, stage_id, entry_id, source) values
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a4', 'seed');

select throws_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       '[{"entry_id":"00000000-0000-0000-0000-0000000000a4","source":"advanced"}]'::jsonb,
       null,
       '[{"stage_entry_id":"00000000-0000-0000-0000-00000000dead","via_coin_toss":false}]'::jsonb,
       9::smallint, '[]'::jsonb, null
     ) $$,
  null,
  'resolve_stage: eliminated stage entry 00000000-0000-0000-0000-00000000dead not found in stage 00000000-0000-0000-0000-0000000000b1',
  'a bogus eliminated stage_entry_id fails the whole call'
);

select is(
  (select count(*)::int from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a4'),
  0,
  'no partial commit: a4''s otherwise-valid advancing insert was NOT left behind
   after the same call failed later on the bogus eliminated row'
);

select is(
  (select count(*)::int from processed_operations where kind = 'resolve_stage'),
  0,
  'the failed atomicity-test call never reached the ledger insert either'
);

-- ============ an eliminated entry WITH via_coin_toss:true gets the note ============
-- Found by scoring-auditor: this branch (the LOSING side of a coin toss
-- getting position_note recorded, not just the winning side the terminal-
-- stage champion test below already covers) had no pgTAP coverage at the
-- RPC/SQL layer — only a client-side payload-shape assertion and a one-off
-- manual verification existed. c4 (a4) is a genuinely real ct_stage_entries
-- row in b1 (seeded above for the atomicity test, never actually written
-- since that call failed entirely). p_next_stage_id/p_champion_stage_entry_id
-- both null here deliberately isolates just the eliminated branch, same
-- isolation style the "champion from wrong stage" test below already uses.

select lives_ok(
  $$ select resolve_stage(
       '00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', null,
       '[]'::jsonb, null,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c4","via_coin_toss":true}]'::jsonb,
       5::smallint, '[]'::jsonb, 'coin toss, witnessed by organiser (losing side)'
     ) $$,
  'eliminating an entry via a lost coin toss succeeds'
);

select is(
  (select position_note from ct_stage_entries where id = '00000000-0000-0000-0000-0000000000c4'),
  'coin toss, witnessed by organiser (losing side)',
  'an eliminated entry with via_coin_toss:true gets the coin-toss note recorded —
   the losing side of a coin toss, distinct from the winning side the
   terminal-stage champion test below covers'
);

select is(
  (select final_position::int from ct_stage_entries where id = '00000000-0000-0000-0000-0000000000c4'),
  5,
  'the coin-toss-eliminated entry also got the shared final_position'
);

-- ============ a genuine, complete resolution succeeds and writes everything ============

select lives_ok(
  $$ select resolve_stage(
       '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       '[{"entry_id":"00000000-0000-0000-0000-0000000000a1","source":"advanced"}]'::jsonb,
       null,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c2","via_coin_toss":false}]'::jsonb,
       2::smallint,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c3","position":3}]'::jsonb,
       null
     ) $$,
  'a complete resolve_stage call succeeds for a real org member, under real RLS+GRANTs'
);

select is(
  (select count(*)::int from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'the advancing entry was inserted into the next stage exactly once'
);

select is(
  (select source from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  'advanced',
  'the advancing entry carries the source it was given'
);

select is(
  (select position_note from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  null,
  'a non-coin-toss advancing entry gets no position_note'
);

select is(
  (select final_position::int from ct_stage_entries where id = '00000000-0000-0000-0000-0000000000c2'),
  2,
  'the eliminated entry got the shared final_position'
);

select is(
  (select position_note from ct_stage_entries where id = '00000000-0000-0000-0000-0000000000c2'),
  null,
  'the eliminated entry (viaCoinToss: false) got no position_note'
);

select is(
  (select final_position::int from ct_stage_entries where id = '00000000-0000-0000-0000-0000000000c3'),
  3,
  'the below-cutoff entry kept its own already-computed position'
);

select is(
  (select status from ct_stages where id = '00000000-0000-0000-0000-0000000000b1'),
  'complete',
  'the resolved stage is marked complete'
);

-- ============ retry after timeout does not duplicate (same operation id) ============

select lives_ok(
  $$ select resolve_stage(
       '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       '[{"entry_id":"00000000-0000-0000-0000-0000000000a1","source":"advanced"}]'::jsonb,
       null,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c2","via_coin_toss":false}]'::jsonb,
       2::smallint,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c3","position":3}]'::jsonb,
       null
     ) $$,
  'replaying the exact same operation id is a safe no-op, not an error'
);

select is(
  (select count(*)::int from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'the exact-operation-id replay did not duplicate the advancing insert'
);

-- ============ a FRESH operation id for the identical payload also doesn't duplicate ============
-- Simulates a client that never saw the ack and retried with a brand-new
-- operation id (the processed_operations ledger alone can't catch this case —
-- ct_stage_entries' own (stage_id, entry_id) unique constraint, via ON
-- CONFLICT DO NOTHING, is what actually protects the insert here).

select lives_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       '[{"entry_id":"00000000-0000-0000-0000-0000000000a1","source":"advanced"}]'::jsonb,
       null,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c2","via_coin_toss":false}]'::jsonb,
       2::smallint,
       '[{"stage_entry_id":"00000000-0000-0000-0000-0000000000c3","position":3}]'::jsonb,
       null
     ) $$,
  'a fresh operation id for the identical payload also succeeds harmlessly'
);

select is(
  (select count(*)::int from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'ON CONFLICT DO NOTHING protected the insert even under a brand-new operation id'
);

-- ============ terminal stage: declaring a champion recomputes the coin-toss note ============
-- b2 is terminal (cutoff null) — a1's own ct_stage_entries row in b2 (just
-- inserted above) becomes the champion. p_next_stage_id is null, so
-- p_advancing_entries here is read ONLY for its source, never inserted.

select lives_ok(
  format(
    $$ select resolve_stage(
         '00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-000000000010',
         '00000000-0000-0000-0000-0000000000b2', null,
         '[{"entry_id":"00000000-0000-0000-0000-0000000000a1","source":"coin_toss"}]'::jsonb,
         %L,
         '[]'::jsonb, null, '[]'::jsonb, 'coin toss, witnessed by organiser'
       ) $$,
    (select id from ct_stage_entries
       where stage_id = '00000000-0000-0000-0000-0000000000b2'
         and entry_id = '00000000-0000-0000-0000-0000000000a1')
  ),
  'declaring a champion at the terminal stage succeeds'
);

select is(
  (select final_position::int from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'the champion''s own row is marked final_position 1'
);

select is(
  (select position_note from ct_stage_entries
     where stage_id = '00000000-0000-0000-0000-0000000000b2'
       and entry_id = '00000000-0000-0000-0000-0000000000a1'),
  'coin toss, witnessed by organiser',
  'the champion''s coin-toss note is recomputed from p_advancing_entries carrying source = coin_toss,
   not from a separate trusted boolean'
);

-- ============ champion_stage_entry_id from the WRONG stage is refused ============
-- c1 is b1's own row (a1's stage entry in the PRELIMS stage, not finals) —
-- passing it as the champion while p_stage_id = b2 must fail, the same
-- "two independently-FK'd columns" check every other row-touching branch here
-- already enforces.

select throws_ok(
  $$ select resolve_stage(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b2', null,
       '[]'::jsonb, '00000000-0000-0000-0000-0000000000c1',
       '[]'::jsonb, null, '[]'::jsonb, null
     ) $$,
  null,
  'resolve_stage: champion stage entry 00000000-0000-0000-0000-0000000000c1 not found in stage 00000000-0000-0000-0000-0000000000b2',
  'a stage_entry_id genuinely belonging to a DIFFERENT stage is refused as champion'
);

reset role;

select * from finish();
rollback;
