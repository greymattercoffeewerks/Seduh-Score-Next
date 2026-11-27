-- Seduh Score Next - Throwdown: a tap-vote match cannot be confirmed until every judge has voted.
--
-- td_confirm_match only needed a strict leader, so one tap of three judges could be confirmed and the match was recorded
-- 1-0 (found at the first live Throwdown, 2026-11-27). Now the votes must also number at least td_settings.judge_count
-- (an even panel that came out level has one more, the tie-break, so "at least" holds for it too). The screen enforces
-- the same rule (votes.js canConfirm); a confirm short of judges is refused with hint td_votes_incomplete. Level votes
-- are still refused first (td_votes_level), so the existing message for an empty or tied match is unchanged.
--
-- Only td_confirm_match changes; td_cast_vote, td_undo_vote, scored matches (td_confirm_scored_match, which already needs
-- every judge's sheet) and walkovers are untouched. Results already confirmed are not changed by this migration.
--
-- rollback: (restores the definition from 20261103120000_throwdown_rpcs.sql)
--   create or replace function public.td_confirm_match(
--     p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_winner_slot_id uuid default null
--   )
--   returns void language plpgsql security definer set search_path = '' as $f$
--   declare
--     v_event   uuid;
--     v_leaders int;
--     v_top     bigint;
--     v_leader  uuid;
--   begin
--     v_event := app.td_guard_match('td_confirm_match', p_org_id, p_match_id);
--     perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--     if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
--       return;
--     end if;
--     if (select count(*) from public.td_slots s where s.match_id = p_match_id and s.entry_id is not null) < 2 then
--       raise exception 'td_confirm_match: the match does not have two competitors' using hint = 'td_match_not_ready';
--     end if;
--     select count(*) filter (where t.n = t.mx), max(t.n), (array_agg(t.id) filter (where t.n = t.mx))[1]
--       into v_leaders, v_top, v_leader
--       from (select s.id, count(v.id) as n, max(count(v.id)) over () as mx
--               from public.td_slots s left join public.td_votes v on v.slot_id = s.id
--              where s.match_id = p_match_id and s.entry_id is not null
--              group by s.id) t;
--     if v_top = 0 or v_leaders <> 1 then
--       raise exception 'td_confirm_match: the votes are level' using hint = 'td_votes_level';
--     end if;
--     if p_expected_winner_slot_id is not null and p_expected_winner_slot_id <> v_leader then
--       raise exception 'td_confirm_match: the leader changed since you looked' using hint = 'td_leader_changed';
--     end if;
--     update public.td_matches set result_kind = 'votes', confirmed_at = now() where id = p_match_id;
--     perform app.td_advance(v_event);
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_confirm_match');
--   end;
--   $f$;
--   revoke all on function public.td_confirm_match(uuid, uuid, uuid, uuid) from public, anon;
--   grant execute on function public.td_confirm_match(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.td_confirm_match(
  p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_winner_slot_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   uuid;
  v_leaders int;
  v_top     bigint;
  v_leader  uuid;
  v_total   bigint;
  v_judges  int;
begin
  v_event := app.td_guard_match('td_confirm_match', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  -- already decided (a double tap with a fresh operation id): nothing to do
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    return;
  end if;
  if (select count(*) from public.td_slots s where s.match_id = p_match_id and s.entry_id is not null) < 2 then
    raise exception 'td_confirm_match: the match does not have two competitors' using hint = 'td_match_not_ready';
  end if;

  select count(*) filter (where t.n = t.mx), max(t.n), (array_agg(t.id) filter (where t.n = t.mx))[1], sum(t.n)
    into v_leaders, v_top, v_leader, v_total
    from (select s.id, count(v.id) as n, max(count(v.id)) over () as mx
            from public.td_slots s left join public.td_votes v on v.slot_id = s.id
           where s.match_id = p_match_id and s.entry_id is not null
           group by s.id) t;
  if v_top = 0 or v_leaders <> 1 then
    raise exception 'td_confirm_match: the votes are level' using hint = 'td_votes_level';
  end if;
  -- every judge must have voted; the table's own default (3) stands in if the settings row were ever missing
  v_judges := coalesce((select st.judge_count from public.td_settings st where st.event_id = v_event), 3);
  if v_total < v_judges then
    raise exception 'td_confirm_match: not every judge has voted' using hint = 'td_votes_incomplete';
  end if;
  if p_expected_winner_slot_id is not null and p_expected_winner_slot_id <> v_leader then
    raise exception 'td_confirm_match: the leader changed since you looked' using hint = 'td_leader_changed';
  end if;

  update public.td_matches set result_kind = 'votes', confirmed_at = now() where id = p_match_id;
  perform app.td_advance(v_event);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_confirm_match');
end;
$$;
revoke all on function public.td_confirm_match(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_confirm_match(uuid, uuid, uuid, uuid) to authenticated;
