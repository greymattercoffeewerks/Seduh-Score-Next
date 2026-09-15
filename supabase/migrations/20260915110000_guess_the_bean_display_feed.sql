-- Guess the Bean Phase 5: an anonymous display can show arrivals before the
-- reveal without exposing their numeric guesses.  The separate post-reveal
-- RPC deliberately makes the answer-dependent values available only after
-- the parent session has been revealed.
-- rollback:
--   drop function if exists app.session_display_guesses(uuid);
--   drop policy if exists guesses_select_anon_feed on public.guesses;
--   drop policy if exists guesses_select_authenticated on public.guesses;
--   create policy guesses_select on public.guesses for select using (
--     app.session_is_revealed(guesses.session_id)
--     or app.session_is_creator(guesses.session_id)
--   );
--   revoke select on public.guesses from anon;
--   grant select, insert on public.guesses to anon;

-- The old policy made the anonymous display's pre-reveal feed empty.  Do not
-- solve that by granting the numeric `guess` column: a participant could then
-- inspect everyone else's guess before the result is announced.  Column
-- privileges and RLS are separate gates, so anon gets only the fields needed
-- for the arrival feed while authenticated creators retain their full export.
drop policy if exists guesses_select on public.guesses;

create policy guesses_select_anon_feed on public.guesses
  for select
  to anon
  using (true);

create policy guesses_select_authenticated on public.guesses
  for select
  to authenticated
  using (
    app.session_is_revealed(guesses.session_id)
    or app.session_is_creator(guesses.session_id)
  );

revoke select on public.guesses from anon;
grant select (id, session_id, name, created_at) on public.guesses to anon;
grant insert on public.guesses to anon;

-- Security-definer is intentional here: it is the conditional column grant
-- PostgreSQL cannot express with RLS alone.  It returns no rows until the
-- parent is revealed, and never touches contacts.  `set search_path = ''`
-- keeps the function independent of caller-controlled name resolution.
create or replace function app.session_display_guesses(p_session_id uuid)
returns table (id uuid, name text, guess integer, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select g.id, g.name, g.guess, g.created_at
  from public.guesses g
  where g.session_id = p_session_id
    and app.session_is_revealed(p_session_id)
  order by g.created_at asc, g.id asc;
$$;

revoke all on function app.session_display_guesses(uuid) from public;
grant execute on function app.session_display_guesses(uuid) to anon, authenticated;
