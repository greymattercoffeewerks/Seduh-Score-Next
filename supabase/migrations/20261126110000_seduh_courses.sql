-- Seduh Score Next · T-ID2.C6a/C6b: COURSES AND CERTIFICATES on a person's Seduh ID
-- (plan: Handoffs and Specs/SEDUH-ID-COURSES-AND-WORK-PLAN-DRAFT.md section 1 and "Owner answers (2026-11-18)": D1, D2, D3.)
--
-- What this adds:
--   * app.seduh_courses: training a claimed person has completed (title, provider, year completed, optional "valid until" year,
--     optional level and note). NOT a record entry: it never counts towards entries, podiums or the headline stats (it has its
--     own count). Owner-only table (RLS on, no policy, no API grant), like every Seduh ID table. Always `self_reported` for now;
--     the `confirmed` status and its fields are the SEAM for a provider confirming a course later (nothing writes them yet).
--   * a new privacy setting `vis_courses` ('public' | 'hidden', public by default, D2), edited through the existing
--     `seduh_set_my_settings` door (redefined here) and returned by `seduh_my_record` (app.seduh_my_record_json redefined).
--   * the person's own doors (authenticated only, each opening with app.seduh_my_account(), no uuid in any signature):
--       seduh_add_course, seduh_update_course (a full replace), seduh_delete_course, seduh_set_card_course.
--     The plan said "loader script for now"; self-service editing of the record exists since T-ID2.D-a, so the person adds their
--     own courses and nobody else can.
--   * public.public_seduh_profile redefined: returns `courses` ONLY while vis_courses = 'public' (the empty shape has `courses: []`).
--   * C6b, the "Certified: <title>" line on the story card (D3): ONE course per person may be marked `on_card` (a partial unique
--     index). Off unless the person chooses it. Only a CURRENT certificate can be chosen, and the card draws it only while it is
--     current and vis_courses is public (the public door says `current` itself, computed in SQL, so the page never guesses).
--
-- CARRIES EVERY EARLIER CHANGE of the three functions it redefines (a create or replace replaces the whole body):
--   public.public_seduh_profile   from 20261123100000_seduh_photo.sql (photo_url, self_reported, organiser_records ...)
--   public.seduh_set_my_settings  from 20261125100000_seduh_discovery.sql (listed_in_search)
--   app.seduh_my_record_json      from 20261125100000_seduh_discovery.sql (photo, listed_in_search)
-- A sibling migration that also redefines one of these must be merged by hand: re-read the latest body, add its lines here.
--
-- DESIGN CHOICES:
--   1. NO UUID IN ANY SIGNATURE. A course id is a bigint meaningful only with the caller's own account (every write is
--      `where id = ... and account_id = <caller's account>`); another person's id answers `not_found`, like a missing one.
--   2. TEXT: the entries' rule (app.seduh_clean_text / app.seduh_text_ok): trimmed, length-capped, no control or direction-override
--      characters. No certificate number, no image and no link in this version (numbers are personal data, images need
--      moderation, links can point anywhere).
--   3. CAP: 60 courses per account, enforced under a lock on the account row.
--   4. "CURRENT" = no `valid_until_year`, or one that has not yet passed ANYWHERE on Earth (year of now() minus 12 hours).
--      Expired courses stay visible (muted, "until <year>") but cannot be the card's certificate; an update that makes the
--      card's certificate expired clears the choice.
--   5. Closing an account leaves its courses in the table, never shown or readable (the profile door needs an open account), like
--      entries; PDPO deletion on close is C4.
--
-- ROLLBACK LOSES people's courses: do not roll back a populated table.
-- rollback:
--   -- restore the previous three functions first (create or replace): public.public_seduh_profile from
--   -- 20261123100000_seduh_photo.sql, public.seduh_set_my_settings and app.seduh_my_record_json from
--   -- 20261125100000_seduh_discovery.sql, then:
--   drop function if exists public.seduh_set_card_course(bigint);
--   drop function if exists public.seduh_delete_course(bigint);
--   drop function if exists public.seduh_update_course(bigint, text, text, integer, integer, text, text);
--   drop function if exists public.seduh_add_course(text, text, integer, integer, text, text);
--   drop function if exists app.seduh_course_clean(text, text, integer, integer, text, text);
--   drop function if exists app.seduh_course_json(app.seduh_courses);
--   drop function if exists app.seduh_course_current(smallint);
--   drop table if exists app.seduh_courses;
--   alter table app.seduh_profile_settings drop column if exists vis_courses;

-- ============ the setting ============

alter table app.seduh_profile_settings add column vis_courses text not null default 'public';
alter table app.seduh_profile_settings add constraint seduh_profile_settings_vis_courses_vocab
  check (vis_courses in ('public', 'hidden'));

-- ============ the table ============

create table app.seduh_courses (
  id              bigint generated always as identity primary key,
  account_id      uuid not null references app.seduh_accounts (id) on delete restrict,
  title           text not null,
  provider        text not null,
  completed_year  smallint not null,
  valid_until_year smallint,
  level           text,
  note            text,
  status          text not null default 'self_reported',
  -- SEAM: a provider confirming a course (nothing writes these yet)
  confirmed_by    text,
  confirmed_at    timestamptz,
  -- C6b: the ONE certificate shown on the story card (at most one per account: the partial unique index below)
  on_card         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- fixed ranges: a CHECK cannot use now() safely; the door refuses a year beyond next year
  constraint seduh_courses_completed_year_range check (completed_year between 1980 and 2100),
  constraint seduh_courses_valid_until_range
    check (valid_until_year is null or (valid_until_year between completed_year and 2100)),
  constraint seduh_courses_title_length check (char_length(title) between 1 and 120 and app.seduh_text_ok(title)),
  constraint seduh_courses_provider_length check (char_length(provider) between 1 and 80 and app.seduh_text_ok(provider)),
  constraint seduh_courses_level_length
    check (level is null or (char_length(level) between 1 and 40 and app.seduh_text_ok(level))),
  constraint seduh_courses_note_length
    check (note is null or (char_length(note) between 1 and 300 and app.seduh_text_ok(note))),
  constraint seduh_courses_status_vocab check (status in ('self_reported', 'confirmed')),
  constraint seduh_courses_confirmation_shape check (
    (status = 'self_reported' and confirmed_by is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_at is not null and char_length(confirmed_by) between 1 and 120
        and app.seduh_text_ok(confirmed_by)))
);
create index seduh_courses_account_idx on app.seduh_courses (account_id, completed_year desc);
create unique index seduh_courses_one_card_idx on app.seduh_courses (account_id) where on_card;

create trigger trg_seduh_courses_parent_immutable
  before update of id, account_id on app.seduh_courses
  for each row execute function app.forbid_parent_change('id', 'account_id');
create trigger trg_seduh_courses_set_updated_at
  before update on app.seduh_courses
  for each row execute function app.set_updated_at();

alter table app.seduh_courses enable row level security;
revoke all on app.seduh_courses from public, anon, authenticated, service_role;
revoke all on sequence app.seduh_courses_id_seq from public, anon, authenticated, service_role;

-- ============ helpers (owner-only: no API role) ============

-- current: no end year, or one that has not passed anywhere on Earth yet
create function app.seduh_course_current(p_valid_until smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_valid_until is null or p_valid_until >= extract(year from now() - interval '12 hours')::integer;
$$;
revoke all on function app.seduh_course_current(smallint) from public, anon, authenticated, service_role;

-- the person's own view of one course (the id is theirs to edit with)
create function app.seduh_course_json(c app.seduh_courses)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'provider', c.provider, 'completed_year', c.completed_year,
    'valid_until_year', c.valid_until_year, 'level', c.level, 'note', c.note,
    -- on_card is reported only while the course is current, as the public door does, so the person is never told an expired
    -- certificate is on their card
    'current', app.seduh_course_current(c.valid_until_year),
    'on_card', c.on_card and app.seduh_course_current(c.valid_until_year),
    'status', c.status, 'confirmed_by', c.confirmed_by, 'provenance', 'self_reported');
$$;
revoke all on function app.seduh_course_json(app.seduh_courses) from public, anon, authenticated, service_role;

create function app.seduh_course_clean(
  p_title text, p_provider text, p_completed_year integer, p_valid_until_year integer, p_level text, p_note text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  -- the latest year is the current year in the furthest-ahead time zone (UTC+14), as for entries
  if p_completed_year is null or p_completed_year < 1980
     or p_completed_year > extract(year from now() + interval '14 hours')::integer then
    raise exception 'That year is not allowed.' using errcode = 'P0001', hint = 'bad_year';
  end if;
  if p_valid_until_year is not null and (p_valid_until_year < p_completed_year or p_valid_until_year > 2100) then
    raise exception 'That end year is not allowed.' using errcode = 'P0001', hint = 'bad_valid_until';
  end if;
  return jsonb_build_object(
    'title', app.seduh_clean_text(p_title, 120, true, 'bad_title'),
    'provider', app.seduh_clean_text(p_provider, 80, true, 'bad_provider'),
    'completed_year', p_completed_year,
    'valid_until_year', p_valid_until_year,
    'level', app.seduh_clean_text(p_level, 40, false, 'bad_level'),
    'note', app.seduh_clean_text(p_note, 300, false, 'bad_note'));
end;
$$;
revoke all on function app.seduh_course_clean(text, text, integer, integer, text, text) from public, anon, authenticated, service_role;

-- ============ the person's doors ============

create function public.seduh_add_course(
  p_title text, p_provider text, p_completed_year integer, p_valid_until_year integer default null,
  p_level text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct uuid := app.seduh_my_account(true);
  c      jsonb := app.seduh_course_clean(p_title, p_provider, p_completed_year, p_valid_until_year, p_level, p_note);
  r      app.seduh_courses;
begin
  if (select count(*) from app.seduh_courses where account_id = v_acct) >= 60 then
    raise exception 'You have reached the limit of 60 courses.' using errcode = 'P0001', hint = 'too_many_courses';
  end if;
  insert into app.seduh_courses (account_id, title, provider, completed_year, valid_until_year, level, note)
  values (v_acct, c ->> 'title', c ->> 'provider', (c ->> 'completed_year')::smallint,
          (c ->> 'valid_until_year')::smallint, c ->> 'level', c ->> 'note')
  returning * into r;
  return app.seduh_course_json(r);
end;
$$;

-- a full replace (the form sends every field); a course that stops being current stops being the card's certificate
create function public.seduh_update_course(
  p_course_id bigint, p_title text, p_provider text, p_completed_year integer, p_valid_until_year integer default null,
  p_level text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct uuid := app.seduh_my_account(true);
  c      jsonb := app.seduh_course_clean(p_title, p_provider, p_completed_year, p_valid_until_year, p_level, p_note);
  r      app.seduh_courses;
begin
  update app.seduh_courses
     set title = c ->> 'title', provider = c ->> 'provider', completed_year = (c ->> 'completed_year')::smallint,
         valid_until_year = (c ->> 'valid_until_year')::smallint, level = c ->> 'level', note = c ->> 'note',
         on_card = on_card and app.seduh_course_current((c ->> 'valid_until_year')::smallint)
   where id = p_course_id and account_id = v_acct
  returning * into r;
  if not found then
    raise exception 'That course was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  return app.seduh_course_json(r);
end;
$$;

create function public.seduh_delete_course(p_course_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct uuid := app.seduh_my_account(true);
begin
  delete from app.seduh_courses where id = p_course_id and account_id = v_acct;
  if not found then
    raise exception 'That course was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

-- C6b: choose the ONE certificate for the story card, or pass null to clear it. Only a current course can be chosen.
create function public.seduh_set_card_course(p_course_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct uuid := app.seduh_my_account(true);
  v_cur  boolean;
begin
  update app.seduh_courses set on_card = false where account_id = v_acct and on_card;
  if p_course_id is null then
    return;
  end if;
  select app.seduh_course_current(c.valid_until_year) into v_cur
    from app.seduh_courses c where c.id = p_course_id and c.account_id = v_acct;
  if not found then
    raise exception 'That course was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not v_cur then
    raise exception 'That certificate has expired.' using errcode = 'P0001', hint = 'not_current';
  end if;
  update app.seduh_courses set on_card = true where id = p_course_id and account_id = v_acct;
end;
$$;

revoke all on function public.seduh_add_course(text, text, integer, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_update_course(bigint, text, text, integer, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_delete_course(bigint) from public, anon, authenticated, service_role;
revoke all on function public.seduh_set_card_course(bigint) from public, anon, authenticated, service_role;
grant execute on function public.seduh_add_course(text, text, integer, integer, text, text) to authenticated;
grant execute on function public.seduh_update_course(bigint, text, text, integer, integer, text, text) to authenticated;
grant execute on function public.seduh_delete_course(bigint) to authenticated;
grant execute on function public.seduh_set_card_course(bigint) to authenticated;

-- ============ seduh_set_my_settings: vis_courses added (everything else as in 20261125100000) ============

create or replace function public.seduh_set_my_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct  uuid := app.seduh_my_account(true);
  v_key   text;
  v_val   jsonb;
  v_vocab text[];
  s       app.seduh_profile_settings;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or p_settings = '{}'::jsonb then
    raise exception 'Nothing to change.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  for v_key, v_val in select * from jsonb_each(p_settings) loop
    if v_key in ('listed_on_country_pages', 'listed_in_search') then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'That setting is not allowed.' using errcode = 'P0001', hint = 'bad_setting';
      end if;
    else
      v_vocab := case v_key
        when 'vis_identity' then array['public', 'hidden']
        when 'vis_recorded_results' then array['public', 'organisers', 'hidden']
        when 'vis_organiser_results' then array['public', 'organisers', 'hidden']
        when 'vis_self_reported_results' then array['public', 'organisers', 'hidden']
        when 'vis_judging_roles' then array['public', 'organisers', 'hidden']
        when 'vis_cafe_affiliations' then array['public', 'hidden']
        when 'vis_knockout_record' then array['public', 'hidden']
        when 'vis_courses' then array['public', 'hidden']
      end;
      if v_vocab is null then
        raise exception 'That setting does not exist.' using errcode = 'P0001', hint = 'bad_setting';
      end if;
      if jsonb_typeof(v_val) <> 'string' or not ((v_val #>> '{}') = any (v_vocab)) then
        raise exception 'That choice is not allowed for this setting.' using errcode = 'P0001', hint = 'bad_setting';
      end if;
    end if;
  end loop;

  update app.seduh_profile_settings set
    vis_identity              = coalesce(p_settings ->> 'vis_identity', vis_identity),
    vis_recorded_results      = coalesce(p_settings ->> 'vis_recorded_results', vis_recorded_results),
    vis_organiser_results     = coalesce(p_settings ->> 'vis_organiser_results', vis_organiser_results),
    vis_self_reported_results = coalesce(p_settings ->> 'vis_self_reported_results', vis_self_reported_results),
    vis_judging_roles         = coalesce(p_settings ->> 'vis_judging_roles', vis_judging_roles),
    vis_cafe_affiliations     = coalesce(p_settings ->> 'vis_cafe_affiliations', vis_cafe_affiliations),
    vis_knockout_record       = coalesce(p_settings ->> 'vis_knockout_record', vis_knockout_record),
    vis_courses               = coalesce(p_settings ->> 'vis_courses', vis_courses),
    listed_on_country_pages   = coalesce((p_settings ->> 'listed_on_country_pages')::boolean, listed_on_country_pages),
    listed_in_search          = coalesce((p_settings ->> 'listed_in_search')::boolean, listed_in_search)
   where account_id = v_acct
  returning * into s;
  if not found then
    raise exception 'Sign in with your Seduh ID first.' using errcode = '42501', hint = 'no_account';
  end if;
  return jsonb_build_object(
    'vis_identity', s.vis_identity, 'vis_recorded_results', s.vis_recorded_results,
    'vis_organiser_results', s.vis_organiser_results, 'vis_self_reported_results', s.vis_self_reported_results,
    'vis_judging_roles', s.vis_judging_roles, 'vis_cafe_affiliations', s.vis_cafe_affiliations,
    'vis_knockout_record', s.vis_knockout_record, 'vis_courses', s.vis_courses,
    'listed_on_country_pages', s.listed_on_country_pages, 'listed_in_search', s.listed_in_search);
end;
$$;

-- ============ app.seduh_my_record_json: courses, counts.courses, limits.courses, vis_courses ============

create or replace function app.seduh_my_record_json(p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acct     jsonb;
  v_settings jsonb;
  v_entries  jsonb;
  v_links    jsonb;
  v_courses  jsonb;
  v_by_kind  jsonb;
begin
  select jsonb_build_object(
           'handle', a.handle, 'founding_number', a.founding_number, 'display_name', i.display_name,
           'country_code', i.country_code, 'claimed_on', (a.claimed_at at time zone 'UTC')::date,
           'profile_path', '/id/' || a.handle || '/',
           'photo_url', case when ph.photo_path is not null then app.seduh_photo_url(ph.photo_path) end,
           'photo_updated_at', ph.photo_updated_at)
    into v_acct
    from app.seduh_accounts a join app.seduh_identities i on i.id = a.identity_id
    left join app.seduh_account_photos ph on ph.account_id = a.id
   where a.id = p_account;

  select jsonb_build_object(
           'vis_identity', s.vis_identity, 'vis_recorded_results', s.vis_recorded_results,
           'vis_organiser_results', s.vis_organiser_results, 'vis_self_reported_results', s.vis_self_reported_results,
           'vis_judging_roles', s.vis_judging_roles, 'vis_cafe_affiliations', s.vis_cafe_affiliations,
           'vis_knockout_record', s.vis_knockout_record, 'vis_courses', s.vis_courses,
           'listed_on_country_pages', s.listed_on_country_pages, 'listed_in_search', s.listed_in_search)
    into v_settings
    from app.seduh_profile_settings s where s.account_id = p_account;

  select coalesce(jsonb_agg(app.seduh_entry_json(e) order by e.year desc, e.created_at desc, e.id desc), '[]'::jsonb)
    into v_entries from app.seduh_self_reported_entries e where e.account_id = p_account;

  -- every link, including one whose team has since been unlisted (the person sees it and can remove it; `listed` says so)
  select coalesce(jsonb_agg(app.seduh_link_json(m.id) order by h.edition_year desc, h.team_name, m.id), '[]'::jsonb)
    into v_links
    from app.seduh_team_memberships m join app.historical_results h on h.id = m.result_id
   where m.account_id = p_account;

  -- the person sees ALL their courses, whatever vis_courses says
  select coalesce(jsonb_agg(app.seduh_course_json(c) order by c.completed_year desc, c.created_at desc, c.id desc), '[]'::jsonb)
    into v_courses from app.seduh_courses c where c.account_id = p_account;

  -- derived on read, never stored
  select jsonb_object_agg(k.kind, coalesce(c.n, 0))
    into v_by_kind
    from (values ('competed'), ('judged'), ('organised'), ('coached'), ('volunteered')) k(kind)
    left join (select kind, count(*)::integer as n from app.seduh_self_reported_entries where account_id = p_account group by kind) c
      on c.kind = k.kind;

  return jsonb_build_object(
    'account', v_acct,
    'settings', coalesce(v_settings, '{}'::jsonb),
    'entries', v_entries,
    'team_links', v_links,
    'courses', v_courses,
    -- courses have their OWN count: `entries` stays the competitions only
    'counts', jsonb_build_object(
      'entries', jsonb_array_length(v_entries), 'by_kind', v_by_kind, 'team_links', jsonb_array_length(v_links),
      'courses', jsonb_array_length(v_courses)),
    'limits', jsonb_build_object('entries', 200, 'team_links', 40, 'courses', 60));
end;
$$;

-- ============ public.public_seduh_profile: `courses` (everything else as in 20261123100000) ============

create or replace function public.public_seduh_profile(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle    text := lower(btrim(coalesce(p_handle, '')));
  v_acc_id    uuid;
  v_identity  uuid;
  v_found     boolean := false;
  v_name      text;
  v_country   text;
  v_founding  integer;
  v_claimed   date;
  v_vis_id    text;
  v_vis_rec   text;
  v_vis_ko    text;
  v_vis_org   text;
  v_vis_self  text;
  v_vis_crs   text;
  v_photo     text;
  v_orgrec    jsonb := '[]'::jsonb;
  v_self      jsonb := '[]'::jsonb;
  v_courses   jsonb := '[]'::jsonb;
  v_ident     jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_won       integer := 0;
  v_lost      integer := 0;
  v_opps      jsonb := '[]'::jsonb;
begin
  -- Input: the same SHAPE rule as the account table. The watch list is NOT consulted here (20261121100000): a handle is permanent, a
  -- term added later must never unpublish an existing profile, and a blocked handle cannot have an account anyway. Anything else gets the empty shape below.
  if v_handle ~ '^[a-z0-9](-?[a-z0-9])*$'
     and char_length(v_handle) between 3 and 30 then
    select a.id, a.identity_id, i.display_name, i.country_code, a.founding_number,
           (a.claimed_at at time zone 'UTC')::date,
           -- a missing settings row (the account trigger makes one) fails closed
           coalesce(s.vis_identity, 'hidden'), coalesce(s.vis_recorded_results, 'hidden'),
           coalesce(s.vis_knockout_record, 'hidden'),
           coalesce(s.vis_organiser_results, 'hidden'), coalesce(s.vis_self_reported_results, 'hidden'),
           coalesce(s.vis_courses, 'hidden'),
           ph.photo_path
      into v_acc_id, v_identity, v_name, v_country, v_founding, v_claimed, v_vis_id, v_vis_rec, v_vis_ko, v_vis_org, v_vis_self,
           v_vis_crs, v_photo
      from app.seduh_accounts a
      join app.seduh_identities i on i.id = a.identity_id
      left join app.seduh_profile_settings s on s.account_id = a.id
      left join app.seduh_account_photos ph on ph.account_id = a.id
     where a.handle = v_handle
       and a.closed_at is null
       and a.adult_attested_at is not null
       and i.status = 'active';
    v_found := found;
  end if;

  if not v_found then
    return jsonb_build_object(
      'has_profile', false,
      'handle', null,
      'identity', jsonb_build_object('display_name', null, 'country_code', null, 'founding_number', null,
                                     'claimed_on', null, 'photo_url', null),
      'recorded_results', '[]'::jsonb,
      'knockout_record', jsonb_build_object('won', 0, 'lost', 0, 'opponents', '[]'::jsonb),
      'organiser_records', '[]'::jsonb,
      'self_reported', '[]'::jsonb,
      'courses', '[]'::jsonb,
      'judging_roles', '[]'::jsonb,
      'cafe_affiliations', '[]'::jsonb);
  end if;

  -- Identity block: public or hidden. A hidden block has the same keys, all null.
  if v_vis_id = 'public' then
    v_ident := jsonb_build_object('display_name', v_name, 'country_code', v_country, 'founding_number', v_founding,
                                  'claimed_on', v_claimed,
                                  -- C2: a RELATIVE path under the project's public Storage; the page prefixes its own Supabase URL
                                  'photo_url', case when v_photo is not null then app.seduh_photo_url(v_photo) end);
  else
    v_ident := jsonb_build_object('display_name', null, 'country_code', null, 'founding_number', null,
                                  'claimed_on', null, 'photo_url', null);
  end if;

  -- ============ recorded results (Cup Taster, from the published payload) ============
  if v_vis_rec = 'public' then
    select coalesce(jsonb_agg(r.j order by r.sort_date desc nulls last, r.published_at desc, r.ord), '[]'::jsonb)
      into v_results
      from (
        select c.published_at, c.ord,
               c.event_date as sort_date,
               jsonb_build_object(
                 'event_name',     coalesce(nullif(left(btrim(c.payload ->> 'eventName'), 120), ''), c.event_name),
                 'format',         c.format,
                 'organiser_name', c.org_name,
                 'event_date',     c.event_date,
                 'placing',        case when c.place_txt ~ '^[0-9]{1,4}$' then c.place_txt::integer end,
                 'stage',          nullif(left(btrim(c.stage_txt), 60), ''),
                 -- the page shows a score only when BOTH figures are there
                 'correct',        case when c.correct_txt ~ '^[0-9]{1,4}$' and c.total_txt ~ '^[0-9]{1,4}$' then c.correct_txt::integer end,
                 'total',          case when c.correct_txt ~ '^[0-9]{1,4}$' and c.total_txt ~ '^[0-9]{1,4}$' then c.total_txt::integer end,
                 'time_secs',      case when c.time_txt ~ '^[0-9]{1,6}$' then c.time_txt::integer end,
                 'provenance',     'seduh_score') as j
          from (
            select pr.published_at, pr.payload, e.format, e.name as event_name, e.event_date, o.name as org_name,
                   x.elem, x.ord, x.nm, x.cf,
                   -- only the keys the results page itself reads: a podium row has rank, correct and total (no round, no
                   -- time); a standings row has place, round, correct, total and timeSecs
                   case when x.is_standings then x.elem ->> 'place' else x.elem ->> 'rank' end as place_txt,
                   case when x.is_standings then x.elem ->> 'round' end as stage_txt,
                   x.elem ->> 'correct' as correct_txt, x.elem ->> 'total' as total_txt,
                   case when x.is_standings then x.elem ->> 'timeSecs' end as time_txt,
                   -- the same name and cafe twice in one publication names nobody
                   count(*) over (partition by pr.id, x.nm, x.cf) as same_rows,
                   -- the feed's rule: exactly one roster entry of the event carries that name and cafe
                   (select count(*) from public.event_entries en2
                     where en2.event_id = e.id and btrim(en2.display_name) = x.nm
                       and coalesce(btrim(en2.cafe), '') = x.cf) as same_entries,
                   en.id as entry_id
              from public.people pe
              join public.event_entries en on en.person_id = pe.id
              join public.events e on e.id = en.event_id and e.org_id = pe.org_id
              join public.orgs o on o.id = e.org_id
              join public.public_results pr on pr.event_id = e.id
              cross join lateral (
                select s.elem, s.ord, btrim(s.elem ->> 'name') as nm, coalesce(btrim(s.elem ->> 'cafe'), '') as cf,
                       (jsonb_typeof(pr.payload -> 'standings') = 'array' and jsonb_array_length(pr.payload -> 'standings') > 0) as is_standings
                  from jsonb_array_elements(
                         case when jsonb_typeof(pr.payload -> 'standings') = 'array'
                                   and jsonb_array_length(pr.payload -> 'standings') > 0
                              then pr.payload -> 'standings'
                              when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium'
                              else '[]'::jsonb end) with ordinality as s(elem, ord)
                 where jsonb_typeof(s.elem) = 'object' and nullif(btrim(s.elem ->> 'name'), '') is not null
              ) x
             where pe.global_person_id = v_identity
               and e.is_test is not true
               -- SEAM is_shadow: when MARCH-2027-BOARD-PLAN P1 adds events.is_shadow, add `and e.is_shadow is not true`.
               -- A shadow-run result must never reach a profile; there is no flag to test yet.
               and e.format = 'cup_taster'          -- the payload shape read below is Cup Taster's
               and x.nm = btrim(en.display_name)
               and x.cf = coalesce(btrim(en.cafe), '')
          ) c
         where c.same_rows = 1 and c.same_entries = 1
      ) r;
  end if;

  -- ============ knockout record: SEAM (see the header). Nothing is read; v_won, v_lost and v_opps stay at their zero values. ============
  -- v_vis_ko is kept for the seam: when it is filled, a value other than 'public' must keep these zeros.

  -- ============ organiser records: the person's TEAM LINKS (20261122100000) ============
  -- The team result is the organiser's ("organiser_archive"); the membership is the person's own claim until the owner confirms
  -- it ('self_reported' or 'confirmed'). Only a LISTED team result shows (an unlisted row is a complete removal). 'organisers'
  -- is hidden to an anonymous caller. No id, no internal key.
  if v_vis_org = 'public' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'competition', h.competition, 'competition_name', h.competition_name, 'edition_year', h.edition_year,
               'team_name', h.team_name, 'country_code', h.country_code, 'stage_reached', h.stage_reached,
               'placement', h.placement, 'role', m.role, 'membership', m.status, 'provenance', 'organiser_archive')
             order by h.edition_year desc, h.competition, h.team_name), '[]'::jsonb)
      into v_orgrec
      from app.seduh_team_memberships m
      join app.historical_results h on h.id = m.result_id
     where m.account_id = v_acc_id and h.listed;
  end if;

  -- ============ self-reported entries (20261122100000): never "recorded", always labelled ============
  if v_vis_self = 'public' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'year', e.year, 'competition_name', e.competition_name, 'location', e.location, 'kind', e.kind,
               'role', e.role, 'result_text', e.result_text, 'placement', e.placement, 'note', e.note,
               'provenance', 'self_reported')
             order by e.year desc, e.created_at desc, e.id desc), '[]'::jsonb)
      into v_self
      from app.seduh_self_reported_entries e
     where e.account_id = v_acc_id;
  end if;

  -- ============ courses (this migration): only while vis_courses = 'public'; no id; `current` is decided here, in SQL ============
  if v_vis_crs = 'public' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'title', c.title, 'provider', c.provider, 'completed_year', c.completed_year,
               'valid_until_year', c.valid_until_year, 'level', c.level, 'note', c.note,
               'current', app.seduh_course_current(c.valid_until_year),
               -- the card's certificate: only one, only while current (the page draws the "Certified" line from this flag)
               'on_card', c.on_card and app.seduh_course_current(c.valid_until_year),
               'status', c.status, 'confirmed_by', c.confirmed_by, 'provenance', 'self_reported')
             order by c.completed_year desc, c.created_at desc, c.id desc), '[]'::jsonb)
      into v_courses
      from app.seduh_courses c
     where c.account_id = v_acc_id;
  end if;

  return jsonb_build_object(
    'has_profile', true,
    'handle', v_handle,
    'identity', v_ident,
    'recorded_results', v_results,
    'knockout_record', jsonb_build_object('won', coalesce(v_won, 0), 'lost', coalesce(v_lost, 0), 'opponents', v_opps),
    'organiser_records', v_orgrec,
    'self_reported', v_self,
    'courses', v_courses,
    'judging_roles', '[]'::jsonb,       -- SEAM: needs a judge-to-identity link (BTC judges have no people row)
    'cafe_affiliations', '[]'::jsonb);  -- SEAM: two-sided acceptance is not modelled yet
end;
$$;

revoke all on function public.public_seduh_profile(text) from public, anon, authenticated, service_role;
grant execute on function public.public_seduh_profile(text) to anon, authenticated;
