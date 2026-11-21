-- Seduh Score Next - Throwdown: undo a confirmed match (an organiser confirmed the wrong winner).
--
-- Until now a confirmed result could not be taken back: a wrong tap that became a confirmed winner stood for the rest of
-- the event. td_reopen_match puts a decided match back to open. Owner decisions 2026-11-21:
--   * WHEN: while nothing that follows the match has started. Confirming the last match of a main round creates the next
--     round (and, from the semi-finals, the 3rd place match) at once, in app.td_advance; reopening a match of a main round
--     removes every later round of the event, but only when none of their matches has a tap, a score sheet or a result
--     other than a bye (hint td_next_round_started otherwise). Confirming the match again rebuilds them through the same
--     app.td_advance, in the same order (pairs by match position), so nothing is lost. A 3rd place match and the Final
--     have nothing after them. A bye has no result to undo (hint td_match_bye).
--     The rebuild re-reads one thing that can change mid-event: whether a semi-final loser has withdrawn (app.td_advance
--     makes the 3rd place match only when both losers are active). So undoing a semi-final is refused when the 3rd place
--     match's existence no longer matches what td_advance would decide today (a loser withdrawn or restored since), hint
--     td_third_place_changed: otherwise the undo would silently add or drop the 3rd place match and change the podium.
--   * VOTES AND SHEETS ARE KEPT. The match goes back to open with its taps and its score sheets as they were; the
--     organiser fixes the wrong tap or sheet and confirms again. A walkover simply goes back to open. An organiser's pick
--     for a level scored match (td_score_decisions) is removed, because it was part of the result being undone.
--   * RECORDED. Each undo writes one row to td_match_reopens: which match (by round and match position too, so the row
--     survives a later removal of that match), the result it had (kind, winner, when it was confirmed), how many later
--     rounds it removed, who undid it and when. The console's match log shows them. The table is written only here.
--   * PUBLISHED RESULTS are not touched: the screen reminds the organiser that public results show the old result until
--     published again.
-- Same shape as every Throwdown writer: SECURITY DEFINER, app.td_guard_match (membership, format, window lock), the event's
-- advisory lock, idempotent through processed_operations; an undecided match is a quiet no-op (a double tap).
--
-- rollback:
--   drop function if exists public.td_reopen_match(uuid, uuid, uuid, uuid);
--   drop table if exists public.td_match_reopens;

-- ============ the record of each undo ============

create table td_match_reopens (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references events(id) on delete cascade,
  -- set null when a later undo removes the round this match was in; the positions below still say which match it was
  match_id                  uuid references td_matches(id) on delete set null,
  round_position            smallint not null,
  round_phase               text not null,
  match_position            smallint not null,
  previous_result_kind      text not null,
  previous_winner_entry_id  uuid references event_entries(id) on delete set null,
  previous_confirmed_at     timestamptz not null,
  rounds_removed            smallint not null default 0,
  reopened_by               uuid,
  reopened_at               timestamptz not null default now(),
  constraint td_match_reopens_kind_valid check (previous_result_kind in ('votes', 'walkover', 'scores')),
  constraint td_match_reopens_phase_valid check (round_phase in ('main', 'redemption', 'third_place')),
  constraint td_match_reopens_rounds_removed_valid check (rounds_removed >= 0)
);
alter table td_match_reopens enable row level security;
create index on td_match_reopens (event_id);
create index on td_match_reopens (match_id);
create index on td_match_reopens (previous_winner_entry_id);
create trigger trg_td_match_reopens_parent_immutable
  before update on td_match_reopens
  for each row execute function app.forbid_parent_change('event_id');

create policy td_match_reopens_read on td_match_reopens
  for select using (app.is_org_member(app.org_id_for_event(event_id)));
-- the Per-event window lock (20261023140000; test 056): same restrictive policy text as the other Throwdown tables
create policy td_match_reopens_window_lock on td_match_reopens as restrictive for all to authenticated
  using (not (select app.window_lock_on()) or not coalesce((event_id) in (select app.window_locked_events()), false))
  with check (not (select app.window_lock_on()) or not coalesce((event_id) in (select app.window_locked_events()), false));

revoke all on td_match_reopens from public, anon, authenticated;
grant select on td_match_reopens to authenticated;

-- ============ undo a confirmed match ============

create or replace function public.td_reopen_match(
  p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_winner_slot_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event     uuid;
  v_match     public.td_matches;
  v_round     public.td_rounds;
  v_winner    uuid;
  v_winner_entry uuid;
  v_removed   int := 0;
  v_losers    uuid[];
  v_would     boolean;
begin
  v_event := app.td_guard_match('td_reopen_match', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  select * into v_match from public.td_matches where id = p_match_id;
  -- not decided (a double tap with a fresh operation id): nothing to undo
  if v_match.confirmed_at is null then
    return;
  end if;
  if v_match.result_kind = 'bye' then
    raise exception 'td_reopen_match: a bye has no result to undo' using hint = 'td_match_bye';
  end if;
  select * into v_round from public.td_rounds where id = v_match.round_id;

  select r.winner_slot_id into v_winner from public.td_match_results r where r.match_id = p_match_id;
  -- the organiser undoes the result they saw: if another device has already undone and re-confirmed it differently, stop
  if p_expected_winner_slot_id is not null and p_expected_winner_slot_id is distinct from v_winner then
    raise exception 'td_reopen_match: the result changed since you looked' using hint = 'td_leader_changed';
  end if;
  select s.entry_id into v_winner_entry from public.td_slots s where s.id = v_winner;

  -- what follows a main round's match: every later round of the event (the next main round, and from the semi-finals
  -- the 3rd place match and the Final). A 3rd place match has nothing after it.
  if v_round.phase = 'main' then
    if exists (
      select 1 from public.td_matches m join public.td_rounds r on r.id = m.round_id
       where r.event_id = v_event and r.position > v_round.position
         and (coalesce(m.result_kind <> 'bye', false)
              or exists (select 1 from public.td_votes v where v.match_id = m.id)
              or exists (select 1 from public.td_score_sheets ss where ss.match_id = m.id))
    ) then
      raise exception 'td_reopen_match: the next round has already started' using hint = 'td_next_round_started';
    end if;
    -- a semi-final round (exactly two matches) with rounds after it: the 3rd place match must come back as it is now
    if (select count(*) from public.td_matches m where m.round_id = v_round.id) = 2
       and exists (select 1 from public.td_rounds r where r.event_id = v_event and r.position > v_round.position) then
      select array_agg(l.entry_id order by m.position) into v_losers
        from public.td_matches m
        join public.td_match_results x on x.match_id = m.id
        left join public.td_slots l on l.match_id = m.id and l.id <> x.winner_slot_id and l.entry_id is not null
       where m.round_id = v_round.id;
      v_would := coalesce((select s.third_place from public.td_settings s where s.event_id = v_event), true)
                 and v_losers[1] is not null and v_losers[2] is not null
                 and not exists (select 1 from public.event_entries e where e.id = any (v_losers) and e.withdrawn);
      if v_would is distinct from exists (
           select 1 from public.td_rounds r
            where r.event_id = v_event and r.position > v_round.position and r.phase = 'third_place') then
        raise exception 'td_reopen_match: a semi-final loser was withdrawn or restored since; undoing would change the 3rd place match'
          using hint = 'td_third_place_changed';
      end if;
    end if;
    delete from public.td_rounds r where r.event_id = v_event and r.position > v_round.position;
    get diagnostics v_removed = row_count;
  end if;

  insert into public.td_match_reopens (
    event_id, match_id, round_position, round_phase, match_position, previous_result_kind, previous_winner_entry_id,
    previous_confirmed_at, rounds_removed, reopened_by)
  values (
    v_event, p_match_id, v_round.position, v_round.phase, v_match.position, v_match.result_kind, v_winner_entry,
    v_match.confirmed_at, v_removed, auth.uid());

  delete from public.td_score_decisions where match_id = p_match_id;
  update public.td_matches
     set result_kind = null, confirmed_at = null, walkover_winner_position = null
   where id = p_match_id;
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_reopen_match');
end;
$$;
revoke all on function public.td_reopen_match(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_reopen_match(uuid, uuid, uuid, uuid) to authenticated;
