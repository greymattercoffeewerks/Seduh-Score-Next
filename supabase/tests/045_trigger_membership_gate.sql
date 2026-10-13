-- T-TEN.E3 follow-up: the six remaining cross-reference triggers refuse a non-member first.
-- Proves: a signed-in person who is NOT a member of the org (or an API-role session with no user) gets the
-- standard row-level-security refusal (42501) from person_merges, ct_results, btc_matches, btc_match_judges,
-- btc_match_bonuses and btc_bracket_slots whether the ids they name fit together or not (the triggers used to
-- answer a bespoke P0001 for a mismatch, which told them whether a guessed id pair exists); a member of the
-- org still gets each trigger's own message for a real mismatch and can write a real pair; a writer with no
-- user and no API role (postgres, seeds, migrations) is still checked strictly (the NULL trap); a missing
-- parent no longer slips past `<>`; the shared helper is executable by no API role; and a catalog guard fails
-- when a new app.check_* SECURITY DEFINER trigger function appears with neither a membership gate nor the
-- standard refusal. Fixtures: org A, org B; user_a (A), user_b (B).
begin;
select plan(42);

-- ============ fixtures (as postgres, bypasses RLS) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'user-b@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002', 'owner');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Event B');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000e1', 'prelims', 1, 1, 480),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-0000000000e2', 'prelims', 1, 1, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000051', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000052', 1);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000051', 1, 480),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000052', 1, 480);
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000e1', 'Cupper A'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-0000000000e2', 'Cupper B');
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', 'T1'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000072', 'T1');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000e1', 'A-one'),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-0000000000e1', 'A-two'),
  ('00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-0000000000e1', 'A-three'),
  ('00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-0000000000e1', 'A-four'),
  ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-0000000000e2', 'B-one'),
  ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-0000000000e2', 'B-two');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
   '00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000092'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', 'preliminary',
   '00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000094');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'Judge A'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2', 'Judge B');
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a0', 'Person A1', '+6731000001'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a0', 'Person A2', '+6731000002'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a0', 'Person A3', '+6731000003'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b0', 'Person B', '+6732000001'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b0', 'Person B2', '+6732000002');
-- one existing merge per org, for the UPDATE path
insert into person_merges (id, org_id, kept_id, merged_id, merged_name) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b4', 'old A'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b5', 'old B');

-- Six writes, each in two shapes: FITS (the ids belong together inside org A) and CLASH (they do not: one id
-- is org B's). Nothing here depends on the order the shapes run in, so each is a single INSERT.
create temp table writes (tbl text, shape text, sql text, own_msg text) on commit drop;
insert into writes values
  ('person_merges', 'fits',
   $$ insert into person_merges (org_id, kept_id, merged_id, merged_name) values
        ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3', 'x') $$,
   null),
  ('person_merges', 'clash',
   $$ insert into person_merges (org_id, kept_id, merged_id, merged_name) values
        ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3', 'x') $$,
   'person_merges.kept_id must belong to the same org as org_id'),
  ('ct_results', 'fits',
   $$ insert into ct_results (heat_entry_id, set_id, correct) values
        ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000c1', true) $$,
   null),
  ('ct_results', 'clash',
   $$ insert into ct_results (heat_entry_id, set_id, correct) values
        ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000c2', true) $$,
   'ct_results.set_id must belong to the same stage as heat_entry_id''s heat'),
  ('btc_matches', 'fits',
   $$ insert into btc_matches (event_id, round, team1_id, team2_id) values
        ('00000000-0000-0000-0000-0000000000e1', 'preliminary', '00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-000000000096') $$,
   null),
  ('btc_matches', 'clash',
   $$ insert into btc_matches (event_id, round, team1_id, team2_id) values
        ('00000000-0000-0000-0000-0000000000e1', 'preliminary', '00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000094') $$,
   'btc_matches: both teams must belong to the match''s event'),
  ('btc_match_judges', 'fits',
   $$ insert into btc_match_judges (match_id, judge_id) values
        ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1') $$,
   null),
  ('btc_match_judges', 'clash',
   $$ insert into btc_match_judges (match_id, judge_id) values
        ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2') $$,
   'btc_match_judges: the judge must belong to the match''s event'),
  ('btc_match_bonuses', 'fits',
   $$ insert into btc_match_bonuses (match_id, fastest_team_id) values
        ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000091') $$,
   null),
  ('btc_match_bonuses', 'clash',
   $$ insert into btc_match_bonuses (match_id, fastest_team_id) values
        ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000093') $$,
   'btc_match_bonuses.fastest_team_id must be a participant of the match'),
  ('btc_bracket_slots', 'fits',
   $$ insert into btc_bracket_slots (event_id, round, slot_label, team1_id) values
        ('00000000-0000-0000-0000-0000000000e1', 'final', 'F1', '00000000-0000-0000-0000-000000000091') $$,
   null),
  ('btc_bracket_slots', 'clash',
   $$ insert into btc_bracket_slots (event_id, round, slot_label, team1_id) values
        ('00000000-0000-0000-0000-0000000000e1', 'final', 'F1', '00000000-0000-0000-0000-000000000093') $$,
   'btc_bracket_slots: team1 must belong to the slot''s event');
grant select on writes to authenticated, anon;

-- ============ user_b (a member of B only) writes into org A: the same refusal, fitting ids or not ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

select throws_ok(
  w.sql, '42501', 'new row violates row-level security policy for table "' || w.tbl || '"',
  w.tbl || ': a non-member is refused with the standard refusal when the ids ' || w.shape
)
from writes w order by w.tbl, w.shape;
-- (Only the CLASH shape proves the gate: a FITS write is refused by the table's own row-level security even with
-- no gate. FITS is the equality control that makes the refusal the same for both.)

-- naming a parent that does not exist is the same refusal (the guess-an-id oracle itself: the org resolves to NULL)
select throws_ok(m.sql, '42501', 'new row violates row-level security policy for table "' || m.tbl || '"',
  m.tbl || ': a non-member naming a MISSING parent gets the same refusal')
from (values
  ('btc_match_judges', $$ insert into btc_match_judges (match_id, judge_id) values (gen_random_uuid(), gen_random_uuid()) $$),
  ('btc_match_bonuses', $$ insert into btc_match_bonuses (match_id) values (gen_random_uuid()) $$),
  ('ct_results', $$ insert into ct_results (heat_entry_id, set_id, correct) values (gen_random_uuid(), gen_random_uuid(), true) $$)
) as m(tbl, sql);

-- the UPDATE path: moving one's own row into org A with a clashing kept person is refused by the gate, not told apart
select throws_ok(
  $$ update person_merges set org_id = '00000000-0000-0000-0000-0000000000a0',
       kept_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000f2' $$,
  '42501', 'new row violates row-level security policy for table "person_merges"',
  'person_merges: a non-member cannot use an UPDATE to ask about a clashing pair either');

-- ============ user_a (a member of A): a real mismatch still gets the trigger's own message ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select throws_ok(w.sql, 'P0001', w.own_msg, w.tbl || ': a member is still told about a real mismatch')
from writes w where w.shape = 'clash' order by w.tbl;

select lives_ok(w.sql, w.tbl || ': a member can still write a real pair')
from writes w where w.shape = 'fits' order by w.tbl;

select throws_ok(
  $$ update person_merges set kept_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000f1' $$,
  'P0001', 'person_merges.kept_id must belong to the same org as org_id',
  'person_merges: a member is still told about a real mismatch on UPDATE');

reset role;

-- ============ no signed-in person but an API role: still the standard refusal (the gate keys on the role too) ============

set local role authenticated;
set local request.jwt.claim.sub = '';
select throws_ok(
  (select sql from writes where tbl = 'person_merges' and shape = 'clash'),
  '42501', 'new row violates row-level security policy for table "person_merges"',
  'an authenticated session with no resolvable user id is refused (not told about the mismatch)');
reset role;
set local role anon;
-- anon: a database with narrow privileges (production) refuses at the table ("permission denied"); one with broad
-- default privileges (CI) reaches the trigger and gets the row-level-security refusal. Either is a refusal that
-- says nothing about the ids; the trigger's own mismatch message is the failure.
select throws_matching(
  (select sql from writes where tbl = 'person_merges' and shape = 'clash'),
  '^(permission denied for table person_merges|new row violates row-level security policy for table "person_merges")$',
  'an anon session is refused without being told about the mismatch');
reset role;

-- ============ a writer with neither (postgres, seeds, migrations) is still checked strictly ============

select throws_ok(
  w.sql, 'P0001', w.own_msg, w.tbl || ': with no user and no API role a mismatch is still refused (not passed on a NULL)'
)
from writes w where w.shape = 'clash' order by w.tbl;

select throws_ok(
  $$ insert into person_merges (org_id, kept_id, merged_id, merged_name) values
       ('00000000-0000-0000-0000-0000000000a0', gen_random_uuid(), '00000000-0000-0000-0000-0000000000b3', 'x') $$,
  'P0001', 'person_merges.kept_id must belong to the same org as org_id',
  'person_merges: a MISSING kept person is refused by the trigger (not passed on `NULL <> org`)');
select throws_ok(
  $$ insert into ct_results (heat_entry_id, set_id, correct) values
       ('00000000-0000-0000-0000-000000000081', gen_random_uuid(), true) $$,
  'P0001', 'ct_results.set_id must belong to the same stage as heat_entry_id''s heat',
  'ct_results: a MISSING set is refused by the trigger (not passed on `NULL <> stage`)');

-- ============ the shared helper is callable by nobody who calls the API ============

select is(
  (select coalesce(string_agg(r.rolname, ', ' order by r.rolname), 'none')
     from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.rolname, 'app.refuse_non_member(uuid, text)', 'execute')),
  'none',
  'app.refuse_non_member is executable by no API role');

-- ============ completeness: a new cross-reference trigger must have the gate or the standard refusal ============

-- every SECURITY DEFINER function behind a BEFORE ROW trigger, whatever it is named or where it lives, comments ignored
create temp table before_row_definers on commit drop as
  select distinct n.nspname || '.' || p.proname as fn,
         regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as src
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where not t.tgisinternal and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1 and p.prosecdef;
select cmp_ok((select count(*)::int from before_row_definers), '>=', 13,
  'the catalog guard sees the SECURITY DEFINER BEFORE ROW trigger functions (it is not matching nothing)');
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), 'none')
     from before_row_definers
    where src !~ 'refuse_non_member|is_org_member|errcode = ''42501'''
      -- not cross-reference checks: they act on org_members / stamp a column, and say nothing about other rows
      and fn not in ('app.protect_last_owner', 'app.stamp_public_results_org')),
  'none',
  'every SECURITY DEFINER BEFORE ROW trigger function has a membership gate or refuses with the standard 42501 (or is a named exception)');

select * from finish();
rollback;
