-- Seduh Score Next · Guess the Bean — sessions.bean_count
-- Handoff: Handoffs and Specs/guess-the-bean-next-port-SPEC.md's own Phase 5
-- "winner spotlight (closest guess)" requirement. A gap in the spec's own
-- Phase 1 data model — found while porting Phase 3's create-session form
-- against the ACTUAL legacy page (github.com/greymattercoffee/Seduh-Score,
-- dev branch, booth/setup/index.html), which requires a "Real bean count"
-- field on session creation that the locked schema never carried. User
-- decision (2026-09-14): add the column now, not defer to reveal-time-only.
--
-- rollback:
--   drop trigger if exists trg_sessions_bean_count_immutable on sessions;
--   drop function if exists app.check_bean_count_immutable();
--   drop function if exists app.session_bean_count(uuid);
--   alter table sessions drop column if exists bean_count;

-- Required, not nullable: unlike legacy's dual Guess-the-Bean/Grinder-
-- Challenge booth (this port is Guess-the-Bean only, per the spec's own
-- scope), every session here IS a guessing game — there's no "this session
-- doesn't need a bean count" case the way legacy's grinder-only sessions had.
alter table sessions
  add column bean_count integer not null check (bean_count between 1 and 100000000);

-- Never exposed via a plain column grant, even post-reveal: anon's grant on
-- sessions is column-scoped (20260914121000_guess_the_bean_rls.sql), and a
-- column grant can't be conditional on row state — the same constraint that
-- already forced app.session_is_open/is_revealed/is_creator into existence
-- applies here. This resolver is the ONE place bean_count is ever readable
-- by anon, and only once the session is actually revealed; before that it
-- returns NULL regardless of who's asking, closing the obvious "just call
-- the function early" bypass.
create or replace function app.session_bean_count(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when revealed then bean_count else null end
  from public.sessions
  where id = p_session_id;
$$;

-- bean_count is immutable after creation, enforced server-side, not just by
-- the client never offering an edit control. Without this, sessions_update's
-- own creator-scoped WITH CHECK would let a creator quietly change
-- bean_count AFTER revealing — e.g. to make a preferred guess the "closest"
-- one — completely undermining the reason this column exists (Phase 5's
-- winner spotlight depends on it being the real, unaltered answer).
-- schema-guardian found this live: flagged as advisory (a trust/integrity
-- gap, not a multi-tenant security hole) but real enough to close here
-- rather than defer, since a self-service tool has no OTHER party who could
-- catch a creator cheating their own game.
create or replace function app.check_bean_count_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bean_count is distinct from old.bean_count then
    raise exception 'sessions.bean_count cannot be changed after creation';
  end if;
  return new;
end;
$$;

create trigger trg_sessions_bean_count_immutable
  before update on sessions
  for each row execute function app.check_bean_count_immutable();
