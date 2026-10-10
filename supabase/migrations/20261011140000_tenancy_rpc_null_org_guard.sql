-- Seduh Score Next · T-TEN.B6 (part 2): a NULL org id must not slip past the RPC org checks
--
-- Why: 20261011130000 made the public org resolvers answer NULL for a caller who is not a member
-- of the org. Every RPC that takes p_org_id guards with `p_org_id is distinct from
-- app.org_id_for_x(...)`. Before, a real object resolved to its real org, so a NULL p_org_id was
-- refused. Now a non-member's resolver answer is NULL, and `NULL is distinct from NULL` is false,
-- so the guard PASSES. The RPCs are SECURITY INVOKER, so row-level security still stopped every
-- write in testing, but (security-reviewer, schema-guardian, T-TEN.B6 review):
--   * publish_session(NULL, <event>) answered a non-member differently for an event that exists
--     (a live_sessions trigger error) than for one that does not (an RLS error): an existence
--     oracle for any event id;
--   * delete_test_event / publish_event_results / unpublish_event_results returned success for a
--     non-member passing NULL;
--   * the guard no longer held on its own, which the previous migration's header claims it does.
-- Fix: add `p_org_id is null or` in front of every such check, in all 18 functions that carry
-- one (resolve_stage has two). A NULL org id is now refused with the same message as any wrong
-- org id. The bodies below are the current definitions with that one change.
--
-- APPLY TOGETHER with 20261011130000_tenancy_resolver_disclosure.sql.
--
-- rollback: (restores the exact previous bodies)
--   CREATE OR REPLACE FUNCTION public.auto_max_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_time_edited_at timestamp with time zone)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_duration_secs int;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
--       raise exception 'auto_max_heat: heat % not found', p_heat_id;
--     end if;
--
--     if not exists (select 1 from public.ct_heats where id = p_heat_id) then
--       raise exception 'auto_max_heat: heat % not found', p_heat_id;
--     end if;
--
--     perform 1 from public.ct_heats where id = p_heat_id for update;
--
--     select duration_secs into v_duration_secs from public.ct_heats where id = p_heat_id and status = 'timing';
--
--     if v_duration_secs is not null then
--       update public.ct_heat_entries
--       set elapsed_secs = v_duration_secs,
--           elapsed_secs_raw = v_duration_secs,
--           maxed = true,
--           time_source = 'maxed',
--           time_edited_at = p_time_edited_at
--       where heat_id = p_heat_id and elapsed_secs is null;
--
--       update public.ct_heats set status = 'scoring' where id = p_heat_id and status = 'timing';
--     end if;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'auto_max_heat');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.confirm_btc_match(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_updated_at timestamp with time zone, p_votes jsonb, p_fastest_team_id uuid, p_team1_signature boolean, p_team2_signature boolean, p_team1_time_note text, p_team2_time_note text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_round text;
--     v_updated_at timestamptz;
--     v_cups int;
--     v_judge_count int;
--     v_vote_count int;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
--       raise exception 'confirm_btc_match: match not found';
--     end if;
--
--     select round, updated_at into v_round, v_updated_at
--     from public.btc_matches where id = p_match_id
--     for update;
--
--     if v_round is null then
--       raise exception 'confirm_btc_match: match not found';
--     end if;
--
--     -- Re-check the ledger now that the row is locked (see 20260922091000's own comment
--     -- on this exact re-check for why it must happen after the lock, not just before it).
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if v_updated_at is distinct from p_expected_updated_at then
--       raise exception 'CONFLICT: match % has been modified since it was read', p_match_id
--         using detail = json_build_object(
--                 'match_id', p_match_id,
--                 'current_updated_at', v_updated_at,
--                 'expected_updated_at', p_expected_updated_at
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     if v_round = 'preliminary' and (p_team1_signature or p_team2_signature) then
--       raise exception 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round';
--     end if;
--
--     v_cups := app.btc_cups_for_round(v_round);
--
--     -- Judges are on record for transparency, not tied to individual votes — but the
--     -- match must still carry exactly 3 of them before it can be confirmed.
--     select count(*) into v_judge_count
--     from public.btc_match_judges where match_id = p_match_id;
--     if v_judge_count <> 3 then
--       raise exception 'confirm_btc_match: match must have exactly 3 judges (has %)', v_judge_count;
--     end if;
--
--     if exists (
--       select 1 from jsonb_array_elements(p_votes) v
--       where (v->>'cup_number')::int < 1 or (v->>'cup_number')::int > v_cups
--     ) then
--       raise exception 'confirm_btc_match: cup numbers must be between 1 and % for a % match', v_cups, v_round;
--     end if;
--
--     if exists (
--       select 1 from jsonb_array_elements(p_votes) v
--       where (v->>'team1_tokens')::int < 0 or (v->>'team1_tokens')::int > 3
--     ) then
--       raise exception 'confirm_btc_match: each cup''s tokens must be between 0 and 3';
--     end if;
--
--     delete from public.btc_cup_votes where match_id = p_match_id;
--
--     insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
--     select p_match_id,
--            (v->>'cup_number')::smallint,
--            (v->>'team1_tokens')::smallint
--     from jsonb_array_elements(p_votes) v;
--
--     -- Strict confirm, same shape as before: the unique (match_id, cup_number) constraint
--     -- plus the cup-range check above make "count = cups" equivalent to "every cup 1..cups
--     -- scored exactly once", so a short payload fails with the friendly message, not a
--     -- raw constraint error.
--     select count(*) into v_vote_count from public.btc_cup_votes where match_id = p_match_id;
--     if v_vote_count <> v_cups then
--       raise exception 'confirm_btc_match: % of % cups are missing a score', v_cups - v_vote_count, v_cups;
--     end if;
--
--     insert into public.btc_match_bonuses
--       (match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage)
--     values
--       (p_match_id, p_fastest_team_id, coalesce(p_team1_signature, false), coalesce(p_team2_signature, false))
--     on conflict (match_id) do update
--       set fastest_team_id = excluded.fastest_team_id,
--           team1_signature_beverage = excluded.team1_signature_beverage,
--           team2_signature_beverage = excluded.team2_signature_beverage;
--
--     update public.btc_matches
--     set status = 'confirmed',
--         team1_time_note = nullif(btrim(p_team1_time_note), ''),
--         team2_time_note = nullif(btrim(p_team2_time_note), '')
--     where id = p_match_id;
--
--     insert into public.processed_operations (id, org_id, kind)
--     values (p_operation_id, p_org_id, 'confirm_btc_match');
--
--     perform app.advance_btc_bracket(p_match_id);
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.confirm_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_expected_updated_at timestamp with time zone, p_entries jsonb)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_current_updated_at timestamptz;
--     v_entry jsonb;
--     v_result jsonb;
--     v_entry_id uuid;
--     v_expected_set_count int;
--     v_incomplete_count int;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     -- `is distinct from`, not `<>`: since T-TEN.B6 org_id_for_heat answers NULL for a caller who is
--     -- not a member of the heat's org, and `p_org_id <> NULL` is NULL (not true), which would have let
--     -- a non-member straight past this check. With it, a non-member is refused exactly like a wrong org.
--     if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
--       raise exception 'confirm_heat: heat % does not belong to org %', p_heat_id, p_org_id;
--     end if;
--
--     -- Serialise with correct_heat_time / record_heat_time / auto_max_heat, which all
--     -- lock the heat row first. Without this the updated_at check below is a plain
--     -- read: a correction could commit between that check and the entry writes
--     -- further down, and this confirm would then rewrite the corrected time from
--     -- its (stale) payload. Taking the lock first also gives every writer the same
--     -- lock order (heat, then entries), which removes the deadlock the other order
--     -- allowed.
--     perform 1 from public.ct_heats where id = p_heat_id for update;
--
--     -- A retry of an operation that was still in flight when this call started
--     -- waited on the lock above; it must find the ledger row and stop, not run
--     -- into the updated_at conflict its own earlier success caused.
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     select updated_at into v_current_updated_at from public.ct_heats where id = p_heat_id;
--     if v_current_updated_at is null then
--       raise exception 'confirm_heat: heat % not found', p_heat_id;
--     end if;
--
--     if v_current_updated_at <> p_expected_updated_at then
--       raise exception 'CONFLICT: heat % has been modified since it was read', p_heat_id
--         using detail = json_build_object(
--                 'heat_id', p_heat_id,
--                 'current_updated_at', v_current_updated_at,
--                 'expected_updated_at', p_expected_updated_at
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     for v_entry in select * from jsonb_array_elements(p_entries)
--     loop
--       v_entry_id := (v_entry->>'entry_id')::uuid;
--
--       update public.ct_heat_entries
--       set elapsed_secs = (v_entry->>'elapsed_secs')::int,
--           elapsed_secs_raw = (v_entry->>'elapsed_secs_raw')::int,
--           maxed = coalesce((v_entry->>'maxed')::boolean, false),
--           time_source = coalesce(v_entry->>'time_source', 'tapped')
--       where id = v_entry_id and heat_id = p_heat_id;
--
--       if not found then
--         raise exception 'confirm_heat: heat_entry % not found in heat %', v_entry_id, p_heat_id;
--       end if;
--
--       for v_result in select * from jsonb_array_elements(coalesce(v_entry->'results', '[]'::jsonb))
--       loop
--         insert into public.ct_results (heat_entry_id, set_id, correct)
--         values (v_entry_id, (v_result->>'set_id')::uuid, (v_result->>'correct')::boolean)
--         on conflict (heat_entry_id, set_id) do update set correct = excluded.correct;
--       end loop;
--     end loop;
--
--     select set_count into v_expected_set_count
--     from public.ct_stages
--     join public.ct_heats on ct_heats.stage_id = ct_stages.id
--     where ct_heats.id = p_heat_id;
--
--     select count(*) into v_incomplete_count
--     from public.ct_heat_entries he
--     where he.heat_id = p_heat_id
--       and (select count(*) from public.ct_results r where r.heat_entry_id = he.id) <> v_expected_set_count;
--
--     if v_incomplete_count > 0 then
--       raise exception 'confirm_heat: % cupper(s) do not have every set scored', v_incomplete_count;
--     end if;
--
--     update public.ct_heats set status = 'confirmed' where id = p_heat_id;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'confirm_heat');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.correct_heat_time(p_operation_id uuid, p_org_id uuid, p_heat_entry_id uuid, p_expected_elapsed_secs integer, p_elapsed_secs integer, p_elapsed_secs_raw integer, p_maxed boolean, p_reason text, p_time_edited_at timestamp with time zone)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_heat_id uuid;
--     v_heat_status text;
--     v_current_elapsed int;
--     v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
--     v_duration_secs int;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     -- Same not-found answer for "no such entry" and "not your org's entry", so
--     -- the RPC cannot be used to probe another org's ids.
--     if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
--       raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;
--
--     if v_heat_id is null then
--       raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     if v_reason is null then
--       raise exception 'correct_heat_time: a reason is required';
--     end if;
--     if char_length(v_reason) > 120 then
--       raise exception 'correct_heat_time: the reason is too long (120 characters at most)';
--     end if;
--     if p_elapsed_secs is null or p_elapsed_secs < 0
--        or p_elapsed_secs_raw is null or p_maxed is null then
--       raise exception 'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed';
--     end if;
--
--     perform 1 from public.ct_heats where id = v_heat_id for update;
--
--     -- A retry of an operation that was still in flight when this call started
--     -- waited on the lock above; once it holds the lock it must find the ledger
--     -- row and stop, not trip the compare-and-set its own earlier success caused.
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     select h.status, h.duration_secs, he.elapsed_secs
--       into v_heat_status, v_duration_secs, v_current_elapsed
--     from public.ct_heat_entries he
--     join public.ct_heats h on h.id = he.heat_id
--     where he.id = p_heat_entry_id;
--
--     if v_heat_status not in ('timing', 'scoring') then
--       raise exception 'CONFLICT: heat % is %, its times can no longer be corrected', v_heat_id, v_heat_status
--         using detail = json_build_object(
--                 'heat_id', v_heat_id,
--                 'current_status', v_heat_status
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     if v_current_elapsed is null then
--       raise exception 'correct_heat_time: heat entry % has no recorded time to correct', p_heat_entry_id;
--     end if;
--
--     if v_current_elapsed is distinct from p_expected_elapsed_secs then
--       raise exception 'CONFLICT: heat entry % time is now % seconds, expected % seconds',
--         p_heat_entry_id, v_current_elapsed, p_expected_elapsed_secs
--         using detail = json_build_object(
--                 'heat_entry_id', p_heat_entry_id,
--                 'current_elapsed_secs', v_current_elapsed,
--                 'expected_elapsed_secs', p_expected_elapsed_secs
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     if p_elapsed_secs = v_current_elapsed then
--       raise exception 'correct_heat_time: the corrected time is the same as the recorded time';
--     end if;
--
--     -- Reject-only consistency with clampElapsed's output for this heat (see header).
--     if p_elapsed_secs_raw < p_elapsed_secs then
--       raise exception 'correct_heat_time: elapsed_secs_raw cannot be below elapsed_secs';
--     end if;
--     -- (ct_heats.duration_secs is NOT NULL, so there is always a duration to check.)
--     if p_elapsed_secs > v_duration_secs then
--       raise exception 'correct_heat_time: the corrected time cannot exceed the heat duration (% seconds)', v_duration_secs;
--     end if;
--     if p_maxed is distinct from (p_elapsed_secs = v_duration_secs) then
--       raise exception 'correct_heat_time: maxed must be true exactly when the time equals the heat duration';
--     end if;
--     if not p_maxed and p_elapsed_secs_raw <> p_elapsed_secs then
--       raise exception 'correct_heat_time: elapsed_secs_raw must equal elapsed_secs unless the time is a max';
--     end if;
--
--     -- Transaction-local, read by the score-change log trigger (reason column).
--     perform set_config('app.change_reason', v_reason, true);
--
--     update public.ct_heat_entries
--     set elapsed_secs = p_elapsed_secs,
--         elapsed_secs_raw = p_elapsed_secs_raw,
--         maxed = p_maxed,
--         time_source = 'manual',
--         time_note = v_reason,
--         time_edited_at = coalesce(p_time_edited_at, now())
--     where id = p_heat_entry_id;
--     if not found then
--       raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     -- Cleared straight away: transaction-local, but a later statement in the same
--     -- transaction must not inherit this reason.
--     perform set_config('app.change_reason', '', true);
--
--     -- Makes a stale confirm_heat conflict instead of undoing this correction
--     -- (see the header). app.set_updated_at() owns the value.
--     update public.ct_heats set updated_at = now() where id = v_heat_id;
--     if not found then
--       raise exception 'correct_heat_time: heat % not found', v_heat_id;
--     end if;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'correct_heat_time');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.create_btc_bracket_match(p_org_id uuid, p_slot_id uuid, p_judge_ids uuid[])
--    RETURNS btc_matches
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_slot public.btc_bracket_slots;
--     v_match public.btc_matches;
--     v_judge_id uuid;
--     v_distinct_judge_count int;
--   begin
--     -- Locked: confirm_btc_match's own bracket-advancement step locks this same slot row
--     -- before writing team1_id/team2_id (20260922132000), so the two RPCs serialize
--     -- against each other here rather than racing a check-then-act read against a
--     -- concurrent advancement write.
--     select * into v_slot from public.btc_bracket_slots where id = p_slot_id for update;
--     if v_slot.id is null or p_org_id is distinct from app.org_id_for_event(v_slot.event_id) then
--       raise exception 'create_btc_bracket_match: bracket slot not found';
--     end if;
--
--     if v_slot.team1_id is null or v_slot.team2_id is null then
--       raise exception 'create_btc_bracket_match: both of this slot''s teams must be known first';
--     end if;
--
--     if v_slot.match_id is not null then
--       raise exception 'create_btc_bracket_match: this slot already has a match';
--     end if;
--
--     select count(distinct j) into v_distinct_judge_count from unnest(p_judge_ids) as j;
--     if coalesce(array_length(p_judge_ids, 1), 0) <> 3 or v_distinct_judge_count <> 3 then
--       raise exception 'create_btc_bracket_match: exactly 3 distinct judges are required';
--     end if;
--     if exists (
--       select 1 from unnest(p_judge_ids) as jid
--       where not exists (
--         select 1 from public.btc_judges j where j.id = jid and j.event_id = v_slot.event_id
--       )
--     ) then
--       raise exception 'create_btc_bracket_match: all judges must belong to this event';
--     end if;
--
--     insert into public.btc_matches (event_id, round, team1_id, team2_id)
--     values (v_slot.event_id, v_slot.round, v_slot.team1_id, v_slot.team2_id)
--     returning * into v_match;
--
--     foreach v_judge_id in array p_judge_ids loop
--       insert into public.btc_match_judges (match_id, judge_id) values (v_match.id, v_judge_id);
--     end loop;
--
--     update public.btc_bracket_slots set match_id = v_match.id where id = p_slot_id;
--
--     return v_match;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.delete_test_event(p_org_id uuid, p_event_id uuid)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   begin
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'delete_test_event: event % not found', p_event_id;
--     end if;
--
--     if not (select is_test from public.events where id = p_event_id) then
--       raise exception 'delete_test_event: refusing to delete a non-test event (%)', p_event_id
--         using errcode = 'P0001';
--     end if;
--
--     delete from public.events where id = p_event_id and is_test;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.generate_btc_bracket(p_org_id uuid, p_event_id uuid)
--    RETURNS SETOF btc_bracket_slots
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_seed uuid[8];
--     v_qf uuid[4];
--     v_sf uuid[2];
--   begin
--     -- The explicit membership test (new here, as in record_btc_seeding_tiebreak): org_id_for_event answers for any
--     -- caller, so without it a non-member could confirm that an event belongs to an org from the next refusal, and
--     -- would queue on the advisory lock below before anything stopped them.
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
--       raise exception 'generate_btc_bracket: event not found';
--     end if;
--
--     -- Serializes two near-simultaneous calls for the same event (e.g. a double-click on
--     -- "Generate bracket"): without this, both could pass the "already exists" check below
--     -- before either inserts: the unique (event_id, slot_label) constraint would still stop
--     -- the second insert, but as a raw constraint violation rather than the friendly error
--     -- this function means to give. Released automatically at transaction end.
--     perform pg_advisory_xact_lock(hashtext(p_event_id::text));
--
--     if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
--       raise exception 'generate_btc_bracket: a bracket already exists for this event';
--     end if;
--
--     if exists (
--       select 1 from public.btc_matches
--       where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
--     ) then
--       raise exception 'generate_btc_bracket: every preliminary match must be confirmed first';
--     end if;
--
--     if (select count(*) from public.btc_standings where event_id = p_event_id) < 8 then
--       raise exception 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required';
--     end if;
--
--     -- A tie across the 8th/9th boundary that nobody has ordered is a real "who actually qualified" question
--     -- this function refuses to guess at. The organiser orders the tied teams (record_btc_seeding_tiebreak)
--     -- and retries.
--     if exists (
--       select 1
--       from public.btc_seeding_order r8
--       join public.btc_seeding_order r9 on r9.event_id = r8.event_id and r9.seed = r8.seed + 1
--       where r8.event_id = p_event_id
--         and r8.seed = 8
--         and r8.total_points = r9.total_points
--         and r8.wins = r9.wins
--         and not r8.group_resolved
--     ) then
--       raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
--     end if;
--
--     -- The seed order is btc_seeding_order's. team_id is its final, arbitrary-but-deterministic tiebreak: reached only
--     -- for teams level on points and wins that nobody has ordered and that are NOT across the 8th/9th boundary (which
--     -- the check above refused), so they still get a stable seed order rather than an undefined one.
--     select array_agg(team_id order by seed) into v_seed
--     from public.btc_seeding_order
--     where event_id = p_event_id and seed <= 8;
--
--     insert into public.btc_bracket_slots (event_id, round, slot_label, seed_1, seed_2, team1_id, team2_id)
--     values
--       (p_event_id, 'quarterfinal', 'qf1', 1, 8, v_seed[1], v_seed[8]),
--       (p_event_id, 'quarterfinal', 'qf2', 4, 5, v_seed[4], v_seed[5]),
--       (p_event_id, 'quarterfinal', 'qf3', 3, 6, v_seed[3], v_seed[6]),
--       (p_event_id, 'quarterfinal', 'qf4', 2, 7, v_seed[2], v_seed[7]);
--
--     -- RETURNING INTO can't target a scalar/array across a multi-row INSERT (plpgsql
--     -- raises "query returned more than one row"), so the 4 new ids are re-selected here.
--     select array_agg(id order by slot_label) into v_qf
--     from public.btc_bracket_slots
--     where event_id = p_event_id and slot_label in ('qf1', 'qf2', 'qf3', 'qf4');
--
--     insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
--     values
--       (p_event_id, 'semifinal', 'sf1', v_qf[1], v_qf[2]), -- qf1, qf2
--       (p_event_id, 'semifinal', 'sf2', v_qf[3], v_qf[4]); -- qf3, qf4
--
--     select array_agg(id order by slot_label) into v_sf
--     from public.btc_bracket_slots
--     where event_id = p_event_id and slot_label in ('sf1', 'sf2');
--
--     insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
--     values
--       (p_event_id, 'final', 'final', v_sf[1], v_sf[2]),
--       (p_event_id, 'third_place', 'third_place', v_sf[1], v_sf[2]);
--
--     return query select * from public.btc_bracket_slots where event_id = p_event_id;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.get_dispute_pack(p_org_id uuid, p_event_id uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    STABLE
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_event     jsonb;
--     v_is_test   boolean;
--     v_log       jsonb;
--     v_log_total bigint;
--     v_comp      jsonb;
--     v_btc       jsonb;
--   begin
--     if p_org_id is distinct from app.org_id_for_event(p_event_id)
--        or not app.is_org_member(p_org_id) then
--       raise exception 'get_dispute_pack: event % not found', p_event_id;
--     end if;
--
--     select to_jsonb(e), e.is_test into v_event, v_is_test
--       from public.events e where e.id = p_event_id;
--     if v_event is null then
--       raise exception 'get_dispute_pack: event % not found', p_event_id;
--     end if;
--
--     v_comp := jsonb_build_object(
--       'entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
--                     from public.event_entries x where x.event_id = p_event_id),
--       'stages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinal, x.id), '[]'::jsonb)
--                    from public.ct_stages x where x.event_id = p_event_id),
--       'sets', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.position, x.id), '[]'::jsonb)
--                  from public.ct_sets x join public.ct_stages s on s.id = x.stage_id
--                 where s.event_id = p_event_id),
--       'stage_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.created_at, x.id), '[]'::jsonb)
--                           from public.ct_stage_entries x join public.ct_stages s on s.id = x.stage_id
--                          where s.event_id = p_event_id),
--       'heats', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.heat_number, x.kind, x.id), '[]'::jsonb)
--                   from public.ct_heats x join public.ct_stages s on s.id = x.stage_id
--                  where s.event_id = p_event_id),
--       'heat_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, h.heat_number, h.kind, x.station, x.id), '[]'::jsonb)
--                          from public.ct_heat_entries x
--                          join public.ct_heats h on h.id = x.heat_id
--                          join public.ct_stages s on s.id = h.stage_id
--                         where s.event_id = p_event_id),
--       'results', (select coalesce(jsonb_agg(to_jsonb(r) order by s.ordinal, h.heat_number, h.kind, he.station, st.position, r.id), '[]'::jsonb)
--                     from public.ct_results r
--                     join public.ct_heat_entries he on he.id = r.heat_entry_id
--                     join public.ct_heats h on h.id = he.heat_id
--                     join public.ct_stages s on s.id = h.stage_id
--                     join public.ct_sets st on st.id = r.set_id
--                    where s.event_id = p_event_id)
--     );
--
--     v_btc := jsonb_build_object(
--       'teams', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
--                   from public.btc_teams x where x.event_id = p_event_id),
--       'judges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
--                    from public.btc_judges x where x.event_id = p_event_id),
--       'matches', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
--                     from public.btc_matches x where x.event_id = p_event_id),
--       'match_judges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id, x.judge_id), '[]'::jsonb)
--                          from public.btc_match_judges x join public.btc_matches m on m.id = x.match_id
--                         where m.event_id = p_event_id),
--       'cup_votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id, x.cup_number, x.id), '[]'::jsonb)
--                       from public.btc_cup_votes x join public.btc_matches m on m.id = x.match_id
--                      where m.event_id = p_event_id),
--       'match_bonuses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id), '[]'::jsonb)
--                           from public.btc_match_bonuses x join public.btc_matches m on m.id = x.match_id
--                          where m.event_id = p_event_id),
--       'bracket_slots', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.slot_label, x.id), '[]'::jsonb)
--                           from public.btc_bracket_slots x where x.event_id = p_event_id)
--     );
--
--     select count(*) into v_log_total from public.score_change_log l where l.event_id = p_event_id;
--     select coalesce(jsonb_agg(to_jsonb(l) order by l.changed_at, l.id), '[]'::jsonb) into v_log
--       from (select * from public.score_change_log where event_id = p_event_id
--              order by changed_at, id limit 20000) l;
--
--     return jsonb_build_object(
--       'pack_version', 1,
--       'generated_at', now(),
--       'is_test', v_is_test,
--       'warning', case when v_is_test then 'TEST DATA — NOT A LIVE EVENT' end,
--       'confidentiality',
--         'Contains competitors'' names, cafes and bib numbers and every recorded score. Share it only with the people involved in the dispute.',
--       'about', jsonb_build_array(
--         'Every table below is read in one consistent snapshot at generated_at.',
--         'change_log lists every logged change to a score, time, heat or stage state, or placing (Cup Taster), and to a match, cup vote, bonus or bracket slot (BTC), with old and new values, oldest first. It starts on 2026-09-24: an event scored before then has no history.',
--         'NOT logged: edits to competitors'' names, cafes or bib numbers, withdrawals, and which judges are assigned to a BTC match. The current values of those are in the tables below.',
--         'Any text value in old_value or new_value (for example a time note) is cut to its first 500 characters followed by an ellipsis. The full current text is in the tables below.',
--         'Rehearsal (test) events are not logged, but every change to an event''s rehearsal flag is. An event that was rehearsal and later became real has no history from before that change.',
--         'If change_log_truncated is true, only the oldest 20,000 log rows are included; change_log_total is the true count.',
--         'A stated reason is the organiser''s own text and is not verified. changed_by is a user id; a null changed_by means a change made without a signed-in user (for example directly in the database).',
--         'A change is after_confirm = true when it was made after the heat, match or stage was confirmed or completed.'
--       ),
--       'event', v_event,
--       'cup_taster', v_comp,
--       'btc', v_btc,
--       'change_log', v_log,
--       'change_log_total', v_log_total,
--       'change_log_truncated', v_log_total > 20000,
--       'counts', jsonb_build_object(
--         'entries', jsonb_array_length(v_comp -> 'entries'),
--         'stages', jsonb_array_length(v_comp -> 'stages'),
--         'sets', jsonb_array_length(v_comp -> 'sets'),
--         'stage_entries', jsonb_array_length(v_comp -> 'stage_entries'),
--         'heats', jsonb_array_length(v_comp -> 'heats'),
--         'heat_entries', jsonb_array_length(v_comp -> 'heat_entries'),
--         'results', jsonb_array_length(v_comp -> 'results'),
--         'btc_teams', jsonb_array_length(v_btc -> 'teams'),
--         'btc_judges', jsonb_array_length(v_btc -> 'judges'),
--         'btc_matches', jsonb_array_length(v_btc -> 'matches'),
--         'btc_match_judges', jsonb_array_length(v_btc -> 'match_judges'),
--         'btc_cup_votes', jsonb_array_length(v_btc -> 'cup_votes'),
--         'btc_match_bonuses', jsonb_array_length(v_btc -> 'match_bonuses'),
--         'btc_bracket_slots', jsonb_array_length(v_btc -> 'bracket_slots'),
--         'change_log_rows_in_pack', jsonb_array_length(v_log)
--       )
--     );
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.load_btc_demo(p_org_id uuid, p_event_id uuid, p_scored boolean DEFAULT true)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_format text;
--     v_is_test boolean;
--     v_team_ids uuid[];
--     v_judge_ids uuid[];
--     v_team_names constant text[] := array[
--       'Bean Scene', 'Pour Decisions', 'Crema Crew', 'Drip Society',
--       'Roast Republic', 'Grind House', 'Latte Lab', 'Steam Team'
--     ];
--     v_team_count constant int := array_length(v_team_names, 1);
--     v_judge_count constant int := 5;
--     v_matches int := 0;
--   begin
--     -- Same org check and not-found shape as the other BTC RPCs: for a non-member RLS hides the
--     -- events row below, so "not found" and "not yours" are indistinguishable.
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'load_btc_demo: event not found' using hint = 'demo_event_not_found';
--     end if;
--
--     -- `for update`: held to the end of the transaction, so is_test cannot flip between this check and
--     -- the wipe below, and a second concurrent load of the same event waits instead of colliding on the
--     -- teams' unique (event_id, name). RLS still filters the row first, so a non-member sees nothing.
--     select format, is_test into v_format, v_is_test
--     from public.events where id = p_event_id
--     for update;
--
--     if v_format is null then
--       raise exception 'load_btc_demo: event not found' using hint = 'demo_event_not_found';
--     end if;
--     if v_format <> 'btc' then
--       raise exception 'load_btc_demo: demo data is only available for BTC events' using hint = 'demo_not_btc';
--     end if;
--     if v_is_test is not true then
--       raise exception 'load_btc_demo: demo data can only be loaded into a test event' using hint = 'demo_not_test';
--     end if;
--
--     -- Wipe, children first (the RESTRICT foreign keys: slots -> matches -> teams/judges).
--     delete from public.btc_bracket_slots where event_id = p_event_id;
--     delete from public.btc_matches where event_id = p_event_id;
--     delete from public.btc_judges where event_id = p_event_id;
--     delete from public.btc_teams where event_id = p_event_id;
--
--     v_team_ids := array(select gen_random_uuid() from generate_series(1, v_team_count));
--     v_judge_ids := array(select gen_random_uuid() from generate_series(1, v_judge_count));
--
--     insert into public.btc_teams (id, event_id, name)
--     select v_team_ids[i], p_event_id, v_team_names[i] from generate_series(1, v_team_count) i;
--
--     insert into public.btc_judges (id, event_id, name)
--     select v_judge_ids[i], p_event_id, 'Judge ' || i from generate_series(1, v_judge_count) i;
--
--     if coalesce(p_scored, true) then
--       -- Every pair once, team 1 vs team 2 in roster order.
--       insert into public.btc_matches (event_id, round, team1_id, team2_id, status)
--       select p_event_id, 'preliminary', v_team_ids[a], v_team_ids[b], 'confirmed'
--       from generate_series(1, v_team_count) a, generate_series(1, v_team_count) b
--       where a < b
--       order by a, b;
--
--       -- Three judges per match, rotating through the five by pairing (deterministic, like the rest).
--       insert into public.btc_match_judges (match_id, judge_id)
--       select m.id, v_judge_ids[((ab.a + ab.b + k) % v_judge_count) + 1]
--       from public.btc_matches m
--       cross join lateral (
--         select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
--       ) ab
--       cross join generate_series(0, 2) k
--       where m.event_id = p_event_id;
--
--       -- 15 cups per match. Team 1's tokens (0-3) lean towards the stronger side (lower index =
--       -- stronger): a strength gap of 0.14 tokens per place, a fixed per-match "form on the day"
--       -- offset (so close teams can upset each other: about 3 matches in 28 do), and a per-cup
--       -- wobble (so a stronger team does not take every cup). All three are plain arithmetic on the
--       -- team positions, so the numbers are the same on every load. NB the per-cup term must not
--       -- repeat with a period that divides 15 (5 or 3): 15 cups would be identical blocks and every
--       -- margin a multiple of 3 (an earlier version did exactly that). c * c + 3 * c mod 7 has
--       -- period 7, which does not divide 15, and both team positions feed into it.
--       insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
--       select m.id, c,
--              greatest(0, least(3, round(
--                1.5
--                + (b - a) * 0.14
--                + (((a * 5 + b * 11) % 7) - 3) * 0.12
--                + (((a * 2 + b * 3 + c * c + 3 * c) % 7) - 3) * 0.3
--              )::int))
--       from public.btc_matches m
--       cross join generate_series(1, 15) c
--       cross join lateral (
--         select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
--       ) ab
--       where m.event_id = p_event_id;
--
--       -- One fastest-team bonus per match, alternating by pairing so it is spread across teams.
--       insert into public.btc_match_bonuses (match_id, fastest_team_id)
--       select m.id, case when (a + b) % 2 = 0 then m.team1_id else m.team2_id end
--       from public.btc_matches m
--       cross join lateral (
--         select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
--       ) ab
--       where m.event_id = p_event_id;
--
--       select count(*) into v_matches from public.btc_matches where event_id = p_event_id;
--     end if;
--
--     return jsonb_build_object('teams', v_team_count, 'judges', v_judge_count, 'matches', v_matches);
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.publish_event_results(p_org_id uuid, p_event_id uuid, p_payload jsonb)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   begin
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'publish_event_results: event % not found', p_event_id;
--     end if;
--
--     if (select is_test from public.events where id = p_event_id) then
--       raise exception 'publish_event_results: refusing to publish a test event (%)', p_event_id
--         using errcode = 'P0001';
--     end if;
--
--     -- The is_test condition is repeated here, on the actual write, as its own `where`
--     -- on the insert SOURCE (not just an `on conflict ... where` guard, which would only
--     -- ever protect the update branch, not a first-time insert) — same
--     -- READ-COMMITTED-is-two-statements discipline delete_test_event's own comment
--     -- documents: the guard above and this statement can observe different rows if
--     -- something updates events.is_test in between, even though nothing in this
--     -- codebase does that today.
--     insert into public.public_results (org_id, event_id, payload, published_by)
--     select p_org_id, p_event_id, p_payload, auth.uid()
--     from public.events e
--     where e.id = p_event_id and not e.is_test
--     on conflict (event_id) do update
--       set payload = excluded.payload,
--           published_at = now(),
--           published_by = excluded.published_by;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.publish_session(p_operation_id uuid, p_org_id uuid, p_event_id uuid, p_format text, p_is_test boolean, p_payload jsonb, p_snapshot_at timestamp with time zone DEFAULT now())
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_existing_snapshot_at timestamptz;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'publish_session: event % not found', p_event_id;
--     end if;
--
--     -- Checked BEFORE any mutation, including the deactivate-others step below
--     -- — see this migration's own top comment for the exact regression this
--     -- ordering prevents. `< `, not `<=` — a same-instant snapshot (a genuine
--     -- idempotent retry, or two reads landing in the same millisecond) is
--     -- still allowed through to the normal path below.
--     select snapshot_at into v_existing_snapshot_at
--     from public.live_sessions
--     where event_id = p_event_id;
--
--     if v_existing_snapshot_at is not null and p_snapshot_at < v_existing_snapshot_at then
--       insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
--       return;
--     end if;
--
--     -- Deactivate whatever else is currently active for this org FIRST, THEN
--     -- activate/upsert this event's row — the reverse order (upsert first,
--     -- deactivate others after) would momentarily hold two active rows for the
--     -- same org, tripping live_sessions_one_active_per_org mid-transaction even
--     -- though the FINAL state has none. Includes this same event_id in the
--     -- deactivate sweep (a harmless no-op if it wasn't already active) rather
--     -- than special-casing it, so this one statement is correct whether this
--     -- event is being published for the first time, republished, or is already
--     -- the active one. Safe to run unconditionally here — the staleness check
--     -- above already guarantees the upsert below will actually apply.
--     update public.live_sessions
--     set active = false
--     where org_id = p_org_id and active;
--
--     insert into public.live_sessions (org_id, event_id, format, active, is_test, payload, snapshot_at)
--     values (p_org_id, p_event_id, p_format, true, p_is_test, p_payload, p_snapshot_at)
--     on conflict (event_id) do update
--       set format = excluded.format,
--           active = true,
--           is_test = excluded.is_test,
--           payload = excluded.payload,
--           snapshot_at = excluded.snapshot_at;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.record_btc_seeding_tiebreak(p_org_id uuid, p_event_id uuid, p_team_ids uuid[], p_reason text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
--     v_points int;
--     v_max_points int;
--     v_wins int;
--     v_max_wins int;
--     v_found int;
--     v_group_size int;
--   begin
--     -- Same not-found shape as generate_btc_bracket, plus an explicit membership test: org_id_for_event answers for
--     -- any caller, so without it a non-member would learn "that event is in this org" from the next refusal.
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
--       raise exception 'record_btc_seeding_tiebreak: event not found' using hint = 'seeding_event_not_found';
--     end if;
--
--     -- Serialises with generate_btc_bracket (same key) and with a second recording for the same event.
--     perform pg_advisory_xact_lock(hashtext(p_event_id::text));
--
--     if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
--       raise exception 'record_btc_seeding_tiebreak: the bracket already exists, so the seeds are fixed'
--         using hint = 'seeding_bracket_exists';
--     end if;
--
--     if exists (
--       select 1 from public.btc_matches
--       where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
--     ) then
--       raise exception 'record_btc_seeding_tiebreak: every preliminary match must be confirmed first'
--         using hint = 'seeding_preliminary_open';
--     end if;
--
--     if p_team_ids is null
--        or coalesce(array_length(p_team_ids, 1), 0) < 2
--        or exists (select 1 from unnest(p_team_ids) as x where x is null)
--        or (select count(distinct x) from unnest(p_team_ids) as x) <> array_length(p_team_ids, 1) then
--       raise exception 'record_btc_seeding_tiebreak: name at least two different teams'
--         using hint = 'seeding_group_invalid';
--     end if;
--
--     -- Every named team must have a standing in this event; the numbers they share are the tie being broken.
--     select count(*), min(total_points), max(total_points), min(wins), max(wins)
--       into v_found, v_points, v_max_points, v_wins, v_max_wins
--     from public.btc_seeding_order
--     where event_id = p_event_id and team_id = any (p_team_ids);
--     if v_found <> array_length(p_team_ids, 1) then
--       raise exception 'record_btc_seeding_tiebreak: a named team has no standing in this event'
--         using hint = 'seeding_group_invalid';
--     end if;
--     if v_points <> v_max_points or v_wins <> v_max_wins then
--       raise exception 'record_btc_seeding_tiebreak: those teams are not level on points and wins'
--         using hint = 'seeding_not_tied';
--     end if;
--
--     -- The group must be COMPLETE: every team level with them is named, none left to an arbitrary tail.
--     select count(*)::int into v_group_size
--     from public.btc_seeding_order
--     where event_id = p_event_id and total_points = v_points and wins = v_wins;
--     if v_group_size <> array_length(p_team_ids, 1) then
--       raise exception 'record_btc_seeding_tiebreak: name every team that is level, not some of them'
--         using hint = 'seeding_group_incomplete';
--     end if;
--
--     if v_reason is null then
--       raise exception 'record_btc_seeding_tiebreak: a reason is required' using hint = 'seeding_reason_required';
--     end if;
--     if char_length(v_reason) > 120 then
--       raise exception 'record_btc_seeding_tiebreak: the reason is too long (120 characters at most)'
--         using hint = 'seeding_reason_too_long';
--     end if;
--
--     -- Replace any earlier decision for these teams, and any earlier decision for this very tie.
--     delete from public.btc_seeding_tiebreaks
--     where event_id = p_event_id
--       and (team_id = any (p_team_ids) or (total_points = v_points and wins = v_wins));
--
--     insert into public.btc_seeding_tiebreaks
--       (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
--     select p_event_id, t.team_id, v_points, v_wins, array_length(p_team_ids, 1)::smallint, t.ord::smallint, v_reason
--     from unnest(p_team_ids) with ordinality as t(team_id, ord);
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.record_btc_tiebreak(p_org_id uuid, p_match_id uuid, p_winner_team_id uuid, p_reason text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_round text;
--     v_status text;
--     v_team1_id uuid;
--     v_team2_id uuid;
--     v_team1_total int;
--     v_team2_total int;
--     v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
--   begin
--     -- Same org check and not-found shape as confirm_btc_match: a caller who is not a member sees RLS
--     -- hide the row below, so "not found" and "not yours" are indistinguishable.
--     if p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
--       raise exception 'record_btc_tiebreak: match not found' using hint = 'tiebreak_match_not_found';
--     end if;
--
--     select round, status, team1_id, team2_id into v_round, v_status, v_team1_id, v_team2_id
--     from public.btc_matches where id = p_match_id
--     for update;
--
--     if v_round is null then
--       raise exception 'record_btc_tiebreak: match not found' using hint = 'tiebreak_match_not_found';
--     end if;
--
--     if v_round = 'preliminary' then
--       raise exception 'record_btc_tiebreak: a tie-break applies to knockout matches only';
--     end if;
--     if v_status <> 'confirmed' then
--       raise exception 'record_btc_tiebreak: the match must be confirmed first' using hint = 'tiebreak_unconfirmed';
--     end if;
--
--     select team1_total, team2_total into v_team1_total, v_team2_total
--     from public.btc_match_scores where match_id = p_match_id;
--     if v_team1_total is null or v_team2_total is null then
--       raise exception 'record_btc_tiebreak: no score found for match %', p_match_id;
--     end if;
--     if v_team1_total <> v_team2_total then
--       raise exception 'record_btc_tiebreak: this match is not tied' using hint = 'tiebreak_not_tied';
--     end if;
--
--     if p_winner_team_id is distinct from v_team1_id and p_winner_team_id is distinct from v_team2_id then
--       raise exception 'record_btc_tiebreak: the winner must be one of the match''s two teams';
--     end if;
--
--     if v_reason is null then
--       raise exception 'record_btc_tiebreak: a reason is required';
--     end if;
--     if char_length(v_reason) > 120 then
--       raise exception 'record_btc_tiebreak: the reason is too long (120 characters at most)';
--     end if;
--
--     -- Transaction-local, read by the score-change log trigger (its reason column).
--     perform set_config('app.change_reason', v_reason, true);
--
--     -- Skipped when nothing changes, so re-recording the same decision touches no row.
--     update public.btc_matches
--     set tiebreak_winner_team_id = p_winner_team_id,
--         tiebreak_reason = v_reason
--     where id = p_match_id
--       and (tiebreak_winner_team_id is distinct from p_winner_team_id
--            or tiebreak_reason is distinct from v_reason);
--
--     -- Fills (or, if the winner changed, moves) every seat this match feeds; refused if the
--     -- downstream match already exists with the other team in it.
--     perform app.advance_btc_bracket(p_match_id);
--
--     -- Do not leak this reason into whatever else runs later in the same transaction.
--     perform set_config('app.change_reason', '', true);
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.record_heat_time(p_operation_id uuid, p_org_id uuid, p_heat_entry_id uuid, p_expected_heat_status text, p_elapsed_secs integer, p_elapsed_secs_raw integer, p_maxed boolean, p_time_source text, p_time_edited_at timestamp with time zone, p_conflict_policy text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_heat_id uuid;
--     v_heat_status text;
--     v_already_set boolean;
--     v_current_time_source text;
--     v_current_time_note text;
--   begin
--     if p_conflict_policy not in ('reject', 'overwrite') then
--       raise exception 'record_heat_time: invalid p_conflict_policy %', p_conflict_policy;
--     end if;
--
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
--       raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;
--
--     if v_heat_id is null then
--       raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     perform 1 from public.ct_heats where id = v_heat_id for update;
--
--     -- A retry of an operation that was still in flight when this call started waited on
--     -- the lock above; it must find the ledger row and stop, not re-apply (an 'overwrite'
--     -- would rewrite the row and then fail on the ledger's primary key; a 'reject' would
--     -- report a conflict its own earlier success caused).
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     select h.status, (he.elapsed_secs is not null), he.time_source, he.time_note
--       into v_heat_status, v_already_set, v_current_time_source, v_current_time_note
--     from public.ct_heat_entries he
--     join public.ct_heats h on h.id = he.heat_id
--     where he.id = p_heat_entry_id;
--
--     if v_heat_status <> p_expected_heat_status then
--       raise exception 'CONFLICT: heat % is % now, expected %', v_heat_id, v_heat_status, p_expected_heat_status
--         using detail = json_build_object(
--                 'heat_id', v_heat_id,
--                 'current_status', v_heat_status,
--                 'expected_status', p_expected_heat_status
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     -- 'reject' refuses any already-set entry, unchanged. 'overwrite' now
--     -- refuses too, UNLESS the existing value is itself a prior manual entry
--     -- — the only case 'overwrite' was ever meant to cover. This is what
--     -- closes the tap-then-manual clobber above: a manual save arriving
--     -- after a real tap sees v_current_time_source = 'tapped' and is
--     -- refused, exactly like a genuine double-tap already was.
--     if v_already_set and (
--       p_conflict_policy = 'reject'
--       or (p_conflict_policy = 'overwrite' and v_current_time_source is distinct from 'manual')
--       -- A time with a note was changed by correct_heat_time (20261006100000), which
--       -- sets time_source = 'manual' and records why. Only another correction may
--       -- change it: otherwise a stale manual entry from a second device would
--       -- silently replace the correction, leaving its reason on a time it no longer
--       -- explains.
--       or (p_conflict_policy = 'overwrite' and v_current_time_note is not null)
--     ) then
--       raise exception 'CONFLICT: heat entry % already has a recorded time', p_heat_entry_id
--         using errcode = 'P0002';
--     end if;
--
--     update public.ct_heat_entries
--     set elapsed_secs = p_elapsed_secs,
--         elapsed_secs_raw = p_elapsed_secs_raw,
--         maxed = p_maxed,
--         time_source = p_time_source,
--         time_edited_at = p_time_edited_at
--     where id = p_heat_entry_id;
--
--     if not exists (
--       select 1 from public.ct_heat_entries where heat_id = v_heat_id and elapsed_secs is null
--     ) then
--       update public.ct_heats set status = 'scoring' where id = v_heat_id and status in ('pending', 'timing');
--     end if;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'record_heat_time');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.resolve_stage(p_operation_id uuid, p_org_id uuid, p_stage_id uuid, p_next_stage_id uuid, p_advancing_entries jsonb, p_champion_stage_entry_id uuid, p_eliminated jsonb, p_final_position smallint, p_below_cutoff jsonb, p_coin_toss_note text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_row jsonb;
--     v_entry_id uuid;
--     v_stage_entry_id uuid;
--     v_source text;
--     v_champion_note text;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     -- Two DISTINCT checks per stage id — see 20260906060000_resolve_stage_rpc.sql for why each is needed.
--     if p_org_id is distinct from app.org_id_for_stage(p_stage_id) then
--       raise exception 'resolve_stage: stage % not found', p_stage_id;
--     end if;
--
--     perform 1 from public.ct_stages where id = p_stage_id;
--     if not found then
--       raise exception 'resolve_stage: stage % not found', p_stage_id;
--     end if;
--
--     if p_next_stage_id is not null then
--       if p_org_id is distinct from app.org_id_for_stage(p_next_stage_id) then
--         raise exception 'resolve_stage: next stage % not found', p_next_stage_id;
--       end if;
--
--       perform 1 from public.ct_stages where id = p_next_stage_id;
--       if not found then
--         raise exception 'resolve_stage: next stage % not found', p_next_stage_id;
--       end if;
--     end if;
--
--     if p_next_stage_id is not null then
--       for v_row in select * from jsonb_array_elements(coalesce(p_advancing_entries, '[]'::jsonb))
--       loop
--         v_entry_id := (v_row->>'entry_id')::uuid;
--         v_source := v_row->>'source';
--
--         if not exists (
--           select 1 from public.ct_stage_entries where stage_id = p_stage_id and entry_id = v_entry_id
--         ) then
--           raise exception 'resolve_stage: entry % is not a member of stage %', v_entry_id, p_stage_id;
--         end if;
--
--         insert into public.ct_stage_entries (stage_id, entry_id, source, position_note)
--         values (
--           p_next_stage_id,
--           v_entry_id,
--           v_source,
--           case when v_source = 'coin_toss' then p_coin_toss_note else null end
--         )
--         on conflict (stage_id, entry_id) do nothing;
--       end loop;
--     elsif p_champion_stage_entry_id is not null then
--       select p_coin_toss_note into v_champion_note
--       from jsonb_array_elements(coalesce(p_advancing_entries, '[]'::jsonb)) e
--       where e->>'source' = 'coin_toss'
--       limit 1;
--
--       update public.ct_stage_entries
--       set final_position = 1,
--           position_note = v_champion_note
--       where id = p_champion_stage_entry_id and stage_id = p_stage_id;
--
--       if not found then
--         raise exception 'resolve_stage: champion stage entry % not found in stage %',
--           p_champion_stage_entry_id, p_stage_id;
--       end if;
--     end if;
--
--     for v_row in select * from jsonb_array_elements(coalesce(p_eliminated, '[]'::jsonb))
--     loop
--       v_stage_entry_id := (v_row->>'stage_entry_id')::uuid;
--
--       update public.ct_stage_entries
--       set final_position = p_final_position,
--           position_note = case when (v_row->>'via_coin_toss')::boolean then p_coin_toss_note else null end
--       where id = v_stage_entry_id and stage_id = p_stage_id;
--
--       if not found then
--         raise exception 'resolve_stage: eliminated stage entry % not found in stage %',
--           v_stage_entry_id, p_stage_id;
--       end if;
--     end loop;
--
--     for v_row in select * from jsonb_array_elements(coalesce(p_below_cutoff, '[]'::jsonb))
--     loop
--       v_stage_entry_id := (v_row->>'stage_entry_id')::uuid;
--
--       update public.ct_stage_entries
--       set final_position = (v_row->>'position')::smallint
--       where id = v_stage_entry_id and stage_id = p_stage_id;
--
--       if not found then
--         raise exception 'resolve_stage: below-cutoff stage entry % not found in stage %',
--           v_stage_entry_id, p_stage_id;
--       end if;
--     end loop;
--
--     update public.ct_stages set status = 'complete' where id = p_stage_id;
--
--     -- The event is over once its terminal stage (cutoff is null) is resolved with no next stage.
--     if p_next_stage_id is null then
--       update public.events e
--       set status = 'concluded'
--       from public.ct_stages s
--       where s.id = p_stage_id
--         and s.cutoff is null
--         and e.id = s.event_id
--         and e.status <> 'concluded';
--     end if;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'resolve_stage');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.start_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_started_at timestamp with time zone)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_status text;
--     v_timing_mode text;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
--       raise exception 'start_heat: heat % not found', p_heat_id;
--     end if;
--
--     select status, timing_mode into v_status, v_timing_mode
--     from public.ct_heats where id = p_heat_id;
--     if v_status is null then
--       raise exception 'start_heat: heat % not found', p_heat_id;
--     end if;
--
--     if v_timing_mode <> 'app' then
--       raise exception 'start_heat: heat % is not an app-mode heat', p_heat_id;
--     end if;
--
--     update public.ct_heats
--     set status = 'timing', started_at = p_started_at
--     where id = p_heat_id and status = 'pending';
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'start_heat');
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.unpublish_event_results(p_org_id uuid, p_event_id uuid)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   begin
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'unpublish_event_results: event % not found', p_event_id;
--     end if;
--
--     delete from public.public_results where event_id = p_event_id and org_id = p_org_id;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.update_roster_entry(p_org_id uuid, p_entry_id uuid, p_display_name text, p_phone text, p_email text, p_cafe text, p_bib text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_event_id uuid;
--     v_person_id uuid;
--     v_snap_name text;
--     v_snap_cafe text;
--     v_name text := nullif(btrim(p_display_name), '');
--     v_phone text := nullif(btrim(p_phone), '');
--     v_email text := nullif(btrim(p_email), '');
--     v_cafe text := nullif(btrim(p_cafe), '');
--     v_bib text := nullif(btrim(p_bib), '');
--     v_other_id uuid;
--     v_other_name text;
--   begin
--     -- Read under RLS first: a non-member sees no row at all. Locked here so the person_id read is
--     -- the one the write uses (a concurrent merge_people re-points it under the same row lock).
--     select ee.event_id, ee.person_id, ee.display_name, nullif(btrim(ee.cafe), '')
--       into v_event_id, v_person_id, v_snap_name, v_snap_cafe
--     from public.event_entries ee
--     where ee.id = p_entry_id
--     for update;
--
--     if v_event_id is null or p_org_id is distinct from app.org_id_for_event(v_event_id) then
--       raise exception 'update_roster_entry: entry % not found', p_entry_id;
--     end if;
--
--     if v_name is null then
--       raise exception 'update_roster_entry: a name is required';
--     end if;
--     if char_length(v_name) > 200 or char_length(coalesce(v_cafe, '')) > 200
--        or char_length(coalesce(v_bib, '')) > 50 or char_length(coalesce(v_email, '')) > 254
--        or char_length(coalesce(v_phone, '')) > 32 then
--       raise exception 'update_roster_entry: a value is too long';
--     end if;
--
--     if v_person_id is null then
--       -- A walk-up entry: no profile to carry a phone or email.
--       if v_phone is not null or v_email is not null then
--         raise exception 'update_roster_entry: this entry has no profile, so a phone or email cannot be set';
--       end if;
--     else
--       if v_phone is null then
--         raise exception 'update_roster_entry: a phone number is required';
--       end if;
--
--       -- Serialise two devices editing the same person.
--       perform 1 from public.people where id = v_person_id and org_id = p_org_id for update;
--       if not found then
--         raise exception 'update_roster_entry: entry % not found', p_entry_id;
--       end if;
--
--       select p.id, p.display_name into v_other_id, v_other_name
--       from public.people p
--       where p.org_id = p_org_id and p.phone = v_phone and p.id <> v_person_id;
--       if found then
--         raise exception 'CONFLICT: that phone number already belongs to another person'
--           using detail = json_build_object(
--                   'field', 'phone',
--                   'existing_person_id', v_other_id,
--                   'existing_display_name', v_other_name
--                 )::text,
--                 errcode = 'P0002';
--       end if;
--
--       if v_email is not null then
--         select p.id, p.display_name into v_other_id, v_other_name
--         from public.people p
--         where p.org_id = p_org_id and lower(p.email) = lower(v_email) and p.id <> v_person_id;
--         if found then
--           raise exception 'CONFLICT: that email already belongs to another person'
--             using detail = json_build_object(
--                     'field', 'email',
--                     'existing_person_id', v_other_id,
--                     'existing_display_name', v_other_name
--                   )::text,
--                   errcode = 'P0002';
--         end if;
--       end if;
--
--       begin
--         update public.people
--         set display_name = case when v_name is distinct from v_snap_name then v_name else display_name end,
--             phone = v_phone,
--             email = v_email,
--             cafe = case when v_cafe is distinct from v_snap_cafe then v_cafe else cafe end
--         where id = v_person_id and org_id = p_org_id;
--       exception when unique_violation then
--         -- Lost a race with another device between the checks above and this write.
--         raise exception 'CONFLICT: that phone number or email already belongs to another person'
--           using detail = json_build_object('field', null)::text, errcode = 'P0002';
--       end;
--     end if;
--
--     update public.event_entries
--     set display_name = v_name, cafe = v_cafe, bib = v_bib
--     where id = p_entry_id;
--     if not found then
--       raise exception 'update_roster_entry: entry % not found', p_entry_id;
--     end if;
--   end;
--   $function$;

CREATE OR REPLACE FUNCTION public.auto_max_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_time_edited_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_duration_secs int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is null or p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'auto_max_heat: heat % not found', p_heat_id;
  end if;

  if not exists (select 1 from public.ct_heats where id = p_heat_id) then
    raise exception 'auto_max_heat: heat % not found', p_heat_id;
  end if;

  perform 1 from public.ct_heats where id = p_heat_id for update;

  select duration_secs into v_duration_secs from public.ct_heats where id = p_heat_id and status = 'timing';

  if v_duration_secs is not null then
    update public.ct_heat_entries
    set elapsed_secs = v_duration_secs,
        elapsed_secs_raw = v_duration_secs,
        maxed = true,
        time_source = 'maxed',
        time_edited_at = p_time_edited_at
    where heat_id = p_heat_id and elapsed_secs is null;

    update public.ct_heats set status = 'scoring' where id = p_heat_id and status = 'timing';
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'auto_max_heat');
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_btc_match(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_updated_at timestamp with time zone, p_votes jsonb, p_fastest_team_id uuid, p_team1_signature boolean, p_team2_signature boolean, p_team1_time_note text, p_team2_time_note text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_round text;
  v_updated_at timestamptz;
  v_cups int;
  v_judge_count int;
  v_vote_count int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is null or p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
    raise exception 'confirm_btc_match: match not found';
  end if;

  select round, updated_at into v_round, v_updated_at
  from public.btc_matches where id = p_match_id
  for update;

  if v_round is null then
    raise exception 'confirm_btc_match: match not found';
  end if;

  -- Re-check the ledger now that the row is locked (see 20260922091000's own comment
  -- on this exact re-check for why it must happen after the lock, not just before it).
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'CONFLICT: match % has been modified since it was read', p_match_id
      using detail = json_build_object(
              'match_id', p_match_id,
              'current_updated_at', v_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  if v_round = 'preliminary' and (p_team1_signature or p_team2_signature) then
    raise exception 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round';
  end if;

  v_cups := app.btc_cups_for_round(v_round);

  -- Judges are on record for transparency, not tied to individual votes — but the
  -- match must still carry exactly 3 of them before it can be confirmed.
  select count(*) into v_judge_count
  from public.btc_match_judges where match_id = p_match_id;
  if v_judge_count <> 3 then
    raise exception 'confirm_btc_match: match must have exactly 3 judges (has %)', v_judge_count;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where (v->>'cup_number')::int < 1 or (v->>'cup_number')::int > v_cups
  ) then
    raise exception 'confirm_btc_match: cup numbers must be between 1 and % for a % match', v_cups, v_round;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where (v->>'team1_tokens')::int < 0 or (v->>'team1_tokens')::int > 3
  ) then
    raise exception 'confirm_btc_match: each cup''s tokens must be between 0 and 3';
  end if;

  delete from public.btc_cup_votes where match_id = p_match_id;

  insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
  select p_match_id,
         (v->>'cup_number')::smallint,
         (v->>'team1_tokens')::smallint
  from jsonb_array_elements(p_votes) v;

  -- Strict confirm, same shape as before: the unique (match_id, cup_number) constraint
  -- plus the cup-range check above make "count = cups" equivalent to "every cup 1..cups
  -- scored exactly once", so a short payload fails with the friendly message, not a
  -- raw constraint error.
  select count(*) into v_vote_count from public.btc_cup_votes where match_id = p_match_id;
  if v_vote_count <> v_cups then
    raise exception 'confirm_btc_match: % of % cups are missing a score', v_cups - v_vote_count, v_cups;
  end if;

  insert into public.btc_match_bonuses
    (match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage)
  values
    (p_match_id, p_fastest_team_id, coalesce(p_team1_signature, false), coalesce(p_team2_signature, false))
  on conflict (match_id) do update
    set fastest_team_id = excluded.fastest_team_id,
        team1_signature_beverage = excluded.team1_signature_beverage,
        team2_signature_beverage = excluded.team2_signature_beverage;

  update public.btc_matches
  set status = 'confirmed',
      team1_time_note = nullif(btrim(p_team1_time_note), ''),
      team2_time_note = nullif(btrim(p_team2_time_note), '')
  where id = p_match_id;

  insert into public.processed_operations (id, org_id, kind)
  values (p_operation_id, p_org_id, 'confirm_btc_match');

  perform app.advance_btc_bracket(p_match_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_expected_updated_at timestamp with time zone, p_entries jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_current_updated_at timestamptz;
  v_entry jsonb;
  v_result jsonb;
  v_entry_id uuid;
  v_expected_set_count int;
  v_incomplete_count int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  -- `is distinct from`, not `<>`: since T-TEN.B6 org_id_for_heat answers NULL for a caller who is
  -- not a member of the heat's org, and `p_org_id <> NULL` is NULL (not true), which would have let
  -- a non-member straight past this check. With it, a non-member is refused exactly like a wrong org.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'confirm_heat: heat % does not belong to org %', p_heat_id, p_org_id;
  end if;

  -- Serialise with correct_heat_time / record_heat_time / auto_max_heat, which all
  -- lock the heat row first. Without this the updated_at check below is a plain
  -- read: a correction could commit between that check and the entry writes
  -- further down, and this confirm would then rewrite the corrected time from
  -- its (stale) payload. Taking the lock first also gives every writer the same
  -- lock order (heat, then entries), which removes the deadlock the other order
  -- allowed.
  perform 1 from public.ct_heats where id = p_heat_id for update;

  -- A retry of an operation that was still in flight when this call started
  -- waited on the lock above; it must find the ledger row and stop, not run
  -- into the updated_at conflict its own earlier success caused.
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  select updated_at into v_current_updated_at from public.ct_heats where id = p_heat_id;
  if v_current_updated_at is null then
    raise exception 'confirm_heat: heat % not found', p_heat_id;
  end if;

  if v_current_updated_at <> p_expected_updated_at then
    raise exception 'CONFLICT: heat % has been modified since it was read', p_heat_id
      using detail = json_build_object(
              'heat_id', p_heat_id,
              'current_updated_at', v_current_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_entry_id := (v_entry->>'entry_id')::uuid;

    update public.ct_heat_entries
    set elapsed_secs = (v_entry->>'elapsed_secs')::int,
        elapsed_secs_raw = (v_entry->>'elapsed_secs_raw')::int,
        maxed = coalesce((v_entry->>'maxed')::boolean, false),
        time_source = coalesce(v_entry->>'time_source', 'tapped')
    where id = v_entry_id and heat_id = p_heat_id;

    if not found then
      raise exception 'confirm_heat: heat_entry % not found in heat %', v_entry_id, p_heat_id;
    end if;

    for v_result in select * from jsonb_array_elements(coalesce(v_entry->'results', '[]'::jsonb))
    loop
      insert into public.ct_results (heat_entry_id, set_id, correct)
      values (v_entry_id, (v_result->>'set_id')::uuid, (v_result->>'correct')::boolean)
      on conflict (heat_entry_id, set_id) do update set correct = excluded.correct;
    end loop;
  end loop;

  select set_count into v_expected_set_count
  from public.ct_stages
  join public.ct_heats on ct_heats.stage_id = ct_stages.id
  where ct_heats.id = p_heat_id;

  select count(*) into v_incomplete_count
  from public.ct_heat_entries he
  where he.heat_id = p_heat_id
    and (select count(*) from public.ct_results r where r.heat_entry_id = he.id) <> v_expected_set_count;

  if v_incomplete_count > 0 then
    raise exception 'confirm_heat: % cupper(s) do not have every set scored', v_incomplete_count;
  end if;

  update public.ct_heats set status = 'confirmed' where id = p_heat_id;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'confirm_heat');
end;
$function$;

CREATE OR REPLACE FUNCTION public.correct_heat_time(p_operation_id uuid, p_org_id uuid, p_heat_entry_id uuid, p_expected_elapsed_secs integer, p_elapsed_secs integer, p_elapsed_secs_raw integer, p_maxed boolean, p_reason text, p_time_edited_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_heat_id uuid;
  v_heat_status text;
  v_current_elapsed int;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_duration_secs int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Same not-found answer for "no such entry" and "not your org's entry", so
  -- the RPC cannot be used to probe another org's ids.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
    raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;

  if v_heat_id is null then
    raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  if v_reason is null then
    raise exception 'correct_heat_time: a reason is required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'correct_heat_time: the reason is too long (120 characters at most)';
  end if;
  if p_elapsed_secs is null or p_elapsed_secs < 0
     or p_elapsed_secs_raw is null or p_maxed is null then
    raise exception 'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed';
  end if;

  perform 1 from public.ct_heats where id = v_heat_id for update;

  -- A retry of an operation that was still in flight when this call started
  -- waited on the lock above; once it holds the lock it must find the ledger
  -- row and stop, not trip the compare-and-set its own earlier success caused.
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  select h.status, h.duration_secs, he.elapsed_secs
    into v_heat_status, v_duration_secs, v_current_elapsed
  from public.ct_heat_entries he
  join public.ct_heats h on h.id = he.heat_id
  where he.id = p_heat_entry_id;

  if v_heat_status not in ('timing', 'scoring') then
    raise exception 'CONFLICT: heat % is %, its times can no longer be corrected', v_heat_id, v_heat_status
      using detail = json_build_object(
              'heat_id', v_heat_id,
              'current_status', v_heat_status
            )::text,
            errcode = 'P0002';
  end if;

  if v_current_elapsed is null then
    raise exception 'correct_heat_time: heat entry % has no recorded time to correct', p_heat_entry_id;
  end if;

  if v_current_elapsed is distinct from p_expected_elapsed_secs then
    raise exception 'CONFLICT: heat entry % time is now % seconds, expected % seconds',
      p_heat_entry_id, v_current_elapsed, p_expected_elapsed_secs
      using detail = json_build_object(
              'heat_entry_id', p_heat_entry_id,
              'current_elapsed_secs', v_current_elapsed,
              'expected_elapsed_secs', p_expected_elapsed_secs
            )::text,
            errcode = 'P0002';
  end if;

  if p_elapsed_secs = v_current_elapsed then
    raise exception 'correct_heat_time: the corrected time is the same as the recorded time';
  end if;

  -- Reject-only consistency with clampElapsed's output for this heat (see header).
  if p_elapsed_secs_raw < p_elapsed_secs then
    raise exception 'correct_heat_time: elapsed_secs_raw cannot be below elapsed_secs';
  end if;
  -- (ct_heats.duration_secs is NOT NULL, so there is always a duration to check.)
  if p_elapsed_secs > v_duration_secs then
    raise exception 'correct_heat_time: the corrected time cannot exceed the heat duration (% seconds)', v_duration_secs;
  end if;
  if p_maxed is distinct from (p_elapsed_secs = v_duration_secs) then
    raise exception 'correct_heat_time: maxed must be true exactly when the time equals the heat duration';
  end if;
  if not p_maxed and p_elapsed_secs_raw <> p_elapsed_secs then
    raise exception 'correct_heat_time: elapsed_secs_raw must equal elapsed_secs unless the time is a max';
  end if;

  -- Transaction-local, read by the score-change log trigger (reason column).
  perform set_config('app.change_reason', v_reason, true);

  update public.ct_heat_entries
  set elapsed_secs = p_elapsed_secs,
      elapsed_secs_raw = p_elapsed_secs_raw,
      maxed = p_maxed,
      time_source = 'manual',
      time_note = v_reason,
      time_edited_at = coalesce(p_time_edited_at, now())
  where id = p_heat_entry_id;
  if not found then
    raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  -- Cleared straight away: transaction-local, but a later statement in the same
  -- transaction must not inherit this reason.
  perform set_config('app.change_reason', '', true);

  -- Makes a stale confirm_heat conflict instead of undoing this correction
  -- (see the header). app.set_updated_at() owns the value.
  update public.ct_heats set updated_at = now() where id = v_heat_id;
  if not found then
    raise exception 'correct_heat_time: heat % not found', v_heat_id;
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'correct_heat_time');
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_btc_bracket_match(p_org_id uuid, p_slot_id uuid, p_judge_ids uuid[])
 RETURNS btc_matches
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_slot public.btc_bracket_slots;
  v_match public.btc_matches;
  v_judge_id uuid;
  v_distinct_judge_count int;
begin
  -- Locked: confirm_btc_match's own bracket-advancement step locks this same slot row
  -- before writing team1_id/team2_id (20260922132000), so the two RPCs serialize
  -- against each other here rather than racing a check-then-act read against a
  -- concurrent advancement write.
  select * into v_slot from public.btc_bracket_slots where id = p_slot_id for update;
  if v_slot.id is null or p_org_id is null or p_org_id is distinct from app.org_id_for_event(v_slot.event_id) then
    raise exception 'create_btc_bracket_match: bracket slot not found';
  end if;

  if v_slot.team1_id is null or v_slot.team2_id is null then
    raise exception 'create_btc_bracket_match: both of this slot''s teams must be known first';
  end if;

  if v_slot.match_id is not null then
    raise exception 'create_btc_bracket_match: this slot already has a match';
  end if;

  select count(distinct j) into v_distinct_judge_count from unnest(p_judge_ids) as j;
  if coalesce(array_length(p_judge_ids, 1), 0) <> 3 or v_distinct_judge_count <> 3 then
    raise exception 'create_btc_bracket_match: exactly 3 distinct judges are required';
  end if;
  if exists (
    select 1 from unnest(p_judge_ids) as jid
    where not exists (
      select 1 from public.btc_judges j where j.id = jid and j.event_id = v_slot.event_id
    )
  ) then
    raise exception 'create_btc_bracket_match: all judges must belong to this event';
  end if;

  insert into public.btc_matches (event_id, round, team1_id, team2_id)
  values (v_slot.event_id, v_slot.round, v_slot.team1_id, v_slot.team2_id)
  returning * into v_match;

  foreach v_judge_id in array p_judge_ids loop
    insert into public.btc_match_judges (match_id, judge_id) values (v_match.id, v_judge_id);
  end loop;

  update public.btc_bracket_slots set match_id = v_match.id where id = p_slot_id;

  return v_match;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_test_event(p_org_id uuid, p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'delete_test_event: event % not found', p_event_id;
  end if;

  if not (select is_test from public.events where id = p_event_id) then
    raise exception 'delete_test_event: refusing to delete a non-test event (%)', p_event_id
      using errcode = 'P0001';
  end if;

  delete from public.events where id = p_event_id and is_test;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_btc_bracket(p_org_id uuid, p_event_id uuid)
 RETURNS SETOF btc_bracket_slots
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_seed uuid[8];
  v_qf uuid[4];
  v_sf uuid[2];
begin
  -- The explicit membership test (new here, as in record_btc_seeding_tiebreak): org_id_for_event answers for any
  -- caller, so without it a non-member could confirm that an event belongs to an org from the next refusal, and
  -- would queue on the advisory lock below before anything stopped them.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'generate_btc_bracket: event not found';
  end if;

  -- Serializes two near-simultaneous calls for the same event (e.g. a double-click on
  -- "Generate bracket"): without this, both could pass the "already exists" check below
  -- before either inserts: the unique (event_id, slot_label) constraint would still stop
  -- the second insert, but as a raw constraint violation rather than the friendly error
  -- this function means to give. Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'generate_btc_bracket: a bracket already exists for this event';
  end if;

  if exists (
    select 1 from public.btc_matches
    where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
  ) then
    raise exception 'generate_btc_bracket: every preliminary match must be confirmed first';
  end if;

  if (select count(*) from public.btc_standings where event_id = p_event_id) < 8 then
    raise exception 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required';
  end if;

  -- A tie across the 8th/9th boundary that nobody has ordered is a real "who actually qualified" question
  -- this function refuses to guess at. The organiser orders the tied teams (record_btc_seeding_tiebreak)
  -- and retries.
  if exists (
    select 1
    from public.btc_seeding_order r8
    join public.btc_seeding_order r9 on r9.event_id = r8.event_id and r9.seed = r8.seed + 1
    where r8.event_id = p_event_id
      and r8.seed = 8
      and r8.total_points = r9.total_points
      and r8.wins = r9.wins
      and not r8.group_resolved
  ) then
    raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
  end if;

  -- The seed order is btc_seeding_order's. team_id is its final, arbitrary-but-deterministic tiebreak: reached only
  -- for teams level on points and wins that nobody has ordered and that are NOT across the 8th/9th boundary (which
  -- the check above refused), so they still get a stable seed order rather than an undefined one.
  select array_agg(team_id order by seed) into v_seed
  from public.btc_seeding_order
  where event_id = p_event_id and seed <= 8;

  insert into public.btc_bracket_slots (event_id, round, slot_label, seed_1, seed_2, team1_id, team2_id)
  values
    (p_event_id, 'quarterfinal', 'qf1', 1, 8, v_seed[1], v_seed[8]),
    (p_event_id, 'quarterfinal', 'qf2', 4, 5, v_seed[4], v_seed[5]),
    (p_event_id, 'quarterfinal', 'qf3', 3, 6, v_seed[3], v_seed[6]),
    (p_event_id, 'quarterfinal', 'qf4', 2, 7, v_seed[2], v_seed[7]);

  -- RETURNING INTO can't target a scalar/array across a multi-row INSERT (plpgsql
  -- raises "query returned more than one row"), so the 4 new ids are re-selected here.
  select array_agg(id order by slot_label) into v_qf
  from public.btc_bracket_slots
  where event_id = p_event_id and slot_label in ('qf1', 'qf2', 'qf3', 'qf4');

  insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
  values
    (p_event_id, 'semifinal', 'sf1', v_qf[1], v_qf[2]), -- qf1, qf2
    (p_event_id, 'semifinal', 'sf2', v_qf[3], v_qf[4]); -- qf3, qf4

  select array_agg(id order by slot_label) into v_sf
  from public.btc_bracket_slots
  where event_id = p_event_id and slot_label in ('sf1', 'sf2');

  insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
  values
    (p_event_id, 'final', 'final', v_sf[1], v_sf[2]),
    (p_event_id, 'third_place', 'third_place', v_sf[1], v_sf[2]);

  return query select * from public.btc_bracket_slots where event_id = p_event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_dispute_pack(p_org_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_event     jsonb;
  v_is_test   boolean;
  v_log       jsonb;
  v_log_total bigint;
  v_comp      jsonb;
  v_btc       jsonb;
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id)
     or not app.is_org_member(p_org_id) then
    raise exception 'get_dispute_pack: event % not found', p_event_id;
  end if;

  select to_jsonb(e), e.is_test into v_event, v_is_test
    from public.events e where e.id = p_event_id;
  if v_event is null then
    raise exception 'get_dispute_pack: event % not found', p_event_id;
  end if;

  v_comp := jsonb_build_object(
    'entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                  from public.event_entries x where x.event_id = p_event_id),
    'stages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinal, x.id), '[]'::jsonb)
                 from public.ct_stages x where x.event_id = p_event_id),
    'sets', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.position, x.id), '[]'::jsonb)
               from public.ct_sets x join public.ct_stages s on s.id = x.stage_id
              where s.event_id = p_event_id),
    'stage_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.created_at, x.id), '[]'::jsonb)
                        from public.ct_stage_entries x join public.ct_stages s on s.id = x.stage_id
                       where s.event_id = p_event_id),
    'heats', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.heat_number, x.kind, x.id), '[]'::jsonb)
                from public.ct_heats x join public.ct_stages s on s.id = x.stage_id
               where s.event_id = p_event_id),
    'heat_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, h.heat_number, h.kind, x.station, x.id), '[]'::jsonb)
                       from public.ct_heat_entries x
                       join public.ct_heats h on h.id = x.heat_id
                       join public.ct_stages s on s.id = h.stage_id
                      where s.event_id = p_event_id),
    'results', (select coalesce(jsonb_agg(to_jsonb(r) order by s.ordinal, h.heat_number, h.kind, he.station, st.position, r.id), '[]'::jsonb)
                  from public.ct_results r
                  join public.ct_heat_entries he on he.id = r.heat_entry_id
                  join public.ct_heats h on h.id = he.heat_id
                  join public.ct_stages s on s.id = h.stage_id
                  join public.ct_sets st on st.id = r.set_id
                 where s.event_id = p_event_id)
  );

  v_btc := jsonb_build_object(
    'teams', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                from public.btc_teams x where x.event_id = p_event_id),
    'judges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                 from public.btc_judges x where x.event_id = p_event_id),
    'matches', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                  from public.btc_matches x where x.event_id = p_event_id),
    'match_judges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id, x.judge_id), '[]'::jsonb)
                       from public.btc_match_judges x join public.btc_matches m on m.id = x.match_id
                      where m.event_id = p_event_id),
    'cup_votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id, x.cup_number, x.id), '[]'::jsonb)
                    from public.btc_cup_votes x join public.btc_matches m on m.id = x.match_id
                   where m.event_id = p_event_id),
    'match_bonuses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id), '[]'::jsonb)
                        from public.btc_match_bonuses x join public.btc_matches m on m.id = x.match_id
                       where m.event_id = p_event_id),
    'bracket_slots', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.slot_label, x.id), '[]'::jsonb)
                        from public.btc_bracket_slots x where x.event_id = p_event_id)
  );

  select count(*) into v_log_total from public.score_change_log l where l.event_id = p_event_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.changed_at, l.id), '[]'::jsonb) into v_log
    from (select * from public.score_change_log where event_id = p_event_id
           order by changed_at, id limit 20000) l;

  return jsonb_build_object(
    'pack_version', 1,
    'generated_at', now(),
    'is_test', v_is_test,
    'warning', case when v_is_test then 'TEST DATA — NOT A LIVE EVENT' end,
    'confidentiality',
      'Contains competitors'' names, cafes and bib numbers and every recorded score. Share it only with the people involved in the dispute.',
    'about', jsonb_build_array(
      'Every table below is read in one consistent snapshot at generated_at.',
      'change_log lists every logged change to a score, time, heat or stage state, or placing (Cup Taster), and to a match, cup vote, bonus or bracket slot (BTC), with old and new values, oldest first. It starts on 2026-09-24: an event scored before then has no history.',
      'NOT logged: edits to competitors'' names, cafes or bib numbers, withdrawals, and which judges are assigned to a BTC match. The current values of those are in the tables below.',
      'Any text value in old_value or new_value (for example a time note) is cut to its first 500 characters followed by an ellipsis. The full current text is in the tables below.',
      'Rehearsal (test) events are not logged, but every change to an event''s rehearsal flag is. An event that was rehearsal and later became real has no history from before that change.',
      'If change_log_truncated is true, only the oldest 20,000 log rows are included; change_log_total is the true count.',
      'A stated reason is the organiser''s own text and is not verified. changed_by is a user id; a null changed_by means a change made without a signed-in user (for example directly in the database).',
      'A change is after_confirm = true when it was made after the heat, match or stage was confirmed or completed.'
    ),
    'event', v_event,
    'cup_taster', v_comp,
    'btc', v_btc,
    'change_log', v_log,
    'change_log_total', v_log_total,
    'change_log_truncated', v_log_total > 20000,
    'counts', jsonb_build_object(
      'entries', jsonb_array_length(v_comp -> 'entries'),
      'stages', jsonb_array_length(v_comp -> 'stages'),
      'sets', jsonb_array_length(v_comp -> 'sets'),
      'stage_entries', jsonb_array_length(v_comp -> 'stage_entries'),
      'heats', jsonb_array_length(v_comp -> 'heats'),
      'heat_entries', jsonb_array_length(v_comp -> 'heat_entries'),
      'results', jsonb_array_length(v_comp -> 'results'),
      'btc_teams', jsonb_array_length(v_btc -> 'teams'),
      'btc_judges', jsonb_array_length(v_btc -> 'judges'),
      'btc_matches', jsonb_array_length(v_btc -> 'matches'),
      'btc_match_judges', jsonb_array_length(v_btc -> 'match_judges'),
      'btc_cup_votes', jsonb_array_length(v_btc -> 'cup_votes'),
      'btc_match_bonuses', jsonb_array_length(v_btc -> 'match_bonuses'),
      'btc_bracket_slots', jsonb_array_length(v_btc -> 'bracket_slots'),
      'change_log_rows_in_pack', jsonb_array_length(v_log)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.load_btc_demo(p_org_id uuid, p_event_id uuid, p_scored boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_format text;
  v_is_test boolean;
  v_team_ids uuid[];
  v_judge_ids uuid[];
  v_team_names constant text[] := array[
    'Bean Scene', 'Pour Decisions', 'Crema Crew', 'Drip Society',
    'Roast Republic', 'Grind House', 'Latte Lab', 'Steam Team'
  ];
  v_team_count constant int := array_length(v_team_names, 1);
  v_judge_count constant int := 5;
  v_matches int := 0;
begin
  -- Same org check and not-found shape as the other BTC RPCs: for a non-member RLS hides the
  -- events row below, so "not found" and "not yours" are indistinguishable.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'load_btc_demo: event not found' using hint = 'demo_event_not_found';
  end if;

  -- `for update`: held to the end of the transaction, so is_test cannot flip between this check and
  -- the wipe below, and a second concurrent load of the same event waits instead of colliding on the
  -- teams' unique (event_id, name). RLS still filters the row first, so a non-member sees nothing.
  select format, is_test into v_format, v_is_test
  from public.events where id = p_event_id
  for update;

  if v_format is null then
    raise exception 'load_btc_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  if v_format <> 'btc' then
    raise exception 'load_btc_demo: demo data is only available for BTC events' using hint = 'demo_not_btc';
  end if;
  if v_is_test is not true then
    raise exception 'load_btc_demo: demo data can only be loaded into a test event' using hint = 'demo_not_test';
  end if;

  -- Wipe, children first (the RESTRICT foreign keys: slots -> matches -> teams/judges).
  delete from public.btc_bracket_slots where event_id = p_event_id;
  delete from public.btc_matches where event_id = p_event_id;
  delete from public.btc_judges where event_id = p_event_id;
  delete from public.btc_teams where event_id = p_event_id;

  v_team_ids := array(select gen_random_uuid() from generate_series(1, v_team_count));
  v_judge_ids := array(select gen_random_uuid() from generate_series(1, v_judge_count));

  insert into public.btc_teams (id, event_id, name)
  select v_team_ids[i], p_event_id, v_team_names[i] from generate_series(1, v_team_count) i;

  insert into public.btc_judges (id, event_id, name)
  select v_judge_ids[i], p_event_id, 'Judge ' || i from generate_series(1, v_judge_count) i;

  if coalesce(p_scored, true) then
    -- Every pair once, team 1 vs team 2 in roster order.
    insert into public.btc_matches (event_id, round, team1_id, team2_id, status)
    select p_event_id, 'preliminary', v_team_ids[a], v_team_ids[b], 'confirmed'
    from generate_series(1, v_team_count) a, generate_series(1, v_team_count) b
    where a < b
    order by a, b;

    -- Three judges per match, rotating through the five by pairing (deterministic, like the rest).
    insert into public.btc_match_judges (match_id, judge_id)
    select m.id, v_judge_ids[((ab.a + ab.b + k) % v_judge_count) + 1]
    from public.btc_matches m
    cross join lateral (
      select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
    ) ab
    cross join generate_series(0, 2) k
    where m.event_id = p_event_id;

    -- 15 cups per match. Team 1's tokens (0-3) lean towards the stronger side (lower index =
    -- stronger): a strength gap of 0.14 tokens per place, a fixed per-match "form on the day"
    -- offset (so close teams can upset each other: about 3 matches in 28 do), and a per-cup
    -- wobble (so a stronger team does not take every cup). All three are plain arithmetic on the
    -- team positions, so the numbers are the same on every load. NB the per-cup term must not
    -- repeat with a period that divides 15 (5 or 3): 15 cups would be identical blocks and every
    -- margin a multiple of 3 (an earlier version did exactly that). c * c + 3 * c mod 7 has
    -- period 7, which does not divide 15, and both team positions feed into it.
    insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
    select m.id, c,
           greatest(0, least(3, round(
             1.5
             + (b - a) * 0.14
             + (((a * 5 + b * 11) % 7) - 3) * 0.12
             + (((a * 2 + b * 3 + c * c + 3 * c) % 7) - 3) * 0.3
           )::int))
    from public.btc_matches m
    cross join generate_series(1, 15) c
    cross join lateral (
      select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
    ) ab
    where m.event_id = p_event_id;

    -- One fastest-team bonus per match, alternating by pairing so it is spread across teams.
    insert into public.btc_match_bonuses (match_id, fastest_team_id)
    select m.id, case when (a + b) % 2 = 0 then m.team1_id else m.team2_id end
    from public.btc_matches m
    cross join lateral (
      select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
    ) ab
    where m.event_id = p_event_id;

    select count(*) into v_matches from public.btc_matches where event_id = p_event_id;
  end if;

  return jsonb_build_object('teams', v_team_count, 'judges', v_judge_count, 'matches', v_matches);
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_event_results(p_org_id uuid, p_event_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_event_results: event % not found', p_event_id;
  end if;

  if (select is_test from public.events where id = p_event_id) then
    raise exception 'publish_event_results: refusing to publish a test event (%)', p_event_id
      using errcode = 'P0001';
  end if;

  -- The is_test condition is repeated here, on the actual write, as its own `where`
  -- on the insert SOURCE (not just an `on conflict ... where` guard, which would only
  -- ever protect the update branch, not a first-time insert) — same
  -- READ-COMMITTED-is-two-statements discipline delete_test_event's own comment
  -- documents: the guard above and this statement can observe different rows if
  -- something updates events.is_test in between, even though nothing in this
  -- codebase does that today.
  insert into public.public_results (org_id, event_id, payload, published_by)
  select p_org_id, p_event_id, p_payload, auth.uid()
  from public.events e
  where e.id = p_event_id and not e.is_test
  on conflict (event_id) do update
    set payload = excluded.payload,
        published_at = now(),
        published_by = excluded.published_by;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_session(p_operation_id uuid, p_org_id uuid, p_event_id uuid, p_format text, p_is_test boolean, p_payload jsonb, p_snapshot_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_existing_snapshot_at timestamptz;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_session: event % not found', p_event_id;
  end if;

  -- Checked BEFORE any mutation, including the deactivate-others step below
  -- — see this migration's own top comment for the exact regression this
  -- ordering prevents. `< `, not `<=` — a same-instant snapshot (a genuine
  -- idempotent retry, or two reads landing in the same millisecond) is
  -- still allowed through to the normal path below.
  select snapshot_at into v_existing_snapshot_at
  from public.live_sessions
  where event_id = p_event_id;

  if v_existing_snapshot_at is not null and p_snapshot_at < v_existing_snapshot_at then
    insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
    return;
  end if;

  -- Deactivate whatever else is currently active for this org FIRST, THEN
  -- activate/upsert this event's row — the reverse order (upsert first,
  -- deactivate others after) would momentarily hold two active rows for the
  -- same org, tripping live_sessions_one_active_per_org mid-transaction even
  -- though the FINAL state has none. Includes this same event_id in the
  -- deactivate sweep (a harmless no-op if it wasn't already active) rather
  -- than special-casing it, so this one statement is correct whether this
  -- event is being published for the first time, republished, or is already
  -- the active one. Safe to run unconditionally here — the staleness check
  -- above already guarantees the upsert below will actually apply.
  update public.live_sessions
  set active = false
  where org_id = p_org_id and active;

  insert into public.live_sessions (org_id, event_id, format, active, is_test, payload, snapshot_at)
  values (p_org_id, p_event_id, p_format, true, p_is_test, p_payload, p_snapshot_at)
  on conflict (event_id) do update
    set format = excluded.format,
        active = true,
        is_test = excluded.is_test,
        payload = excluded.payload,
        snapshot_at = excluded.snapshot_at;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_btc_seeding_tiebreak(p_org_id uuid, p_event_id uuid, p_team_ids uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_points int;
  v_max_points int;
  v_wins int;
  v_max_wins int;
  v_found int;
  v_group_size int;
begin
  -- Same not-found shape as generate_btc_bracket, plus an explicit membership test: org_id_for_event answers for
  -- any caller, so without it a non-member would learn "that event is in this org" from the next refusal.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'record_btc_seeding_tiebreak: event not found' using hint = 'seeding_event_not_found';
  end if;

  -- Serialises with generate_btc_bracket (same key) and with a second recording for the same event.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'record_btc_seeding_tiebreak: the bracket already exists, so the seeds are fixed'
      using hint = 'seeding_bracket_exists';
  end if;

  if exists (
    select 1 from public.btc_matches
    where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
  ) then
    raise exception 'record_btc_seeding_tiebreak: every preliminary match must be confirmed first'
      using hint = 'seeding_preliminary_open';
  end if;

  if p_team_ids is null
     or coalesce(array_length(p_team_ids, 1), 0) < 2
     or exists (select 1 from unnest(p_team_ids) as x where x is null)
     or (select count(distinct x) from unnest(p_team_ids) as x) <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: name at least two different teams'
      using hint = 'seeding_group_invalid';
  end if;

  -- Every named team must have a standing in this event; the numbers they share are the tie being broken.
  select count(*), min(total_points), max(total_points), min(wins), max(wins)
    into v_found, v_points, v_max_points, v_wins, v_max_wins
  from public.btc_seeding_order
  where event_id = p_event_id and team_id = any (p_team_ids);
  if v_found <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: a named team has no standing in this event'
      using hint = 'seeding_group_invalid';
  end if;
  if v_points <> v_max_points or v_wins <> v_max_wins then
    raise exception 'record_btc_seeding_tiebreak: those teams are not level on points and wins'
      using hint = 'seeding_not_tied';
  end if;

  -- The group must be COMPLETE: every team level with them is named, none left to an arbitrary tail.
  select count(*)::int into v_group_size
  from public.btc_seeding_order
  where event_id = p_event_id and total_points = v_points and wins = v_wins;
  if v_group_size <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: name every team that is level, not some of them'
      using hint = 'seeding_group_incomplete';
  end if;

  if v_reason is null then
    raise exception 'record_btc_seeding_tiebreak: a reason is required' using hint = 'seeding_reason_required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'record_btc_seeding_tiebreak: the reason is too long (120 characters at most)'
      using hint = 'seeding_reason_too_long';
  end if;

  -- Replace any earlier decision for these teams, and any earlier decision for this very tie.
  delete from public.btc_seeding_tiebreaks
  where event_id = p_event_id
    and (team_id = any (p_team_ids) or (total_points = v_points and wins = v_wins));

  insert into public.btc_seeding_tiebreaks
    (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
  select p_event_id, t.team_id, v_points, v_wins, array_length(p_team_ids, 1)::smallint, t.ord::smallint, v_reason
  from unnest(p_team_ids) with ordinality as t(team_id, ord);
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_btc_tiebreak(p_org_id uuid, p_match_id uuid, p_winner_team_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_round text;
  v_status text;
  v_team1_id uuid;
  v_team2_id uuid;
  v_team1_total int;
  v_team2_total int;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
begin
  -- Same org check and not-found shape as confirm_btc_match: a caller who is not a member sees RLS
  -- hide the row below, so "not found" and "not yours" are indistinguishable.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
    raise exception 'record_btc_tiebreak: match not found' using hint = 'tiebreak_match_not_found';
  end if;

  select round, status, team1_id, team2_id into v_round, v_status, v_team1_id, v_team2_id
  from public.btc_matches where id = p_match_id
  for update;

  if v_round is null then
    raise exception 'record_btc_tiebreak: match not found' using hint = 'tiebreak_match_not_found';
  end if;

  if v_round = 'preliminary' then
    raise exception 'record_btc_tiebreak: a tie-break applies to knockout matches only';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'record_btc_tiebreak: the match must be confirmed first' using hint = 'tiebreak_unconfirmed';
  end if;

  select team1_total, team2_total into v_team1_total, v_team2_total
  from public.btc_match_scores where match_id = p_match_id;
  if v_team1_total is null or v_team2_total is null then
    raise exception 'record_btc_tiebreak: no score found for match %', p_match_id;
  end if;
  if v_team1_total <> v_team2_total then
    raise exception 'record_btc_tiebreak: this match is not tied' using hint = 'tiebreak_not_tied';
  end if;

  if p_winner_team_id is distinct from v_team1_id and p_winner_team_id is distinct from v_team2_id then
    raise exception 'record_btc_tiebreak: the winner must be one of the match''s two teams';
  end if;

  if v_reason is null then
    raise exception 'record_btc_tiebreak: a reason is required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'record_btc_tiebreak: the reason is too long (120 characters at most)';
  end if;

  -- Transaction-local, read by the score-change log trigger (its reason column).
  perform set_config('app.change_reason', v_reason, true);

  -- Skipped when nothing changes, so re-recording the same decision touches no row.
  update public.btc_matches
  set tiebreak_winner_team_id = p_winner_team_id,
      tiebreak_reason = v_reason
  where id = p_match_id
    and (tiebreak_winner_team_id is distinct from p_winner_team_id
         or tiebreak_reason is distinct from v_reason);

  -- Fills (or, if the winner changed, moves) every seat this match feeds; refused if the
  -- downstream match already exists with the other team in it.
  perform app.advance_btc_bracket(p_match_id);

  -- Do not leak this reason into whatever else runs later in the same transaction.
  perform set_config('app.change_reason', '', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_heat_time(p_operation_id uuid, p_org_id uuid, p_heat_entry_id uuid, p_expected_heat_status text, p_elapsed_secs integer, p_elapsed_secs_raw integer, p_maxed boolean, p_time_source text, p_time_edited_at timestamp with time zone, p_conflict_policy text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_heat_id uuid;
  v_heat_status text;
  v_already_set boolean;
  v_current_time_source text;
  v_current_time_note text;
begin
  if p_conflict_policy not in ('reject', 'overwrite') then
    raise exception 'record_heat_time: invalid p_conflict_policy %', p_conflict_policy;
  end if;

  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is null or p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
    raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;

  if v_heat_id is null then
    raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  perform 1 from public.ct_heats where id = v_heat_id for update;

  -- A retry of an operation that was still in flight when this call started waited on
  -- the lock above; it must find the ledger row and stop, not re-apply (an 'overwrite'
  -- would rewrite the row and then fail on the ledger's primary key; a 'reject' would
  -- report a conflict its own earlier success caused).
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  select h.status, (he.elapsed_secs is not null), he.time_source, he.time_note
    into v_heat_status, v_already_set, v_current_time_source, v_current_time_note
  from public.ct_heat_entries he
  join public.ct_heats h on h.id = he.heat_id
  where he.id = p_heat_entry_id;

  if v_heat_status <> p_expected_heat_status then
    raise exception 'CONFLICT: heat % is % now, expected %', v_heat_id, v_heat_status, p_expected_heat_status
      using detail = json_build_object(
              'heat_id', v_heat_id,
              'current_status', v_heat_status,
              'expected_status', p_expected_heat_status
            )::text,
            errcode = 'P0002';
  end if;

  -- 'reject' refuses any already-set entry, unchanged. 'overwrite' now
  -- refuses too, UNLESS the existing value is itself a prior manual entry
  -- — the only case 'overwrite' was ever meant to cover. This is what
  -- closes the tap-then-manual clobber above: a manual save arriving
  -- after a real tap sees v_current_time_source = 'tapped' and is
  -- refused, exactly like a genuine double-tap already was.
  if v_already_set and (
    p_conflict_policy = 'reject'
    or (p_conflict_policy = 'overwrite' and v_current_time_source is distinct from 'manual')
    -- A time with a note was changed by correct_heat_time (20261006100000), which
    -- sets time_source = 'manual' and records why. Only another correction may
    -- change it: otherwise a stale manual entry from a second device would
    -- silently replace the correction, leaving its reason on a time it no longer
    -- explains.
    or (p_conflict_policy = 'overwrite' and v_current_time_note is not null)
  ) then
    raise exception 'CONFLICT: heat entry % already has a recorded time', p_heat_entry_id
      using errcode = 'P0002';
  end if;

  update public.ct_heat_entries
  set elapsed_secs = p_elapsed_secs,
      elapsed_secs_raw = p_elapsed_secs_raw,
      maxed = p_maxed,
      time_source = p_time_source,
      time_edited_at = p_time_edited_at
  where id = p_heat_entry_id;

  if not exists (
    select 1 from public.ct_heat_entries where heat_id = v_heat_id and elapsed_secs is null
  ) then
    update public.ct_heats set status = 'scoring' where id = v_heat_id and status in ('pending', 'timing');
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'record_heat_time');
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stage(p_operation_id uuid, p_org_id uuid, p_stage_id uuid, p_next_stage_id uuid, p_advancing_entries jsonb, p_champion_stage_entry_id uuid, p_eliminated jsonb, p_final_position smallint, p_below_cutoff jsonb, p_coin_toss_note text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_row jsonb;
  v_entry_id uuid;
  v_stage_entry_id uuid;
  v_source text;
  v_champion_note text;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Two DISTINCT checks per stage id — see 20260906060000_resolve_stage_rpc.sql for why each is needed.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_stage(p_stage_id) then
    raise exception 'resolve_stage: stage % not found', p_stage_id;
  end if;

  perform 1 from public.ct_stages where id = p_stage_id;
  if not found then
    raise exception 'resolve_stage: stage % not found', p_stage_id;
  end if;

  if p_next_stage_id is not null then
    if p_org_id is null or p_org_id is distinct from app.org_id_for_stage(p_next_stage_id) then
      raise exception 'resolve_stage: next stage % not found', p_next_stage_id;
    end if;

    perform 1 from public.ct_stages where id = p_next_stage_id;
    if not found then
      raise exception 'resolve_stage: next stage % not found', p_next_stage_id;
    end if;
  end if;

  if p_next_stage_id is not null then
    for v_row in select * from jsonb_array_elements(coalesce(p_advancing_entries, '[]'::jsonb))
    loop
      v_entry_id := (v_row->>'entry_id')::uuid;
      v_source := v_row->>'source';

      if not exists (
        select 1 from public.ct_stage_entries where stage_id = p_stage_id and entry_id = v_entry_id
      ) then
        raise exception 'resolve_stage: entry % is not a member of stage %', v_entry_id, p_stage_id;
      end if;

      insert into public.ct_stage_entries (stage_id, entry_id, source, position_note)
      values (
        p_next_stage_id,
        v_entry_id,
        v_source,
        case when v_source = 'coin_toss' then p_coin_toss_note else null end
      )
      on conflict (stage_id, entry_id) do nothing;
    end loop;
  elsif p_champion_stage_entry_id is not null then
    select p_coin_toss_note into v_champion_note
    from jsonb_array_elements(coalesce(p_advancing_entries, '[]'::jsonb)) e
    where e->>'source' = 'coin_toss'
    limit 1;

    update public.ct_stage_entries
    set final_position = 1,
        position_note = v_champion_note
    where id = p_champion_stage_entry_id and stage_id = p_stage_id;

    if not found then
      raise exception 'resolve_stage: champion stage entry % not found in stage %',
        p_champion_stage_entry_id, p_stage_id;
    end if;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_eliminated, '[]'::jsonb))
  loop
    v_stage_entry_id := (v_row->>'stage_entry_id')::uuid;

    update public.ct_stage_entries
    set final_position = p_final_position,
        position_note = case when (v_row->>'via_coin_toss')::boolean then p_coin_toss_note else null end
    where id = v_stage_entry_id and stage_id = p_stage_id;

    if not found then
      raise exception 'resolve_stage: eliminated stage entry % not found in stage %',
        v_stage_entry_id, p_stage_id;
    end if;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_below_cutoff, '[]'::jsonb))
  loop
    v_stage_entry_id := (v_row->>'stage_entry_id')::uuid;

    update public.ct_stage_entries
    set final_position = (v_row->>'position')::smallint
    where id = v_stage_entry_id and stage_id = p_stage_id;

    if not found then
      raise exception 'resolve_stage: below-cutoff stage entry % not found in stage %',
        v_stage_entry_id, p_stage_id;
    end if;
  end loop;

  update public.ct_stages set status = 'complete' where id = p_stage_id;

  -- The event is over once its terminal stage (cutoff is null) is resolved with no next stage.
  if p_next_stage_id is null then
    update public.events e
    set status = 'concluded'
    from public.ct_stages s
    where s.id = p_stage_id
      and s.cutoff is null
      and e.id = s.event_id
      and e.status <> 'concluded';
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'resolve_stage');
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_started_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_status text;
  v_timing_mode text;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is null or p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'start_heat: heat % not found', p_heat_id;
  end if;

  select status, timing_mode into v_status, v_timing_mode
  from public.ct_heats where id = p_heat_id;
  if v_status is null then
    raise exception 'start_heat: heat % not found', p_heat_id;
  end if;

  if v_timing_mode <> 'app' then
    raise exception 'start_heat: heat % is not an app-mode heat', p_heat_id;
  end if;

  update public.ct_heats
  set status = 'timing', started_at = p_started_at
  where id = p_heat_id and status = 'pending';

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'start_heat');
end;
$function$;

CREATE OR REPLACE FUNCTION public.unpublish_event_results(p_org_id uuid, p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'unpublish_event_results: event % not found', p_event_id;
  end if;

  delete from public.public_results where event_id = p_event_id and org_id = p_org_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_roster_entry(p_org_id uuid, p_entry_id uuid, p_display_name text, p_phone text, p_email text, p_cafe text, p_bib text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_event_id uuid;
  v_person_id uuid;
  v_snap_name text;
  v_snap_cafe text;
  v_name text := nullif(btrim(p_display_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(btrim(p_email), '');
  v_cafe text := nullif(btrim(p_cafe), '');
  v_bib text := nullif(btrim(p_bib), '');
  v_other_id uuid;
  v_other_name text;
begin
  -- Read under RLS first: a non-member sees no row at all. Locked here so the person_id read is
  -- the one the write uses (a concurrent merge_people re-points it under the same row lock).
  select ee.event_id, ee.person_id, ee.display_name, nullif(btrim(ee.cafe), '')
    into v_event_id, v_person_id, v_snap_name, v_snap_cafe
  from public.event_entries ee
  where ee.id = p_entry_id
  for update;

  if v_event_id is null or p_org_id is null or p_org_id is distinct from app.org_id_for_event(v_event_id) then
    raise exception 'update_roster_entry: entry % not found', p_entry_id;
  end if;

  if v_name is null then
    raise exception 'update_roster_entry: a name is required';
  end if;
  if char_length(v_name) > 200 or char_length(coalesce(v_cafe, '')) > 200
     or char_length(coalesce(v_bib, '')) > 50 or char_length(coalesce(v_email, '')) > 254
     or char_length(coalesce(v_phone, '')) > 32 then
    raise exception 'update_roster_entry: a value is too long';
  end if;

  if v_person_id is null then
    -- A walk-up entry: no profile to carry a phone or email.
    if v_phone is not null or v_email is not null then
      raise exception 'update_roster_entry: this entry has no profile, so a phone or email cannot be set';
    end if;
  else
    if v_phone is null then
      raise exception 'update_roster_entry: a phone number is required';
    end if;

    -- Serialise two devices editing the same person.
    perform 1 from public.people where id = v_person_id and org_id = p_org_id for update;
    if not found then
      raise exception 'update_roster_entry: entry % not found', p_entry_id;
    end if;

    select p.id, p.display_name into v_other_id, v_other_name
    from public.people p
    where p.org_id = p_org_id and p.phone = v_phone and p.id <> v_person_id;
    if found then
      raise exception 'CONFLICT: that phone number already belongs to another person'
        using detail = json_build_object(
                'field', 'phone',
                'existing_person_id', v_other_id,
                'existing_display_name', v_other_name
              )::text,
              errcode = 'P0002';
    end if;

    if v_email is not null then
      select p.id, p.display_name into v_other_id, v_other_name
      from public.people p
      where p.org_id = p_org_id and lower(p.email) = lower(v_email) and p.id <> v_person_id;
      if found then
        raise exception 'CONFLICT: that email already belongs to another person'
          using detail = json_build_object(
                  'field', 'email',
                  'existing_person_id', v_other_id,
                  'existing_display_name', v_other_name
                )::text,
                errcode = 'P0002';
      end if;
    end if;

    begin
      update public.people
      set display_name = case when v_name is distinct from v_snap_name then v_name else display_name end,
          phone = v_phone,
          email = v_email,
          cafe = case when v_cafe is distinct from v_snap_cafe then v_cafe else cafe end
      where id = v_person_id and org_id = p_org_id;
    exception when unique_violation then
      -- Lost a race with another device between the checks above and this write.
      raise exception 'CONFLICT: that phone number or email already belongs to another person'
        using detail = json_build_object('field', null)::text, errcode = 'P0002';
    end;
  end if;

  update public.event_entries
  set display_name = v_name, cafe = v_cafe, bib = v_bib
  where id = p_entry_id;
  if not found then
    raise exception 'update_roster_entry: entry % not found', p_entry_id;
  end if;
end;
$function$;
