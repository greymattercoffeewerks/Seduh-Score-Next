-- Guess the Bean Phase 5 follow-up: PostgREST exposes the public schema,
-- while the privacy resolvers deliberately live in app. These public wrappers
-- are the narrow browser-callable bridge; their app implementations remain
-- the sole place deciding whether reveal-gated data is returned.
-- rollback:
--   drop function if exists public.session_display_guesses(uuid);
--   drop function if exists public.session_bean_count(uuid);

create or replace function public.session_bean_count(p_session_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select app.session_bean_count(p_session_id);
$$;

create or replace function public.session_display_guesses(p_session_id uuid)
returns table (id uuid, name text, guess integer, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select * from app.session_display_guesses(p_session_id);
$$;

revoke all on function public.session_bean_count(uuid) from public;
revoke all on function public.session_display_guesses(uuid) from public;
grant execute on function public.session_bean_count(uuid) to anon, authenticated;
grant execute on function public.session_display_guesses(uuid) to anon, authenticated;
