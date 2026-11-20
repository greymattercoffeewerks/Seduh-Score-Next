-- Seduh Score Next - Throwdown: a match takes no more tap votes than the event has judges.
--
-- One tap is one judge's vote, so a match's vote rows can never outnumber the judges (td_settings.judge_count). Until now
-- td_cast_vote counted every tap, so a double tap or a second device could show "5 of 3 votes in". The cap is checked
-- inside the event's advisory lock, after the replay check, so two devices tapping at once cannot both slip past it and
-- an outbox replay of an already-counted tap is still a quiet no-op. A tap past the cap is refused with
-- hint td_votes_full; Undo is unchanged, so a full but level match is fixed by taking a vote back and voting again.
-- (The judge count is locked once Round 1 starts, so the cap cannot move under a running match.) A future scoring module
-- that needs more taps than judges must change this function on purpose.
--
-- rollback: (restores the definition from 20261103120000_throwdown_rpcs.sql)
--   create or replace function public.td_cast_vote(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_slot_id uuid)
--   returns void language plpgsql security definer set search_path = '' as $f$
--   declare
--     v_event uuid;
--   begin
--     v_event := app.td_guard_match('td_cast_vote', p_org_id, p_match_id);
--     perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--     if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
--       raise exception 'td_cast_vote: the match is already decided' using hint = 'td_match_decided';
--     end if;
--     if not exists (select 1 from public.td_slots s
--                     where s.id = p_slot_id and s.match_id = p_match_id and s.entry_id is not null) then
--       raise exception 'td_cast_vote: slot not found' using hint = 'td_slot_invalid';
--     end if;
--     insert into public.td_votes (event_id, match_id, slot_id) values (v_event, p_match_id, p_slot_id);
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_cast_vote');
--   end;
--   $f$;
--   revoke all on function public.td_cast_vote(uuid, uuid, uuid, uuid) from public, anon;
--   grant execute on function public.td_cast_vote(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.td_cast_vote(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  uuid;
  v_judges int;
begin
  v_event := app.td_guard_match('td_cast_vote', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    raise exception 'td_cast_vote: the match is already decided' using hint = 'td_match_decided';
  end if;
  if not exists (select 1 from public.td_slots s
                  where s.id = p_slot_id and s.match_id = p_match_id and s.entry_id is not null) then
    raise exception 'td_cast_vote: slot not found' using hint = 'td_slot_invalid';
  end if;
  -- the table's own default (3) stands in if the settings row were ever missing; td_start_event always writes one
  v_judges := coalesce((select st.judge_count from public.td_settings st where st.event_id = v_event), 3);
  if (select count(*) from public.td_votes v where v.match_id = p_match_id) >= v_judges then
    raise exception 'td_cast_vote: every judge has voted in this match' using hint = 'td_votes_full';
  end if;
  insert into public.td_votes (event_id, match_id, slot_id) values (v_event, p_match_id, p_slot_id);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_cast_vote');
end;
$$;
revoke all on function public.td_cast_vote(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_cast_vote(uuid, uuid, uuid, uuid) to authenticated;
