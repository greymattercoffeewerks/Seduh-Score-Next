-- Seduh Score Next · T-BTC.2 create_btc_match RPC
-- Atomic match creation: a match row plus its exactly-3-judges assignment,
-- in one transaction — closing the exactly-3-judges validation gap
-- 20260918090000_btc_tables.sql's own comment deliberately deferred here,
-- and avoiding the half-created-match failure mode a plain two-step client
-- write (insert match, then insert match_judges) would risk under this
-- project's "unreliable venue wifi" design target (handoff §9's own
-- reasoning, applied here even though this isn't an outbox-queued write —
-- see this function's own comment for why it doesn't need one).
--
-- NOT idempotent, unlike createStage/createTeam's own UNIQUE_VIOLATION-
-- recovers-to-existing-row shape (schema-guardian review, T-BTC.2): there
-- is no unique constraint on btc_matches identifying "the same match" from
-- a caller's point of view, because two legitimate matches between the same
-- two teams in the same round IS a real, valid scenario this format doesn't
-- forbid (unlike a team/judge NAME, which genuinely is a duplicate the
-- moment it repeats). A retried submission after a dropped response can
-- therefore create a real duplicate match — accepted, not silently ignored:
-- src/formats/btc/matches.js's removeMatch (and matchesScreen.js's own
-- delete affordance) is the organiser's recovery path for exactly this,
-- rather than the RPC guessing at an identity it doesn't actually have.
--
-- rollback:
--   revoke execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) from service_role;
--   revoke execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) from authenticated;
--   drop function if exists create_btc_match(uuid, text, uuid, uuid, uuid[]);

-- Not security definer, no processed_operations idempotency key, unlike
-- confirm_heat/start_heat/etc. — those are LIVE-timing writes queued
-- through core/outbox.js and replayed on retry, so they need a client-
-- generated operation id to dedupe against. Match creation is a setup-time
-- write (mirrors formats/cup-taster/setup.js's own createStage/heats.js's
-- ensureHeatEntries — plain retryable composition, not outbox-routed) — a
-- dropped response just means the caller doesn't know whether it landed,
-- the same class of race those two already accept for the same reason.
-- Running as SECURITY INVOKER (the default) means ordinary RLS already
-- gates the insert into btc_matches to an org member of this event — no
-- need to reimplement that check here.
create or replace function create_btc_match(
  p_event_id uuid,
  p_round text,
  p_team1_id uuid,
  p_team2_id uuid,
  p_judge_ids uuid[]
)
returns btc_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.btc_matches;
  v_judge_id uuid;
  v_distinct_judge_count int;
begin
  if p_team1_id = p_team2_id then
    raise exception 'create_btc_match: a team cannot play itself';
  end if;

  select count(distinct j) into v_distinct_judge_count from unnest(p_judge_ids) as j;
  if coalesce(array_length(p_judge_ids, 1), 0) <> 3 or v_distinct_judge_count <> 3 then
    raise exception 'create_btc_match: exactly 3 distinct judges are required';
  end if;

  -- btc_teams/btc_judges have no FK tying them to a specific event beyond
  -- their own event_id column — nothing stops a caller from passing a real
  -- team/judge id that belongs to a DIFFERENT event (or, before RLS is even
  -- reached, that belongs to a different org's event entirely). RLS on the
  -- eventual insert already stops a non-member from writing at all, but a
  -- member of ORG A could otherwise reference a team/judge row from one of
  -- ORG A's OTHER events — same cross-entity-within-one-org mistake class
  -- live_sessions.org_id/event_id (T1.3) and ct_results.set_id/
  -- heat_entry_id (T3.2) were both closed for.
  if not exists (
    select 1 from public.btc_teams where id = p_team1_id and event_id = p_event_id
  ) then
    raise exception 'create_btc_match: team1 does not belong to this event';
  end if;
  if not exists (
    select 1 from public.btc_teams where id = p_team2_id and event_id = p_event_id
  ) then
    raise exception 'create_btc_match: team2 does not belong to this event';
  end if;
  if exists (
    select 1 from unnest(p_judge_ids) as jid
    where not exists (
      select 1 from public.btc_judges j where j.id = jid and j.event_id = p_event_id
    )
  ) then
    raise exception 'create_btc_match: all judges must belong to this event';
  end if;

  insert into public.btc_matches (event_id, round, team1_id, team2_id)
  values (p_event_id, p_round, p_team1_id, p_team2_id)
  returning * into v_match;

  foreach v_judge_id in array p_judge_ids loop
    insert into public.btc_match_judges (match_id, judge_id) values (v_match.id, v_judge_id);
  end loop;

  return v_match;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on a new function unless
-- explicitly revoked (found the hard way on the six existing write RPCs —
-- see 20260830140000_revoke_public_execute_on_write_rpcs.sql's own account
-- of `anon` silently inheriting EXECUTE for months) — revoked here from the
-- function's own first migration this time, not left for a later pin.
revoke execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) from public;
grant execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) to authenticated;
grant execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) to service_role;
