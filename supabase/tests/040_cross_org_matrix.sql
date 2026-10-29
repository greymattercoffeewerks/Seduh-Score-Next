-- T-TEN.E1 (part 1): the cross-organisation negative matrix over every tenant TABLE, and the guards that keep it complete.
--
-- Two organisations, A and B, each with one row in every tenant table, and five callers:
--   anon, user_c (signed in, belongs to nobody), user_a (A only), user_b (B only), user_ab (both).
-- For every table the matrix proves, with the answer written out per caller and organisation (so a failure
-- names the exact table, caller and organisation):
--   * READ    a caller sees an organisation's rows only if they belong to it (plus the two tables that are
--             public by design: public_results to anon, and live_sessions' ACTIVE rows to everyone);
--   * UPDATE  a caller changes an organisation's rows only if they belong to it and the table is writable by
--             members at all (some are written only through RPCs or never);
--   * DELETE  and INSERT: no caller who does not belong to an organisation can delete its rows, or insert a copy
--             of one of them (refused with the standard 42501);
--   * MOVE    user_ab, who belongs to BOTH, cannot move a row from one organisation to the other, in either
--             direction: org_id is frozen (23001, T-TEN.B1) and every child cannot be re-pointed at the other
--             organisation's parent (23001 or the cross-organisation refusal 42501, T-TEN.B2).
-- Every attempt runs in a sub-transaction that is always rolled back (e1.affected / e1.refusal), so nothing the
-- matrix tries, even if it succeeded, can change the fixtures or hide a later failure.
--
-- It must hold in BOTH kinds of database this project meets. Production (and a long-lived local stack) has the
-- narrow table privileges the revoke migrations leave: anon holds almost nothing, members hold only what each
-- table needs. A database built from scratch by a newer Supabase CLI (CI) hands `anon` and `authenticated` ALL
-- privileges on every new table, so there the ONLY barrier is row-level security. The matrix passes in both, which
-- is the point. Where the two differ the matrix says so: the ledger table's member-update answer follows the database's
-- privilege (update_env), a few refusals in a narrow database come from a missing privilege rather than a trigger
-- (the loose run is what exercises the triggers), and two privilege pins are skipped where privileges are broad.
--
-- And the structure that keeps it honest (a new table fails here until someone decides about it):
--   * every public table has row-level security enabled;
--   * every public table is either in this matrix or is one of the three Guess the Bean participant tables;
--   * every table in the matrix has an organisation-scoped policy, or is deny-all (no policy, and neither anon
--     nor signed-in callers hold any privilege on it);
--   * the privileges `anon` holds on tables and columns are exactly the pinned list below.
-- (org_id immutability on every table that carries the column is pinned separately by 033.)
begin;
select plan(163);

-- ============ helpers (rolled back with the rest) ============

create schema e1;
grant usage on schema e1 to anon, authenticated;

create function e1.u(tag text, n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-' || tag || '-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Rows changed by a write, or 0 when it was refused by an error; always rolled back.
create function e1.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  raise exception using errcode = 'P9999', message = n::text;
exception when others then
  if sqlstate = 'P9999' then return sqlerrm::int; end if;
  -- refused: no privilege (42501) or a freeze trigger (23001) is a refusal; a broken statement (a syntax, type or
  -- constraint error: classes 22, 23, 42) is reported as -1 and fails the "nothing broke" check below
  if sqlstate in ('42501', '23001') then return 0; end if;
  if left(sqlstate, 2) in ('22', '23', '42') then return -1; end if;
  return 0;
end $$;

-- The SQLSTATE a statement was refused with, or 'ok' when it was NOT refused; always rolled back.
create function e1.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate;
end $$;

-- The message of the same refusal, so a refusal can be told from a statement that failed for another reason.
create function e1.refusal_msg(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  return sqlerrm;
end $$;

-- What a MOVE did: the SQLSTATE it was refused with, 'zero' when it ran but no row was visible to change (row-level
-- security, where there is no policy to allow it), or 'ok' when it really moved a row; always rolled back.
create function e1.move_code(stmt text) returns text language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  raise exception using errcode = 'P9999', message = n::text;
exception when others then
  if sqlstate = 'P9999' then return case when sqlerrm::int = 0 then 'zero' else 'ok' end; end if;
  return sqlstate;
end $$;

-- How many rows of a table match; 0 when the caller may not read the table at all.
create function e1.rows(tbl text, filter text) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from public.%I where %s', tbl, filter) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

-- A valid E.164 phone for a fixture person (people.phone has been CHECKed since T-ID.A3): '+67390', the sequence
-- number, and two digits taken from the org tag so the two orgs differ. Never use a bare string such as '555-1'.
create function e1.phone(t text, n int) returns text language sql immutable as $$
  select '+67390' || lpad(n::text, 2, '0') || lpad((ascii(left(t, 1)) % 100)::text, 2, '0')
$$;

-- ============ fixtures (as postgres, which bypasses row-level security) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'user-b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'user-ab@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'user-c@test.seduh-next');

do $fixture$
declare
  t text;
  user_for_org uuid;
begin
  foreach t in array array['aaaa', 'bbbb'] loop
    insert into orgs (id, name, slug) values (e1.u(t, 100), 'Org ' || t, 'org-' || t);
    insert into org_members (org_id, user_id, role) values
      (e1.u(t, 100),
       case t when 'aaaa' then '00000000-0000-0000-0000-000000000001'::uuid else '00000000-0000-0000-0000-000000000002'::uuid end,
       'owner'),
      (e1.u(t, 100), '00000000-0000-0000-0000-000000000003', 'organiser');
    insert into events (id, org_id, format, name) values (e1.u(t, 1), e1.u(t, 100), 'cup_taster', 'Event ' || t);
    insert into event_entries (id, event_id, display_name) values (e1.u(t, 2), e1.u(t, 1), 'Cupper ' || t);
    insert into people (id, org_id, display_name, phone) values
      (e1.u(t, 17), e1.u(t, 100), 'Person ' || t, e1.phone(t, 1));
    insert into person_merges (id, org_id, kept_id, merged_id, merged_name) values
      (e1.u(t, 18), e1.u(t, 100), e1.u(t, 17), e1.u(t, 99), 'Merged away ' || t);
    insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
      (e1.u(t, 3), e1.u(t, 1), 'prelims', 1, 1, 480);
    insert into ct_sets (id, stage_id, position) values (e1.u(t, 4), e1.u(t, 3), 1);
    insert into ct_stage_entries (id, stage_id, entry_id) values (e1.u(t, 5), e1.u(t, 3), e1.u(t, 2));
    insert into ct_heats (id, stage_id, heat_number, duration_secs) values (e1.u(t, 6), e1.u(t, 3), 1, 480);
    insert into ct_heat_entries (id, heat_id, entry_id, station) values (e1.u(t, 7), e1.u(t, 6), e1.u(t, 2), 'Table');
    insert into ct_results (id, heat_entry_id, set_id, correct) values (e1.u(t, 8), e1.u(t, 7), e1.u(t, 4), true);
    insert into btc_teams (id, event_id, name) values
      (e1.u(t, 9), e1.u(t, 1), 'Team one ' || t),
      (e1.u(t, 10), e1.u(t, 1), 'Team two ' || t);
    insert into btc_judges (id, event_id, name) values (e1.u(t, 11), e1.u(t, 1), 'Judge ' || t);
    insert into btc_matches (id, event_id, round, team1_id, team2_id) values
      (e1.u(t, 12), e1.u(t, 1), 'preliminary', e1.u(t, 9), e1.u(t, 10));
    insert into btc_match_judges (match_id, judge_id) values (e1.u(t, 12), e1.u(t, 11));
    insert into btc_cup_votes (id, match_id, cup_number, team1_tokens) values (e1.u(t, 13), e1.u(t, 12), 1, 1);
    insert into btc_match_bonuses (match_id) values (e1.u(t, 12));
    insert into btc_bracket_slots (id, event_id, round, slot_label) values (e1.u(t, 14), e1.u(t, 1), 'final', 'Final ' || t);
    -- seeding tiebreaks are only writable while the event has NO bracket slots, so they live on an event of their
    -- own without one (otherwise the table's lock, not its organisation check, would refuse every write)
    insert into events (id, org_id, format, name) values (e1.u(t, 30), e1.u(t, 100), 'cup_taster', 'Seeding event ' || t);
    insert into btc_teams (id, event_id, name) values
      (e1.u(t, 31), e1.u(t, 30), 'Seed team one ' || t), (e1.u(t, 32), e1.u(t, 30), 'Seed team two ' || t);
    insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason) values
      (e1.u(t, 30), e1.u(t, 31), 10, 1, 2, 1, 'reason ' || t);
    -- one ACTIVE and one finished live session per organisation
    insert into events (id, org_id, format, name) values (e1.u(t, 40), e1.u(t, 100), 'cup_taster', 'Earlier event ' || t);
    insert into live_sessions (id, org_id, event_id, format, active) values
      (e1.u(t, 15), e1.u(t, 100), e1.u(t, 1), 'cup_taster', true),
      (e1.u(t, 41), e1.u(t, 100), e1.u(t, 40), 'cup_taster', false);
    insert into public_results (id, org_id, event_id, payload) values
      (e1.u(t, 16), e1.u(t, 100), e1.u(t, 1), '{"format":"cup_taster"}');
    insert into processed_operations (id, org_id, kind) values (e1.u(t, 19), e1.u(t, 100), 'confirm_heat');
    -- an entitlement grant (members read it; only the admin functions write it)
    insert into entitlement_grants (id, org_id, tier, source) values (e1.u(t, 50), e1.u(t, 100), 'annual', 'manual');
    -- a removed team member (the table is only ever read and written through the team RPCs)
    insert into team_removed_members (org_id, user_id) values (e1.u(t, 100), '00000000-0000-0000-0000-000000000004');
    -- the per-event audit counters (kept by the definer functions; no member can touch them)
    insert into score_change_counts (event_id, table_name, n) values (e1.u(t, 1), 'ct_results', 1);
  end loop;
end
$fixture$;

-- the audit log is written by triggers on the score tables: the rows above already made some
select cmp_ok((select count(*)::int from score_change_log where org_id = e1.u('aaaa', 100)), '>=', 1,
  'fixture: org A has audit-log rows (written by the score triggers)');
select cmp_ok((select count(*)::int from score_change_log where org_id = e1.u('bbbb', 100)), '>=', 1,
  'fixture: org B has audit-log rows');

-- ============ the matrix specification: one row per tenant table ============
-- filter: selects that organisation's fixture row(s) ('@' is the organisation's tag).
-- set_col: a column a no-op UPDATE can set to its own value. member_read / member_update: what members may do.
-- read_rule: 'members' (default), 'anon_all' (anon reads every organisation's rows: the public archive) or
--   'active_all' (every caller reads the ACTIVE rows of every organisation: the live sessions).
-- move_a_to_b: a statement that tries to move A's row into B ('@' = A's tag, '#' = B's tag); NULL when there is
--   nothing to move. The reverse direction is the same statement with the tags swapped.
create table e1.spec (
  tbl text primary key,
  filter text not null,
  set_col text not null,
  member_read boolean not null,
  member_update boolean not null,
  read_rule text not null default 'members',
  move_stmt text,
  insert_cols text,           -- NULL: every column; otherwise the columns a signed-in caller may insert
  update_env boolean not null default false  -- members may or may not update it, depending on the database's default privileges
);
insert into e1.spec (tbl, filter, set_col, member_read, member_update, read_rule, move_stmt) values
  ('orgs',                  'id = e1.u(''@'', 100)',        'name',          true,  false, 'members', null),
  ('org_members',           'org_id = e1.u(''@'', 100)',    'role',          true,  false, 'members', 'update public.org_members set org_id = e1.u(''#'', 100) where org_id = e1.u(''@'', 100)'),
  ('team_removed_members',  'org_id = e1.u(''@'', 100)',    'org_id',        false, false, 'members', 'update public.team_removed_members set org_id = e1.u(''#'', 100) where org_id = e1.u(''@'', 100)'),
  ('events',                'id = e1.u(''@'', 1)',          'id',            true,  true,  'members', 'update public.events set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 1)'),
  ('event_entries',         'id = e1.u(''@'', 2)',          'id',            true,  true,  'members', 'update public.event_entries set event_id = e1.u(''#'', 1) where id = e1.u(''@'', 2)'),
  ('people',                'id = e1.u(''@'', 17)',         'id',            true,  true,  'members', 'update public.people set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 17)'),
  ('person_merges',         'id = e1.u(''@'', 18)',         'id',            true,  true,  'members', 'update public.person_merges set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 18)'),
  ('ct_stages',             'id = e1.u(''@'', 3)',          'id',            true,  true,  'members', 'update public.ct_stages set event_id = e1.u(''#'', 1) where id = e1.u(''@'', 3)'),
  ('ct_sets',               'id = e1.u(''@'', 4)',          'id',            true,  true,  'members', 'update public.ct_sets set stage_id = e1.u(''#'', 3) where id = e1.u(''@'', 4)'),
  ('ct_stage_entries',      'id = e1.u(''@'', 5)',          'id',            true,  true,  'members', 'update public.ct_stage_entries set stage_id = e1.u(''#'', 3) where id = e1.u(''@'', 5)'),
  ('ct_heats',              'id = e1.u(''@'', 6)',          'id',            true,  true,  'members', 'update public.ct_heats set stage_id = e1.u(''#'', 3) where id = e1.u(''@'', 6)'),
  ('ct_heat_entries',       'id = e1.u(''@'', 7)',          'id',            true,  true,  'members', 'update public.ct_heat_entries set heat_id = e1.u(''#'', 6) where id = e1.u(''@'', 7)'),
  ('ct_results',            'id = e1.u(''@'', 8)',          'id',            true,  true,  'members', 'update public.ct_results set heat_entry_id = e1.u(''#'', 7) where id = e1.u(''@'', 8)'),
  ('btc_teams',             'id = e1.u(''@'', 9)',          'id',            true,  true,  'members', 'update public.btc_teams set event_id = e1.u(''#'', 1) where id = e1.u(''@'', 9)'),
  ('btc_judges',            'id = e1.u(''@'', 11)',         'id',            true,  true,  'members', 'update public.btc_judges set event_id = e1.u(''#'', 1) where id = e1.u(''@'', 11)'),
  ('btc_matches',           'id = e1.u(''@'', 12)',         'id',            true,  true,  'members', 'update public.btc_matches set event_id = e1.u(''#'', 1) where id = e1.u(''@'', 12)'),
  ('btc_match_judges',      'match_id = e1.u(''@'', 12)',   'match_id',      true,  true,  'members', 'update public.btc_match_judges set match_id = e1.u(''#'', 12) where match_id = e1.u(''@'', 12)'),
  ('btc_cup_votes',         'id = e1.u(''@'', 13)',         'id',            true,  true,  'members', 'update public.btc_cup_votes set match_id = e1.u(''#'', 12) where id = e1.u(''@'', 13)'),
  ('btc_match_bonuses',     'match_id = e1.u(''@'', 12)',   'match_id',      true,  true,  'members', 'update public.btc_match_bonuses set match_id = e1.u(''#'', 12) where match_id = e1.u(''@'', 12)'),
  ('btc_bracket_slots',     'id = e1.u(''@'', 14)',         'id',            true,  true,  'members', 'update public.btc_bracket_slots set event_id = e1.u(''#'', 1) where id = e1.u(''@'', 14)'),
  ('btc_seeding_tiebreaks', 'event_id = e1.u(''@'', 30)',   'reason',        true,  true,  'members', 'update public.btc_seeding_tiebreaks set event_id = e1.u(''#'', 30) where event_id = e1.u(''@'', 30)'),
  ('live_sessions',         'id = e1.u(''@'', 15)',         'id',            true,  true,  'active_all', 'update public.live_sessions set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 15)'),
  ('public_results',        'id = e1.u(''@'', 16)',         'id',            true,  true,  'anon_all', 'update public.public_results set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 16)'),
  ('processed_operations',  'id = e1.u(''@'', 19)',         'id',            true,  false,  'members', 'update public.processed_operations set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 19)'),
  ('score_change_log',      'org_id = e1.u(''@'', 100)',    'reason',        true,  false, 'members', 'update public.score_change_log set org_id = e1.u(''#'', 100) where org_id = e1.u(''@'', 100)'),
  ('score_change_counts',   'event_id = e1.u(''@'', 1)',    'event_id',      false, false, 'members', 'update public.score_change_counts set event_id = e1.u(''#'', 1) where event_id = e1.u(''@'', 1)'),
  ('entitlement_grants',    'id = e1.u(''@'', 50)',         'id',            true,  false, 'members', 'update public.entitlement_grants set org_id = e1.u(''#'', 100) where id = e1.u(''@'', 50)');

-- a caller may insert only these columns of this table (recorded_by / recorded_at are set by the database), so a copy
-- of the row is built from them; with the others included the refusal would be a column privilege, not row-level security
update e1.spec set insert_cols = 'event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason'
 where tbl = 'btc_seeding_tiebreaks';

-- the ledger of processed operations is insert-only in production (no UPDATE privilege) but its policy would allow
-- an update where default privileges grant one; either way only the owning organisation's members may
update e1.spec set update_env = true where tbl = 'processed_operations';

select is((select count(*)::int from e1.spec), 27, 'the matrix covers 27 tenant tables');

-- one captured row per table and organisation, so a copy of it can be INSERTed by someone it does not belong to
create table e1.fx (tbl text, org text, doc jsonb);
do $fx$
declare s record; t text; d jsonb;
begin
  for s in select * from e1.spec loop
    foreach t in array array['aaaa', 'bbbb'] loop
      execute format('select to_jsonb(x) from public.%I x where %s limit 1', s.tbl, replace(s.filter, '@', t)) into d;
      insert into e1.fx values (s.tbl, t, d);
    end loop;
  end loop;
end
$fx$;
select is((select coalesce(string_agg(tbl || '/' || org, ', '), 'none') from e1.fx where doc is null), 'none', 'fixture: every table has a captured row for both organisations');

create table e1.results (caller text, tbl text, org text, kind text, n int, code text, msg text);
grant select on e1.spec, e1.fx to anon, authenticated;
grant insert on e1.results to anon, authenticated;
grant execute on all functions in schema e1 to anon, authenticated;

-- who belongs to which organisation
create function e1.member(caller text, org text) returns boolean language sql immutable as $$
  select case caller
    when 'user_a'  then org = 'aaaa'
    when 'user_b'  then org = 'bbbb'
    when 'user_ab' then true
    else false end
$$;
grant execute on function e1.member(text, text) to anon, authenticated;

-- ============ one run per caller: record what each statement did ============

create procedure e1.run_as(caller text) language plpgsql as $$
begin
  insert into e1.results
  select caller, s.tbl, o.org, 'read', e1.rows(s.tbl, replace(s.filter, '@', o.org)), null, null
    from e1.spec s cross join (values ('aaaa'), ('bbbb')) o(org);
  -- a FINISHED live session is visible to its own organisation's members only
  insert into e1.results
  select caller, 'live_sessions', o.org, 'read_finished', e1.rows('live_sessions', format('id = e1.u(%L, 41)', o.org)), null, null
    from (values ('aaaa'), ('bbbb')) o(org);
  insert into e1.results
  select caller, s.tbl, o.org, 'update',
         e1.affected(format('update public.%I set %I = %I where %s', s.tbl, s.set_col, s.set_col, replace(s.filter, '@', o.org))),
         null, null
    from e1.spec s cross join (values ('aaaa'), ('bbbb')) o(org);
  -- deletes and inserts are only tried against an organisation the caller does NOT belong to
  insert into e1.results
  select caller, s.tbl, o.org, 'delete',
         e1.affected(format('delete from public.%I where %s', s.tbl, replace(s.filter, '@', o.org))), null, null
    from e1.spec s cross join (values ('aaaa'), ('bbbb')) o(org)
   where not e1.member(caller, o.org);
  insert into e1.results
  select caller, s.tbl, o.org, 'insert', null,
         e1.refusal(case when s.insert_cols is null
           then format('insert into public.%I select (jsonb_populate_record(null::public.%I, f.doc)).* from e1.fx f where f.tbl = %L and f.org = %L',
                       s.tbl, s.tbl, s.tbl, o.org)
           else format('insert into public.%I (%s) select %s from e1.fx f, jsonb_populate_record(null::public.%I, f.doc) r where f.tbl = %L and f.org = %L',
                       s.tbl, s.insert_cols, (select string_agg('r.' || trim(c), ', ') from unnest(string_to_array(s.insert_cols, ',')) c), s.tbl, s.tbl, o.org)
         end), null
    from e1.spec s cross join (values ('aaaa'), ('bbbb')) o(org)
   where not e1.member(caller, o.org);
  -- a member of ONE organisation tries to move its rows into the other (not theirs)
  insert into e1.results
  select caller, s.tbl, d.src, 'move_single', null,
         e1.move_code(replace(replace(s.move_stmt, '#', d.dst), '@', d.src)),
         e1.refusal_msg(replace(replace(s.move_stmt, '#', d.dst), '@', d.src))
    from e1.spec s,
         (select case caller when 'user_a' then 'aaaa' else 'bbbb' end as src,
                 case caller when 'user_a' then 'bbbb' else 'aaaa' end as dst) d
   where s.move_stmt is not null and caller in ('user_a', 'user_b');
end $$;

set local role anon;
call e1.run_as('anon');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
call e1.run_as('user_c');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
call e1.run_as('user_a');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
call e1.run_as('user_b');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
call e1.run_as('user_ab');

-- user_ab belongs to both organisations: can anything be moved from one to the other?
insert into e1.results
select 'user_ab', s.tbl, d.src, 'move', null,
       e1.move_code(replace(replace(s.move_stmt, '#', d.dst), '@', d.src)),
       e1.refusal_msg(replace(replace(s.move_stmt, '#', d.dst), '@', d.src))
  from e1.spec s cross join (values ('aaaa', 'bbbb'), ('bbbb', 'aaaa')) d(src, dst)
 where s.move_stmt is not null;
reset role;

-- ============ what each caller should have seen ============

-- true when a caller may read the organisation's row of this table
create function e1.expect_read(caller text, org text, tbl text) returns boolean language sql stable as $$
  select case
    when s.read_rule = 'anon_all' and caller = 'anon' then true
    when s.read_rule = 'active_all' then true            -- the fixture's live sessions are all active
    else e1.member(caller, org) and s.member_read
  end
  from e1.spec s where s.tbl = expect_read.tbl
$$;
create function e1.expect_update(caller text, org text, tbl text) returns boolean language sql stable as $$
  select e1.member(caller, org) and s.member_update from e1.spec s where s.tbl = expect_update.tbl
$$;

-- ============ the matrix ============

select is(
  (select string_agg(r.caller || '/' || r.org || '=' || (r.n > 0)::text, ' ' order by r.caller, r.org)
     from e1.results r where r.tbl = s.tbl and r.kind = 'read'),
  (select string_agg(r.caller || '/' || r.org || '=' || e1.expect_read(r.caller, r.org, s.tbl)::text, ' ' order by r.caller, r.org)
     from e1.results r where r.tbl = s.tbl and r.kind = 'read'),
  s.tbl || ': who can READ which organisation''s row'
) from e1.spec s order by s.tbl;

select is(
  (select string_agg(r.caller || '/' || r.org || '=' || (r.n > 0)::text, ' ' order by r.caller, r.org)
     from e1.results r where r.tbl = s.tbl and r.kind = 'update'),
  (select string_agg(r.caller || '/' || r.org || '='
                     || case when s.update_env and e1.member(r.caller, r.org)
                             -- a member may update the ledger exactly where the database grants the UPDATE privilege
                             then has_table_privilege('authenticated', 'public.' || s.tbl, 'update')::text
                             else e1.expect_update(r.caller, r.org, s.tbl)::text end, ' ' order by r.caller, r.org)
     from e1.results r where r.tbl = s.tbl and r.kind = 'update'),
  s.tbl || ': who can UPDATE which organisation''s row'
) from e1.spec s order by s.tbl;

select is(
  (select coalesce(string_agg(r.caller || '/' || r.org || '=' || r.n, ' ' order by r.caller, r.org), 'none')
     from e1.results r where r.tbl = s.tbl and r.kind = 'delete' and r.n <> 0),
  'none',
  s.tbl || ': nobody DELETES an organisation''s row without belonging to it'
) from e1.spec s order by s.tbl;

select is(
  (select coalesce(string_agg(r.caller || '/' || r.org || '=' || r.code, ' ' order by r.caller, r.org), 'none')
     from e1.results r where r.tbl = s.tbl and r.kind = 'insert' and r.code is distinct from '42501'),
  'none',
  s.tbl || ': nobody INSERTS into an organisation without belonging to it (every attempt refused with 42501)'
) from e1.spec s order by s.tbl;

-- the moves: 27 tables, 26 with something to move, both directions
select is(
  (select coalesce(string_agg(r.caller || '/' || r.org || '=' || r.code, ' ' order by r.caller, r.org), 'none')
     from e1.results r
    where r.tbl = s.tbl and r.kind in ('move', 'move_single')
      and r.code not in ('23001', '42501', 'zero')
      and not (r.code = 'P0001' and r.msg ~ '(cannot be moved|must belong|must match)')),
  'none',
  s.tbl || ': a member of both organisations cannot move the row from one to the other, either way (an immutable column, no privilege, no row visible under row-level security, or the tables'' own cross-organisation triggers)'
) from e1.spec s where s.move_stmt is not null order by s.tbl;

select is(
  (select string_agg(r.caller || '/' || r.org || '=' || (r.n > 0)::text, ' ' order by r.caller, r.org)
     from e1.results r where r.tbl = 'live_sessions' and r.kind = 'read_finished'),
  (select string_agg(r.caller || '/' || r.org || '=' || e1.member(r.caller, r.org)::text, ' ' order by r.caller, r.org)
     from e1.results r where r.tbl = 'live_sessions' and r.kind = 'read_finished'),
  'live_sessions: a FINISHED session is visible only to its own organisation''s members (anon and strangers see the active one only)'
);

-- ============ the matrix is not vacuous ============

-- exact row counts, so a missing row can never turn a comparison into NULL = NULL or an empty 'none'
select is((select count(*)::int from e1.results where kind = 'read'),   (select count(*)::int * 10 from e1.spec), 'every table was READ by every caller for both organisations');
select is((select count(*)::int from e1.results where kind = 'update'), (select count(*)::int * 10 from e1.spec), 'every table was UPDATED by every caller for both organisations');
select is((select count(*)::int from e1.results where kind = 'delete'), (select count(*)::int * 6 from e1.spec),  'every table had a DELETE tried by every caller against every organisation they do not belong to');
select is((select count(*)::int from e1.results where kind = 'insert'), (select count(*)::int * 6 from e1.spec),  'and an INSERT of a copy of its rows');
select is((select count(*)::int from e1.results where kind = 'move'),   (select count(*)::int * 2 from e1.spec where move_stmt is not null), 'and every movable row was moved in both directions');
select is((select count(*)::int from e1.results where kind = 'move_single'), (select count(*)::int * 2 from e1.spec where move_stmt is not null), 'and a member of just one organisation tried to move every movable row into the other');
select is(
  (select coalesce(string_agg(r.caller || ' ' || r.tbl || ' ' || r.kind || '/' || r.org, ', '), 'none') from e1.results r where r.n = -1),
  'none',
  'no write statement failed for an unrelated reason (a syntax, type or constraint error would otherwise look like a refusal)'
);
select is((select count(*)::int from e1.results where kind = 'read_finished'), 10, 'and a finished live session was looked for by every caller in both organisations');

select is(
  (select count(*)::int from e1.results where kind = 'read' and n > 0),
  (select count(*)::int from e1.results r where r.kind = 'read' and e1.expect_read(r.caller, r.org, r.tbl)),
  'the matrix saw exactly as many readable rows as it expected (so the zeros above are refusals, not empty tables)'
);
select cmp_ok((select count(*)::int from e1.results where kind = 'read' and n > 0), '>=', 100,
  'and a good number of rows were readable at all (members do see their own rows)');
select cmp_ok((select count(*)::int from e1.results where kind = 'update' and n > 0), '>=', 50,
  'and a good number of own-organisation updates went through (so a refused update is a refusal, not a broken statement)');

-- ============ structure: nothing escapes the matrix ============

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r', 'p', 'f') and not c.relrowsecurity),
  'none',
  'every table in public has row-level security enabled'
);
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r', 'p', 'f')
      and c.relname not in (select tbl from e1.spec)
      and c.relname not in ('contacts', 'guesses', 'sessions')),
  'none',
  'every table in public is in this matrix (or is one of the three Guess the Bean participant tables): a new table must be added to e1.spec, with its fixture rows, before this passes'
);
select is(
  (select coalesce(string_agg(s.tbl, ', ' order by s.tbl), 'none')
     from e1.spec s
    where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relname = s.tbl)),
  'none',
  'and every table the matrix names exists'
);
select is(
  (select coalesce(string_agg(s.tbl, ', ' order by s.tbl), 'none')
     from e1.spec s
    where not exists (
      select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = s.tbl
         and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ '(is_org_member|org_id_for_[a-z_]+)\(')
      and s.tbl not in ('score_change_counts', 'team_removed_members')),
  'none',
  'every table has a policy scoped to the organisation (the two deny-all tables are checked next)'
);
select is(
  (select coalesce(string_agg(t.tbl, ', ' order by t.tbl), 'none')
     from (values ('score_change_counts'), ('team_removed_members')) t(tbl)
    where exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tbl)),
  'none',
  'the two deny-all tables have no policy at all (so no caller can reach a row; they are reached only through definer functions)'
);
-- ...and, where table privileges are narrow (production), no privilege either. In a database that grants every table
-- privilege by default the missing policy above is the whole barrier, and the matrix shows it holds.
select case when has_table_privilege('anon', 'public.ct_heats', 'select')
  then skip(1, 'this database grants anon every table privilege by default; the matrix and the policy check carry it')
  else is(
    (select coalesce(string_agg(t.tbl, ', ' order by t.tbl), 'none')
       from (values ('score_change_counts'), ('team_removed_members')) t(tbl)
      where has_table_privilege('anon', 'public.' || t.tbl, 'select,insert,update,delete')
         or has_table_privilege('authenticated', 'public.' || t.tbl, 'select,insert,update,delete')
         or exists (select 1 from information_schema.column_privileges cp
                     where cp.table_schema = 'public' and cp.table_name = t.tbl and cp.grantee in ('anon', 'authenticated'))),
    'none',
    'where privileges are narrow (production): the two deny-all tables hold no privilege for anon or signed-in callers')
  end;

-- the plan's "immutability" meta-test for tables WITHOUT an org_id column (033 covers the ones that have it): every
-- tenant table must have an enabled BEFORE UPDATE row trigger that freezes its parents or checks them, so a member
-- of two organisations cannot re-point a row even where privileges are broad
select is(
  (select coalesce(string_agg(s.tbl, ', ' order by s.tbl), 'none')
     from e1.spec s
    where not exists (
      select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = ('public.' || s.tbl)::regclass and not t.tgisinternal and t.tgenabled <> 'D'
         and (t.tgtype & 1) > 0 and (t.tgtype & 2) > 0 and (t.tgtype & 16) > 0
         and (p.proname in ('forbid_parent_change', 'forbid_btc_event_change', 'forbid_score_change_log_mutation')
              or p.proname like 'check\_%'))),
  'none',
  'every tenant table has a BEFORE UPDATE trigger that freezes or checks its parents (a new table fails until it has one)'
);

-- the three exempt tables belong to Guess the Bean's participants (a session's creator and the people who guess), not to
-- an organisation: they must carry no organisation column, or the exemption would be hiding tenant data
select is(
  (select coalesce(string_agg(c.relname || '.' || a.attname, ', '), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('org_id', 'event_id')
    where c.relname in ('contacts', 'guesses', 'sessions')),
  'none',
  'the three exempt Guess the Bean tables carry no org_id or event_id column'
);

-- views are not covered by row-level security of their own: each must run with its CALLER's rights, or it would
-- show every organisation's rows (a security_invoker view applies the tables' policies to whoever asks)
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('v', 'm') and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  'none',
  'every view in public is security_invoker (a view without it bypasses the tables'' row-level security)'
);
select cmp_ok((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relkind = 'v'), '>=', 6,
  'and the guard sees the six views known today (zero would mean it matches nothing)');

-- What anon can reach is decided by POLICIES (a database built by a newer CLI gives it every table privilege, so
-- privileges alone say little): the policies that name anon are pinned, and every policy that applies to every
-- role must be tied to the caller (a membership or creator check), so a new `using (true)` cannot slip in.
select is(
  (select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname)
     from pg_policies p where p.schemaname = 'public' and 'anon' = any (p.roles)),
  'contacts.contacts_insert, guesses.guesses_insert, guesses.guesses_select_anon_feed, live_sessions.live_sessions_read, live_sessions.live_sessions_window_lock_anon, public_results.public_results_read_public, sessions.sessions_select',
  'the policies that name anon are exactly: the Guess the Bean participant doors, the active live sessions (and the Per-event window lock on them) and the public archive'
);
select is(
  (select coalesce(string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname), 'none')
     from pg_policies p
    where p.schemaname = 'public' and 'public' = any (p.roles)
      and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) !~ '(is_org_member|org_id_for_[a-z_]+|auth\.uid\(\)|session_is_creator)'),
  'none',
  'every policy that applies to every role (anon included) is tied to the caller by a membership or creator check'
);
-- ...and in a database with the narrow privileges (production, a long-lived local stack) anon holds almost nothing:
-- skipped where a newer CLI granted everything by default (that environment is exactly what the policy pins above are for)
select case when has_table_privilege('anon', 'public.ct_heats', 'select')
  then skip(1, 'this database grants anon every table privilege by default; the policy pins above carry the check')
  else is(
    (select string_agg(x, ', ' order by x) from (
       select table_name || ':' || privilege_type as x from information_schema.table_privileges
        where table_schema = 'public' and grantee = 'anon'
       union
       select table_name || '.' || column_name || ':' || privilege_type from information_schema.column_privileges
        where table_schema = 'public' and grantee = 'anon'
          and table_name not in (select table_name from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon')
     ) q),
    'contacts:INSERT, contacts:SELECT, guesses:INSERT, live_sessions:SELECT, public_results.event_id:SELECT, public_results.id:SELECT, public_results.org_id:SELECT, public_results.payload:SELECT, public_results.published_at:SELECT, sessions.guess_enabled:SELECT, sessions.id:SELECT, sessions.orientation:SELECT, sessions.revealed:SELECT',
    'where privileges are narrow (production): anon holds exactly the public archive columns, the live sessions and the Guess the Bean participant doors')
  end;

select * from finish();
rollback;
