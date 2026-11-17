-- Seduh Score Next · T-ID2.C5: Seduh ID DISCOVERY (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md section 14.8)
--
-- What this adds:
--   * ONE on/off switch, app.seduh_discovery_switch (a single row, `enabled` false). It is enforced HERE, in SQL: while it is
--     off every discovery door answers `open: false` with nothing in it, so no page can show anything by being edited. The
--     table has RLS on, no policy and no API grant; only the owner flips it (CONVENTIONS.md, "Seduh ID discovery").
--   * a new privacy setting `listed_in_search` ("Show me in Seduh ID search"), ON by default, editable through the existing
--     `seduh_set_my_settings` door (redefined here) and returned by `seduh_my_record` (app.seduh_my_record_json redefined).
--   * four anonymous SECURITY DEFINER doors (the pattern of public_seduh_profile, 20261116100000):
--       public.seduh_discovery_open()                 -> boolean, the switch (landing box and results links ask this)
--       public.seduh_discovery_search(query, country) -> {open, results[], more}
--       public.seduh_discovery_countries()            -> {open, countries[{country_code, people}]}
--       public.seduh_results_profile_links(event_id)  -> {open, links[{name, cafe, handle}]} for one PUBLISHED event
--   * three owner-only helpers in `app` (no API grant): seduh_discovery_open(), seduh_discovery_people(boolean) and
--     seduh_published_matches(uuid, uuid).
--
-- WHO CAN EVER COME BACK (app.seduh_discovery_people, the one place the rule lives): the switch is open AND the account is
-- claimed, OPEN (not closed), 18-attested, on an ACTIVE identity, AND vis_identity = 'public' (a hidden name never comes back:
-- the profile would show no name either). Search and country browse also require listed_in_search. The results-page link does
-- NOT require listed_in_search (it is not search; the person's name is already printed on the public results page) but does
-- require vis_recorded_results = 'public', so the page it opens really shows that result. An unclaimed person has no account
-- row and so can never come back. Nothing is returned beyond what the public profile already shows: handle, public name,
-- country, and the relative photo path (the profile's own `photo_url`, a public Storage path read by exact address).
-- NEVER RETURNED: a uuid or internal id, email, phone, settings, or a count of anyone who is hidden or opted out.
--
-- CAFE MATCH: a query also matches the cafe printed on a person's PUBLISHED results (the payload rows the profile itself
-- would show, same one-name-one-roster-entry rule, app.seduh_published_matches), and only while their vis_recorded_results is
-- public. The cafe is matched, never returned. A roster cafe that was edited after publishing matches nothing (same as the profile).
--
-- LIMITS (the cost of an anonymous door): query 2 to 40 characters (anything else returns no results, no error); search returns
-- at most 20, a country browse at most 60, with `more: true` when there were more; LIKE wildcards in the query are escaped;
-- the country must be two letters. There is no paging, so the door cannot be walked row by row. SQL cannot rate-limit a caller by
-- itself; the platform's request limits apply on top. Enumeration of listed people by prefix is the product (it is a search box),
-- and is why the person controls `listed_in_search`.
--
-- ROLLBACK (the switch and doors hold no data worth keeping; the column holds people's choice, so do not roll back once used):
-- rollback:
--   -- restore the previous seduh_set_my_settings (20261122100000_seduh_my_record.sql) and app.seduh_my_record_json
--   -- (20261123100000_seduh_photo.sql) by re-running those two `create` statements as `create or replace`, then:
--   drop function if exists public.seduh_results_profile_links(uuid);
--   drop function if exists public.seduh_discovery_countries();
--   drop function if exists public.seduh_discovery_search(text, text);
--   drop function if exists public.seduh_discovery_open();
--   drop function if exists app.seduh_published_matches(uuid, uuid);
--   drop function if exists app.seduh_discovery_people(boolean);
--   drop function if exists app.seduh_discovery_open();
--   drop table if exists app.seduh_discovery_switch;
--   alter table app.seduh_profile_settings drop column if exists listed_in_search;

-- ============ the switch ============

create table app.seduh_discovery_switch (
  id         boolean primary key default true,
  enabled    boolean not null default false,
  changed_at timestamptz not null default now(),
  constraint seduh_discovery_switch_single check (id)
);
insert into app.seduh_discovery_switch (id, enabled) values (true, false);
alter table app.seduh_discovery_switch enable row level security;
revoke all on app.seduh_discovery_switch from public, anon, authenticated, service_role;

-- a missing row reads as CLOSED (fails closed)
create function app.seduh_discovery_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select s.enabled from app.seduh_discovery_switch s where s.id), false) $$;
revoke all on function app.seduh_discovery_open() from public, anon, authenticated, service_role;

-- ============ the new setting ============

alter table app.seduh_profile_settings add column listed_in_search boolean not null default true;

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
    'vis_knockout_record', s.vis_knockout_record, 'listed_on_country_pages', s.listed_on_country_pages,
    'listed_in_search', s.listed_in_search);
end;
$$;

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
           'vis_knockout_record', s.vis_knockout_record, 'listed_on_country_pages', s.listed_on_country_pages,
           'listed_in_search', s.listed_in_search)
    into v_settings
    from app.seduh_profile_settings s where s.account_id = p_account;

  select coalesce(jsonb_agg(app.seduh_entry_json(e) order by e.year desc, e.created_at desc, e.id desc), '[]'::jsonb)
    into v_entries from app.seduh_self_reported_entries e where e.account_id = p_account;

  -- every link, including one whose team has since been unlisted (the person sees it and can remove it; `listed` says so)
  select coalesce(jsonb_agg(app.seduh_link_json(m.id) order by h.edition_year desc, h.team_name, m.id), '[]'::jsonb)
    into v_links
    from app.seduh_team_memberships m join app.historical_results h on h.id = m.result_id
   where m.account_id = p_account;

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
    'counts', jsonb_build_object(
      'entries', jsonb_array_length(v_entries), 'by_kind', v_by_kind, 'team_links', jsonb_array_length(v_links)),
    'limits', jsonb_build_object('entries', 200, 'team_links', 40));
end;
$$;

-- ============ helpers (owner-only: no API role) ============

-- The ONE rule for who discovery may return. Empty while the switch is off. p_search_only also requires listed_in_search.
create function app.seduh_discovery_people(p_search_only boolean)
returns table (identity_id uuid, handle text, display_name text, country_code text, photo_path text, vis_recorded text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.identity_id, a.handle, i.display_name, i.country_code, ph.photo_path, s.vis_recorded_results
    from app.seduh_accounts a
    join app.seduh_identities i on i.id = a.identity_id
    join app.seduh_profile_settings s on s.account_id = a.id
    left join app.seduh_account_photos ph on ph.account_id = a.id
   where app.seduh_discovery_open()
     and a.closed_at is null
     and a.adult_attested_at is not null
     and i.status = 'active'
     and s.vis_identity = 'public'
     and (not coalesce(p_search_only, true) or s.listed_in_search)
$$;
revoke all on function app.seduh_discovery_people(boolean) from public, anon, authenticated, service_role;

-- Which payload rows of PUBLISHED events name a linked identity: the rule of public.public_seduh_profile (exactly one roster
-- entry with that trimmed name and cafe, that entry's person linked to the identity, exactly one payload row with that name and
-- cafe, a non-test Cup Taster event). Either filter may be null (all). Returns text and ids only; callers decide what to show.
create function app.seduh_published_matches(p_event uuid, p_identity uuid)
returns table (event_id uuid, nm text, cf text, identity_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.event_id, c.nm, c.cf, c.gid
    from (
      select e.id as event_id, x.nm, x.cf, pe.global_person_id as gid,
             count(*) over (partition by pr.id, x.nm, x.cf) as same_rows,
             (select count(*) from public.event_entries en2
               where en2.event_id = e.id and btrim(en2.display_name) = x.nm
                 and coalesce(btrim(en2.cafe), '') = x.cf) as same_entries
        from public.people pe
        join public.event_entries en on en.person_id = pe.id
        join public.events e on e.id = en.event_id and e.org_id = pe.org_id
        join public.public_results pr on pr.event_id = e.id
        cross join lateral (
          select btrim(s.elem ->> 'name') as nm, coalesce(btrim(s.elem ->> 'cafe'), '') as cf
            from jsonb_array_elements(
                   case when jsonb_typeof(pr.payload -> 'standings') = 'array'
                             and jsonb_array_length(pr.payload -> 'standings') > 0
                        then pr.payload -> 'standings'
                        when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium'
                        else '[]'::jsonb end) as s(elem)
           where jsonb_typeof(s.elem) = 'object' and nullif(btrim(s.elem ->> 'name'), '') is not null
        ) x
       where pe.global_person_id is not null
         and (p_identity is null or pe.global_person_id = p_identity)
         and (p_event is null or e.id = p_event)
         and e.is_test is not true
         -- SEAM is_shadow: add `and e.is_shadow is not true` where the profile door does (MARCH-2027-BOARD-PLAN P1).
         and e.format = 'cup_taster'
         and x.nm = btrim(en.display_name)
         and x.cf = coalesce(btrim(en.cafe), '')
    ) c
   where c.same_rows = 1 and c.same_entries = 1
$$;
revoke all on function app.seduh_published_matches(uuid, uuid) from public, anon, authenticated, service_role;

-- ============ the anonymous doors ============

create function public.seduh_discovery_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.seduh_discovery_open() $$;

create function public.seduh_discovery_search(p_query text, p_country text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open    boolean := app.seduh_discovery_open();
  v_q       text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_pat     text;
  v_prefix  text;
  v_cap     integer;
  v_rows    jsonb;
  v_n       integer;
begin
  if not v_open then
    return jsonb_build_object('open', false, 'results', '[]'::jsonb, 'more', false);
  end if;
  -- shape limits: a bad query or country answers "nothing", never an error and never a wide read
  if (v_q <> '' and char_length(v_q) not between 2 and 40) or (v_country <> '' and v_country !~ '^[A-Z]{2}$')
     or (v_q = '' and v_country = '') then
    return jsonb_build_object('open', true, 'results', '[]'::jsonb, 'more', false);
  end if;
  v_cap := case when v_q = '' then 60 else 20 end;
  v_pat := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_prefix := replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(jsonb_build_object(
                    'handle', r.handle, 'display_name', r.display_name, 'country_code', r.country_code,
                    'photo_url', case when r.photo_path is not null then app.seduh_photo_url(r.photo_path) end)
                  order by r.rank, lower(r.display_name), r.handle), '[]'::jsonb),
         count(*)
    into v_rows, v_n
    from (
      select p.*, case when v_q <> '' and (lower(p.display_name) like v_prefix escape '\' or p.handle like v_prefix escape '\') then 0 else 1 end as rank
        from app.seduh_discovery_people(true) p
       where (v_country = '' or upper(coalesce(p.country_code, '')) = v_country)
         and (v_q = ''
              or lower(p.display_name) like v_pat escape '\'
              or p.handle like v_pat escape '\'
              or (p.vis_recorded = 'public'
                  and exists (select 1 from app.seduh_published_matches(null, p.identity_id) m
                               where m.cf <> '' and lower(m.cf) like v_pat escape '\')))
       order by rank, lower(p.display_name), p.handle
       limit v_cap + 1
    ) r;
  -- the inner query returned cap+1 rows at most; drop the extra one from the answer
  if v_n > v_cap then
    select coalesce(jsonb_agg(e.elem order by e.ord), '[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows) with ordinality e(elem, ord) where e.ord <= v_cap;
  end if;
  return jsonb_build_object('open', true, 'results', v_rows, 'more', v_n > v_cap);
end;
$$;

create function public.seduh_discovery_countries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open boolean := app.seduh_discovery_open();
  v_list jsonb;
begin
  if not v_open then
    return jsonb_build_object('open', false, 'countries', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('country_code', g.cc, 'people', g.n) order by g.n desc, g.cc), '[]'::jsonb)
    into v_list
    from (select upper(p.country_code) as cc, count(*)::integer as n
            from app.seduh_discovery_people(true) p
           where p.country_code ~ '^[A-Za-z]{2}$'
           group by upper(p.country_code)) g;
  return jsonb_build_object('open', true, 'countries', v_list);
end;
$$;

create function public.seduh_results_profile_links(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open  boolean := app.seduh_discovery_open();
  v_links jsonb;
begin
  if not v_open or p_event_id is null then
    return jsonb_build_object('open', v_open, 'links', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', m.nm, 'cafe', m.cf, 'handle', p.handle) order by m.nm, m.cf), '[]'::jsonb)
    into v_links
    from app.seduh_published_matches(p_event_id, null) m
    join app.seduh_discovery_people(false) p on p.identity_id = m.identity_id and p.vis_recorded = 'public';
  return jsonb_build_object('open', true, 'links', v_links);
end;
$$;

revoke all on function public.seduh_discovery_open() from public, anon, authenticated, service_role;
revoke all on function public.seduh_discovery_search(text, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_discovery_countries() from public, anon, authenticated, service_role;
revoke all on function public.seduh_results_profile_links(uuid) from public, anon, authenticated, service_role;
grant execute on function public.seduh_discovery_open() to anon, authenticated;
grant execute on function public.seduh_discovery_search(text, text) to anon, authenticated;
grant execute on function public.seduh_discovery_countries() to anon, authenticated;
grant execute on function public.seduh_results_profile_links(uuid) to anon, authenticated;
