-- Seduh Score Next · T-ID2.D-a: a claimed person's OWN record, the backend (self-reported entries and team links)
-- (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md sections 4, 6, 10, 14.4, 14.5; the screens are D-b.)
--
-- What this adds:
--   * app.seduh_self_reported_entries: a person's own list of competitions, with MINIMAL fields (year, competition name,
--     location, kind, role, result text, an optional placement, a note). Never counted as "recorded"; the page labels it
--     "Self-reported, not verified by Seduh". Owner-only table (RLS on, no policy, no API grant), like every Seduh ID table.
--   * app.seduh_team_memberships: a person's link to ONE TEAM IN ONE YEAR (one app.historical_results row: Bean Bandits, BN,
--     ASEAN BTC 2024), never to a team name across years. Two-part provenance: the team result is "From the organiser's
--     records"; the membership is `self_reported` until the OWNER confirms it, then `confirmed`.
--   * the person's own doors (public schema, SECURITY DEFINER, authenticated only, each opening with the same check: the caller's
--     auth.uid() owns an OPEN, attested account on an active identity; anything else is one 42501 "no_account"):
--       seduh_my_record, seduh_add_entry, seduh_update_entry, seduh_delete_entry, seduh_team_options, seduh_add_team_link,
--       seduh_remove_team_link, seduh_set_my_settings.
--   * owner-only functions in `app` (no API grant), each AUDITED: seduh_memberships_overview, seduh_membership_confirm,
--     seduh_membership_unconfirm, seduh_membership_remove. The audit table is app.seduh_claim_audit (3 actions added).
--   * public.public_seduh_profile redefined: fills `self_reported` and `organiser_records`. public.public_country_record
--     redefined: each team row gets `members`.
--
-- DESIGN CHOICES (the spec left these open):
--   1. NO UUID IN ANY SIGNATURE. Entries and memberships carry a bigint identity id, only meaningful together with the
--      caller's own account (every write is `where id = ... and account_id = <caller's account>`), and an id that is not the
--      caller's answers exactly like one that does not exist (`not_found`), so nobody learns that another person's row exists.
--      The team picker's key is a one-way hash of the historical result's uuid (app.seduh_team_key): opaque and stable (the
--      row's id never changes; a corrected team name keeps its links), it exposes no internal id, and only a LISTED row can be
--      resolved (an unlisted one answers `team_not_found`, like an unknown key). A side effect: the 041 matrix, which guards
--      doors that take an organisation-owned uuid, has nothing to say about these doors, so none is added there; 037 and 062
--      pin them instead (see the tests).
--   2. ENTRIES ARE TIED TO THE ACCOUNT, not the identity. The account is what the person claims, closes and (after an undo)
--      re-claims; a closed account's entries stay in the table and are never shown or readable. PDPO deletion on close is C4.
--   3. THE PERSON NEVER CONFIRMS THEIR OWN MEMBERSHIP, and nobody else can ADD one. A membership is created only by the person
--      who is on it. Confirmation is the owner's, through the owner functions below. The columns for a teammate's confirmation
--      (`confirmed_via = 'teammate'`, `confirmed_by_account`) and their shape check exist, but nothing writes them: that is the
--      marked SEAM for a later phase. Changing a role means removing the link and adding it again, which also drops a confirmation.
--   4. WHO SHOWS ON A COUNTRY PAGE: `listed_on_country_pages` (default false) AND vis_identity = 'public' AND
--      vis_organiser_results = 'public' AND an open, attested, active account. The last two make the listing at least as
--      private as the person's own page (a person who hides organiser results is not listed through the back door).
--   5. THE AUDIT. Owner confirm, unconfirm and remove write an app.seduh_claim_audit row in the same transaction (three new
--      actions). The person's own add, edit and delete are NOT audited (their own data, in a table that nobody else can reach).
--   6. CAPS (a person is not a data store): 200 entries and 40 team links per account, enforced under a lock on the account row.
--   7. TEXT. Every free-text field is trimmed, has a length cap, and refuses control characters and invisible direction
--      overrides (the page prints them). It is never HTML-interpreted; the page must use textContent.
--
-- The privacy settings table already exists (20261115120000); `vis_self_reported_results` governs entries and
-- `vis_organiser_results` governs team links, both with the three values public / organisers / hidden, where 'organisers' is
-- hidden to an anonymous caller (as everywhere).
--
-- ROLLBACK LOSES the people's entries and links: do not roll back a populated table.
--
-- rollback:
--   -- restore the previous two doors first: re-run public.public_seduh_profile from 20261121100000_seduh_handle_blocklist.sql
--   -- and public.public_country_record from 20261113120000_country_history.sql (create or replace), then:
--   drop function if exists public.seduh_set_my_settings(jsonb);
--   drop function if exists public.seduh_remove_team_link(bigint);
--   drop function if exists public.seduh_add_team_link(text, text);
--   drop function if exists public.seduh_team_options(text, text);
--   drop function if exists public.seduh_delete_entry(bigint);
--   drop function if exists public.seduh_update_entry(bigint, integer, text, text, text, text, text, integer, text);
--   drop function if exists public.seduh_add_entry(integer, text, text, text, text, text, integer, text);
--   drop function if exists public.seduh_my_record();
--   drop function if exists app.seduh_membership_remove(bigint, text);
--   drop function if exists app.seduh_membership_unconfirm(bigint, text);
--   drop function if exists app.seduh_membership_confirm(bigint, text);
--   drop function if exists app.seduh_memberships_overview();
--   drop function if exists app.seduh_my_record_json(uuid);
--   drop function if exists app.seduh_link_json(bigint);
--   drop function if exists app.seduh_entry_json(app.seduh_self_reported_entries);
--   drop function if exists app.seduh_my_account(boolean);
--   drop function if exists app.seduh_team_key(uuid);
--   drop function if exists app.seduh_entry_clean(integer, text, text, text, text, text, integer, text);
--   drop function if exists app.seduh_clean_text(text, integer, boolean, text);
--   drop table if exists app.seduh_team_memberships;
--   drop table if exists app.seduh_self_reported_entries;
--   drop function if exists app.seduh_text_ok(text);
--   alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
--   alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
--     check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo'));
--   (the last statement fails once a membership.* audit row exists: the history is append-only, keep the constraint wider then.)

-- ============ text: one rule ============

-- no control characters, soft hyphen, line/paragraph separators, tag characters, zero-width or direction-override characters (a name that reads backwards on a public page)
create function app.seduh_text_ok(p_text text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_text is null
      or (p_text = btrim(p_text)
          and p_text !~ '[[:cntrl:]]'
          and p_text !~ E'[\\u00AD\\u061C\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2069\\uFEFF\\U000E0000-\\U000E007F]');
$$;
revoke all on function app.seduh_text_ok(text) from public, anon, authenticated, service_role;

-- trims, refuses a bad value with the field's own hint, and returns NULL for an empty optional field
create function app.seduh_clean_text(p_text text, p_max integer, p_required boolean, p_hint text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_text, ''));
begin
  if v = '' then
    if p_required then
      raise exception 'Please fill this in.' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if char_length(v) > p_max or not app.seduh_text_ok(v) then
    raise exception 'That text is not allowed.' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end;
$$;
revoke all on function app.seduh_clean_text(text, integer, boolean, text) from public, anon, authenticated, service_role;

-- ============ self-reported entries ============

create table app.seduh_self_reported_entries (
  id               bigint generated always as identity primary key,
  account_id       uuid not null references app.seduh_accounts (id) on delete restrict,
  year             smallint not null,
  competition_name text not null,
  location         text,
  kind             text not null,
  role             text,
  result_text      text,
  placement        smallint,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- a fixed range: a CHECK cannot use now() safely (a restore would re-test it); the door refuses a year beyond next year
  constraint seduh_self_reported_entries_year_range check (year between 1980 and 2100),
  constraint seduh_self_reported_entries_kind_vocab
    check (kind in ('competed', 'judged', 'organised', 'coached', 'volunteered')),
  constraint seduh_self_reported_entries_competition_name_length
    check (char_length(competition_name) between 1 and 120 and app.seduh_text_ok(competition_name)),
  constraint seduh_self_reported_entries_location_length
    check (location is null or (char_length(location) between 1 and 80 and app.seduh_text_ok(location))),
  constraint seduh_self_reported_entries_role_length
    check (role is null or (char_length(role) between 1 and 60 and app.seduh_text_ok(role))),
  constraint seduh_self_reported_entries_result_length
    check (result_text is null or (char_length(result_text) between 1 and 80 and app.seduh_text_ok(result_text))),
  constraint seduh_self_reported_entries_placement_range check (placement is null or placement between 1 and 500),
  constraint seduh_self_reported_entries_note_length
    check (note is null or (char_length(note) between 1 and 500 and app.seduh_text_ok(note)))
);
create index seduh_self_reported_entries_account_idx on app.seduh_self_reported_entries (account_id, year desc);

create trigger trg_seduh_self_reported_entries_parent_immutable
  before update of id, account_id on app.seduh_self_reported_entries
  for each row execute function app.forbid_parent_change('id', 'account_id');
create trigger trg_seduh_self_reported_entries_set_updated_at
  before update on app.seduh_self_reported_entries
  for each row execute function app.set_updated_at();

-- ============ team memberships ============

create table app.seduh_team_memberships (
  id                   bigint generated always as identity primary key,
  account_id           uuid not null references app.seduh_accounts (id) on delete restrict,
  result_id            uuid not null references app.historical_results (id) on delete restrict,
  role                 text not null default 'member',
  status               text not null default 'self_reported',
  -- how it was confirmed: the owner today; a claimed teammate is the SEAM (nothing writes 'teammate' yet)
  confirmed_via        text,
  confirmed_by_account uuid references app.seduh_accounts (id) on delete restrict,
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint seduh_team_memberships_one_per_team unique (account_id, result_id),
  constraint seduh_team_memberships_role_vocab check (role in ('member', 'captain', 'coach', 'reserve')),
  constraint seduh_team_memberships_status_vocab check (status in ('self_reported', 'confirmed')),
  constraint seduh_team_memberships_confirmation_shape check (
    (status = 'self_reported' and confirmed_via is null and confirmed_by_account is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_at is not null and (
          (confirmed_via = 'owner' and confirmed_by_account is null)
          or (confirmed_via = 'teammate' and confirmed_by_account is not null and confirmed_by_account <> account_id))))
);
create index seduh_team_memberships_result_idx on app.seduh_team_memberships (result_id);
create index seduh_team_memberships_confirmed_by_idx on app.seduh_team_memberships (confirmed_by_account)
  where confirmed_by_account is not null;

create trigger trg_seduh_team_memberships_parent_immutable
  before update of id, account_id, result_id on app.seduh_team_memberships
  for each row execute function app.forbid_parent_change('id', 'account_id', 'result_id');
create trigger trg_seduh_team_memberships_set_updated_at
  before update on app.seduh_team_memberships
  for each row execute function app.set_updated_at();

-- access: owner only, like every Seduh ID table
alter table app.seduh_self_reported_entries enable row level security;
alter table app.seduh_team_memberships enable row level security;
revoke all on app.seduh_self_reported_entries from public, anon, authenticated, service_role;
revoke all on app.seduh_team_memberships from public, anon, authenticated, service_role;
revoke all on sequence app.seduh_self_reported_entries_id_seq from public, anon, authenticated, service_role;
revoke all on sequence app.seduh_team_memberships_id_seq from public, anon, authenticated, service_role;

-- ============ the audit gains three actions ============

alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
  check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo',
                    'membership.confirm', 'membership.unconfirm', 'membership.remove'));

-- ============ the one door check, and the keys ============

-- The caller's OPEN account, or one 42501. The same answer for: not signed in, no account, a closed account, an identity that
-- is no longer active. p_lock takes a row lock on the account so the caps below cannot be raced.
create function app.seduh_my_account(p_lock boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is not null then
    if p_lock then
      select a.id into v_id
        from app.seduh_accounts a join app.seduh_identities i on i.id = a.identity_id
       where a.user_id = v_uid and a.closed_at is null and a.adult_attested_at is not null and i.status = 'active'
         for update of a;
    else
      select a.id into v_id
        from app.seduh_accounts a join app.seduh_identities i on i.id = a.identity_id
       where a.user_id = v_uid and a.closed_at is null and a.adult_attested_at is not null and i.status = 'active';
    end if;
  end if;
  if v_id is null then
    raise exception 'Sign in with your Seduh ID first.' using errcode = '42501', hint = 'no_account';
  end if;
  return v_id;
end;
$$;
revoke all on function app.seduh_my_account(boolean) from public, anon, authenticated, service_role;

-- the picker's key: a one-way token of the result's id (opaque, stable, no internal id leaves the database)
create function app.seduh_team_key(p_result_id uuid)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(encode(sha256(convert_to('seduh-team:' || p_result_id::text, 'UTF8')), 'hex'), 32);
$$;
revoke all on function app.seduh_team_key(uuid) from public, anon, authenticated, service_role;

-- ============ JSON builders (internal; the doors call these) ============

create function app.seduh_entry_json(e app.seduh_self_reported_entries)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'year', e.year, 'competition_name', e.competition_name, 'location', e.location, 'kind', e.kind,
    'role', e.role, 'result_text', e.result_text, 'placement', e.placement, 'note', e.note,
    'provenance', 'self_reported');
$$;
revoke all on function app.seduh_entry_json(app.seduh_self_reported_entries) from public, anon, authenticated, service_role;

create function app.seduh_link_json(p_membership_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'team_key', app.seduh_team_key(h.id), 'team_name', h.team_name, 'country_code', h.country_code,
    'competition', h.competition, 'competition_name', h.competition_name, 'edition_year', h.edition_year,
    'stage_reached', h.stage_reached, 'placement', h.placement, 'listed', h.listed,
    'role', m.role, 'membership', m.status,
    'team_provenance', 'organiser_archive')
    from app.seduh_team_memberships m join app.historical_results h on h.id = m.result_id
   where m.id = p_membership_id;
$$;
revoke all on function app.seduh_link_json(bigint) from public, anon, authenticated, service_role;

create function app.seduh_my_record_json(p_account uuid)
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
           'profile_path', '/id/' || a.handle || '/')
    into v_acct
    from app.seduh_accounts a join app.seduh_identities i on i.id = a.identity_id
   where a.id = p_account;

  select jsonb_build_object(
           'vis_identity', s.vis_identity, 'vis_recorded_results', s.vis_recorded_results,
           'vis_organiser_results', s.vis_organiser_results, 'vis_self_reported_results', s.vis_self_reported_results,
           'vis_judging_roles', s.vis_judging_roles, 'vis_cafe_affiliations', s.vis_cafe_affiliations,
           'vis_knockout_record', s.vis_knockout_record, 'listed_on_country_pages', s.listed_on_country_pages)
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
revoke all on function app.seduh_my_record_json(uuid) from public, anon, authenticated, service_role;

-- ============ the person's doors ============

create function public.seduh_my_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return app.seduh_my_record_json(app.seduh_my_account());
end;
$$;

-- shared validation of one entry's fields; returns the cleaned values as jsonb (a refusal carries the field's own hint)
create function app.seduh_entry_clean(
  p_year integer, p_competition_name text, p_kind text, p_location text, p_role text, p_result_text text,
  p_placement integer, p_note text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  -- the latest year is the current year in the furthest-ahead time zone (UTC+14), so New Year in Brunei is never refused
  if p_year is null or p_year < 1980 or p_year > extract(year from now() + interval '14 hours')::integer then
    raise exception 'That year is not allowed.' using errcode = 'P0001', hint = 'bad_year';
  end if;
  if p_kind is null or p_kind not in ('competed', 'judged', 'organised', 'coached', 'volunteered') then
    raise exception 'Choose what you did.' using errcode = 'P0001', hint = 'bad_kind';
  end if;
  if p_placement is not null and p_placement not between 1 and 500 then
    raise exception 'That placing is not allowed.' using errcode = 'P0001', hint = 'bad_placement';
  end if;
  return jsonb_build_object(
    'year', p_year,
    'competition_name', app.seduh_clean_text(p_competition_name, 120, true, 'bad_competition'),
    'kind', p_kind,
    'location', app.seduh_clean_text(p_location, 80, false, 'bad_location'),
    'role', app.seduh_clean_text(p_role, 60, false, 'bad_role'),
    'result_text', app.seduh_clean_text(p_result_text, 80, false, 'bad_result'),
    'placement', p_placement,
    'note', app.seduh_clean_text(p_note, 500, false, 'bad_note'));
end;
$$;
revoke all on function app.seduh_entry_clean(integer, text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;

create function public.seduh_add_entry(
  p_year integer, p_competition_name text, p_kind text, p_location text default null, p_role text default null,
  p_result_text text default null, p_placement integer default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct  uuid := app.seduh_my_account(true);
  c       jsonb := app.seduh_entry_clean(p_year, p_competition_name, p_kind, p_location, p_role, p_result_text, p_placement, p_note);
  e       app.seduh_self_reported_entries;
begin
  if (select count(*) from app.seduh_self_reported_entries where account_id = v_acct) >= 200 then
    raise exception 'You have reached the limit of 200 entries.' using errcode = 'P0001', hint = 'too_many_entries';
  end if;
  insert into app.seduh_self_reported_entries (account_id, year, competition_name, location, kind, role, result_text, placement, note)
  values (v_acct, (c ->> 'year')::smallint, c ->> 'competition_name', c ->> 'location', c ->> 'kind', c ->> 'role',
          c ->> 'result_text', (c ->> 'placement')::smallint, c ->> 'note')
  returning * into e;
  return app.seduh_entry_json(e);
end;
$$;

-- a full replace of one entry (the form sends every field)
create function public.seduh_update_entry(
  p_entry_id bigint, p_year integer, p_competition_name text, p_kind text, p_location text default null,
  p_role text default null, p_result_text text default null, p_placement integer default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct  uuid := app.seduh_my_account(true);
  c       jsonb := app.seduh_entry_clean(p_year, p_competition_name, p_kind, p_location, p_role, p_result_text, p_placement, p_note);
  e       app.seduh_self_reported_entries;
begin
  update app.seduh_self_reported_entries
     set year = (c ->> 'year')::smallint, competition_name = c ->> 'competition_name', location = c ->> 'location',
         kind = c ->> 'kind', role = c ->> 'role', result_text = c ->> 'result_text',
         placement = (c ->> 'placement')::smallint, note = c ->> 'note'
   where id = p_entry_id and account_id = v_acct
  returning * into e;
  if not found then
    raise exception 'That entry was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  return app.seduh_entry_json(e);
end;
$$;

create function public.seduh_delete_entry(p_entry_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct uuid := app.seduh_my_account(true);
begin
  delete from app.seduh_self_reported_entries where id = p_entry_id and account_id = v_acct;
  if not found then
    raise exception 'That entry was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

-- the picker: team-years a person may link to. LISTED rows only; needs a signed-in open account (it is not an anonymous door,
-- even though every row is already on the public country pages). Optional filters; at most 300 rows.
create function public.seduh_team_options(p_country_code text default null, p_competition text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acct  uuid := app.seduh_my_account();
  v_code  text := nullif(upper(btrim(coalesce(p_country_code, ''))), '');
  v_comp  text := nullif(lower(btrim(coalesce(p_competition, ''))), '');
  v_rows  jsonb;
  v_n     integer;
begin
  if v_code is not null and v_code !~ '^[A-Z]{2}$' then
    raise exception 'That country code is not allowed.' using errcode = 'P0001', hint = 'bad_input';
  end if;
  select count(*) into v_n from app.historical_results h
   where h.listed and (v_code is null or h.country_code = v_code) and (v_comp is null or h.competition = v_comp);
  select coalesce(jsonb_agg(t.j order by t.edition_year desc, t.country_code, t.team_name), '[]'::jsonb)
    into v_rows
    from (
      select h.edition_year, h.country_code, h.team_name,
             jsonb_build_object(
               'team_key', app.seduh_team_key(h.id), 'team_name', h.team_name, 'country_code', h.country_code,
               'competition', h.competition, 'competition_name', h.competition_name, 'edition_year', h.edition_year,
               'stage_reached', h.stage_reached, 'placement', h.placement,
               'linked', exists (select 1 from app.seduh_team_memberships m where m.account_id = v_acct and m.result_id = h.id),
               'provenance', 'organiser_archive') as j
        from app.historical_results h
       where h.listed and (v_code is null or h.country_code = v_code) and (v_comp is null or h.competition = v_comp)
       order by h.edition_year desc, h.country_code, h.team_name
       limit 300
    ) t;
  return jsonb_build_object('teams', v_rows, 'truncated', v_n > 300);
end;
$$;

create function public.seduh_add_team_link(p_team_key text, p_role text default 'member')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct   uuid := app.seduh_my_account(true);
  v_role   text := lower(btrim(coalesce(p_role, 'member')));
  v_result uuid;
  v_id     bigint;
begin
  if v_role not in ('member', 'captain', 'coach', 'reserve') then
    raise exception 'Choose your role in the team.' using errcode = 'P0001', hint = 'bad_role';
  end if;
  -- a key that is unknown, malformed or names an UNLISTED team is one answer
  select h.id into v_result
    from app.historical_results h
   where h.listed and app.seduh_team_key(h.id) = btrim(coalesce(p_team_key, ''));
  if v_result is null then
    raise exception 'That team was not found.' using errcode = 'P0001', hint = 'team_not_found';
  end if;
  if exists (select 1 from app.seduh_team_memberships where account_id = v_acct and result_id = v_result) then
    raise exception 'You are already linked to that team.' using errcode = 'P0001', hint = 'already_linked';
  end if;
  if (select count(*) from app.seduh_team_memberships where account_id = v_acct) >= 40 then
    raise exception 'You have reached the limit of 40 team links.' using errcode = 'P0001', hint = 'too_many_links';
  end if;
  -- always self_reported: a person cannot confirm themselves (the owner does, app.seduh_membership_confirm)
  insert into app.seduh_team_memberships (account_id, result_id, role) values (v_acct, v_result, v_role)
  returning id into v_id;
  return app.seduh_link_json(v_id);
end;
$$;

create function public.seduh_remove_team_link(p_link_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct uuid := app.seduh_my_account(true);
begin
  delete from app.seduh_team_memberships where id = p_link_id and account_id = v_acct;
  if not found then
    raise exception 'That team link was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

-- Partial update of the person's own privacy settings: {"vis_self_reported_results": "hidden", "listed_on_country_pages": true}.
-- Only the eight known keys; each value in its own vocabulary; returns the settings as they now stand.
create function public.seduh_set_my_settings(p_settings jsonb)
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
    if v_key = 'listed_on_country_pages' then
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
    listed_on_country_pages   = coalesce((p_settings ->> 'listed_on_country_pages')::boolean, listed_on_country_pages)
   where account_id = v_acct
  returning * into s;
  if not found then
    raise exception 'Sign in with your Seduh ID first.' using errcode = '42501', hint = 'no_account';
  end if;
  return jsonb_build_object(
    'vis_identity', s.vis_identity, 'vis_recorded_results', s.vis_recorded_results,
    'vis_organiser_results', s.vis_organiser_results, 'vis_self_reported_results', s.vis_self_reported_results,
    'vis_judging_roles', s.vis_judging_roles, 'vis_cafe_affiliations', s.vis_cafe_affiliations,
    'vis_knockout_record', s.vis_knockout_record, 'listed_on_country_pages', s.listed_on_country_pages);
end;
$$;

-- API privileges: the eight doors are for a signed-in caller only
revoke all on function public.seduh_my_record() from public, anon, authenticated, service_role;
revoke all on function public.seduh_add_entry(integer, text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_update_entry(bigint, integer, text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_delete_entry(bigint) from public, anon, authenticated, service_role;
revoke all on function public.seduh_team_options(text, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_add_team_link(text, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_remove_team_link(bigint) from public, anon, authenticated, service_role;
revoke all on function public.seduh_set_my_settings(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.seduh_entry_clean(integer, text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.seduh_my_record() to authenticated;
grant execute on function public.seduh_add_entry(integer, text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.seduh_update_entry(bigint, integer, text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.seduh_delete_entry(bigint) to authenticated;
grant execute on function public.seduh_team_options(text, text) to authenticated;
grant execute on function public.seduh_add_team_link(text, text) to authenticated;
grant execute on function public.seduh_remove_team_link(bigint) to authenticated;
grant execute on function public.seduh_set_my_settings(jsonb) to authenticated;

-- ============ the owner's functions (owner SQL only: no API role may run them) ============

-- what is waiting for review: every membership, unconfirmed first
create function app.seduh_memberships_overview()
returns table (membership_id bigint, handle text, founding_number integer, display_name text, team_name text,
               country_code text, competition text, edition_year smallint, role text, status text, confirmed_via text,
               listed boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, a.handle, a.founding_number, i.display_name, h.team_name, h.country_code, h.competition, h.edition_year,
         m.role, m.status, m.confirmed_via, h.listed, m.created_at
    from app.seduh_team_memberships m
    join app.seduh_accounts a on a.id = m.account_id
    join app.seduh_identities i on i.id = a.identity_id
    join app.historical_results h on h.id = m.result_id
   order by (m.status = 'confirmed'), m.created_at, m.id;
$$;
revoke all on function app.seduh_memberships_overview() from public, anon, authenticated, service_role;

create function app.seduh_membership_confirm(p_membership_id bigint, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m app.seduh_team_memberships;
  v_identity uuid;
  v_reason text := app.seduh_clean_text(p_reason, 200, true, 'bad_reason');
begin
  select * into m from app.seduh_team_memberships where id = p_membership_id for update;
  if not found then raise exception 'seduh_membership_confirm: no such membership %', p_membership_id using errcode = 'P0002'; end if;
  if m.status = 'confirmed' then raise exception 'seduh_membership_confirm: membership % is already confirmed', p_membership_id using errcode = 'P0001'; end if;
  select a.identity_id into v_identity from app.seduh_accounts a where a.id = m.account_id and a.closed_at is null;
  if v_identity is null then raise exception 'seduh_membership_confirm: the account is closed' using errcode = 'P0001'; end if;
  update app.seduh_team_memberships
     set status = 'confirmed', confirmed_via = 'owner', confirmed_by_account = null, confirmed_at = now()
   where id = m.id;
  perform app.seduh_claim_audit_write('membership.confirm', null, v_identity, null, m.account_id,
    jsonb_build_object('membership_id', m.id, 'role', m.role, 'reason', v_reason));
end;
$$;
revoke all on function app.seduh_membership_confirm(bigint, text) from public, anon, authenticated, service_role;

create function app.seduh_membership_unconfirm(p_membership_id bigint, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m app.seduh_team_memberships;
  v_identity uuid;
  v_reason text := app.seduh_clean_text(p_reason, 200, true, 'bad_reason');
begin
  select * into m from app.seduh_team_memberships where id = p_membership_id for update;
  if not found then raise exception 'seduh_membership_unconfirm: no such membership %', p_membership_id using errcode = 'P0002'; end if;
  if m.status <> 'confirmed' then raise exception 'seduh_membership_unconfirm: membership % is not confirmed', p_membership_id using errcode = 'P0001'; end if;
  select a.identity_id into v_identity from app.seduh_accounts a where a.id = m.account_id;
  update app.seduh_team_memberships
     set status = 'self_reported', confirmed_via = null, confirmed_by_account = null, confirmed_at = null
   where id = m.id;
  perform app.seduh_claim_audit_write('membership.unconfirm', null, v_identity, null, m.account_id,
    jsonb_build_object('membership_id', m.id, 'was_confirmed_via', m.confirmed_via, 'reason', v_reason));
end;
$$;
revoke all on function app.seduh_membership_unconfirm(bigint, text) from public, anon, authenticated, service_role;

-- removes a FALSE membership (spec 14.5), with the reason on the record
create function app.seduh_membership_remove(p_membership_id bigint, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m app.seduh_team_memberships;
  v_identity uuid;
  v_reason text := app.seduh_clean_text(p_reason, 200, true, 'bad_reason');
begin
  select * into m from app.seduh_team_memberships where id = p_membership_id for update;
  if not found then raise exception 'seduh_membership_remove: no such membership %', p_membership_id using errcode = 'P0002'; end if;
  select a.identity_id into v_identity from app.seduh_accounts a where a.id = m.account_id;
  delete from app.seduh_team_memberships where id = m.id;
  perform app.seduh_claim_audit_write('membership.remove', null, v_identity, null, m.account_id,
    jsonb_build_object('membership_id', m.id, 'was_status', m.status, 'reason', v_reason));
end;
$$;
revoke all on function app.seduh_membership_remove(bigint, text) from public, anon, authenticated, service_role;

-- ============ the profile door: self-reported entries and team links are filled ============

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
  v_orgrec    jsonb := '[]'::jsonb;
  v_self      jsonb := '[]'::jsonb;
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
           coalesce(s.vis_organiser_results, 'hidden'), coalesce(s.vis_self_reported_results, 'hidden')
      into v_acc_id, v_identity, v_name, v_country, v_founding, v_claimed, v_vis_id, v_vis_rec, v_vis_ko, v_vis_org, v_vis_self
      from app.seduh_accounts a
      join app.seduh_identities i on i.id = a.identity_id
      left join app.seduh_profile_settings s on s.account_id = a.id
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
      'judging_roles', '[]'::jsonb,
      'cafe_affiliations', '[]'::jsonb);
  end if;

  -- Identity block: public or hidden. A hidden block has the same keys, all null.
  if v_vis_id = 'public' then
    v_ident := jsonb_build_object('display_name', v_name, 'country_code', v_country, 'founding_number', v_founding,
                                  'claimed_on', v_claimed, 'photo_url', null /* SEAM C2: the avatar URL */);
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

  return jsonb_build_object(
    'has_profile', true,
    'handle', v_handle,
    'identity', v_ident,
    'recorded_results', v_results,
    'knockout_record', jsonb_build_object('won', coalesce(v_won, 0), 'lost', coalesce(v_lost, 0), 'opponents', v_opps),
    'organiser_records', v_orgrec,
    'self_reported', v_self,
    'judging_roles', '[]'::jsonb,       -- SEAM: needs a judge-to-identity link (BTC judges have no people row)
    'cafe_affiliations', '[]'::jsonb);  -- SEAM: two-sided acceptance is not modelled yet
end;
$$;

revoke all on function public.public_seduh_profile(text) from public, anon, authenticated, service_role;
grant execute on function public.public_seduh_profile(text) to anon, authenticated;

-- ============ the country door: each team row lists its opted-in members ============

create or replace function public.public_country_record(p_country_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code        text := upper(btrim(coalesce(p_country_code, '')));
  v_champs      jsonb;
  v_teams       jsonb;
  v_best        jsonb;
  v_live        jsonb := '[]'::jsonb;
  v_n_champs    integer;
  v_n_entries   integer;
  v_n_teams     integer;
  v_won         integer;
  v_lost        integer;
begin
  -- A code that is not two letters matches nothing; it is not echoed back (no oracle, no reflection).
  if v_code !~ '^[A-Z]{2}$' then
    v_code := null;
  end if;

  -- Stats, derived on read: nothing here is stored.
  select count(distinct h.competition || ':' || h.edition_year), count(*), count(distinct h.team_name)
    into v_n_champs, v_n_entries, v_n_teams
    from app.historical_results h
   where h.listed and h.country_code = v_code;

  -- Matches with a known opponent: a round whose pairing the organiser published. Level scores count for neither.
  select count(*) filter (where s.score > s.opponent_score),
         count(*) filter (where s.score < s.opponent_score)
    into v_won, v_lost
    from app.historical_results h
    join app.historical_round_scores s on s.result_id = h.id
   where h.listed and h.country_code = v_code and s.opponent_team_name is not null
     -- an opponent that has been unlisted is not shown, and its match is not counted either (a removal is complete)
     and exists (select 1 from app.historical_results o where o.listed and o.competition = h.competition and o.edition_year = h.edition_year and o.team_name = s.opponent_team_name);

  -- Best finish: deepest stage, then the best published placement, then the most recent year.
  select jsonb_build_object(
           'team_name', h.team_name, 'competition', h.competition, 'edition_year', h.edition_year,
           'stage_reached', h.stage_reached, 'placement', h.placement)
    into v_best
    from app.historical_results h
   where h.listed and h.country_code = v_code
   order by app.historical_stage_order(h.stage_reached) desc, h.placement nulls last,
            h.edition_year desc, h.team_name
   limit 1;

  -- By championship, newest first; teams furthest first; rounds in playing order.
  select coalesce(jsonb_agg(c.j order by c.edition_year desc, c.competition), '[]'::jsonb)
    into v_champs
    from (
      select h.competition, h.edition_year,
             jsonb_build_object(
               'competition', h.competition,
               'competition_name', min(h.competition_name),
               'edition_year', h.edition_year,
               'host_city', min(h.host_city),
               'host_country_code', min(h.host_country_code),
               'supplied_by', min(h.supplied_by),
               'provenance', 'organiser_archive',
               'teams', jsonb_agg(
                 jsonb_build_object(
                   'team_name', h.team_name,
                   'stage_reached', h.stage_reached,
                   'placement', h.placement,
                   'score_note', h.score_note,
                   'provenance', 'organiser_archive',
                   -- Members on Seduh ID (20261122100000): ONLY people who turned `listed_on_country_pages` on themselves, whose
                   -- identity and organiser-record settings are public, with an open, attested, active account. A person is
                   -- never listed because someone else named them (a membership is created only by its own person).
                   'members', coalesce((
                     select jsonb_agg(
                              jsonb_build_object('handle', a.handle, 'display_name', i.display_name, 'membership', m.status)
                              order by i.display_name, a.handle)
                       from app.seduh_team_memberships m
                       join app.seduh_accounts a on a.id = m.account_id
                       join app.seduh_identities i on i.id = a.identity_id
                       join app.seduh_profile_settings s on s.account_id = a.id
                      where m.result_id = h.id
                        and a.closed_at is null and a.adult_attested_at is not null and i.status = 'active'
                        and s.listed_on_country_pages and s.vis_identity = 'public' and s.vis_organiser_results = 'public'), '[]'::jsonb),
                   'rounds', coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'round', s.round, 'r1', s.r1, 'r2', s.r2, 'score', s.score,
                                'opponent_team_name', case when exists (select 1 from app.historical_results o where o.listed and o.competition = h.competition and o.edition_year = h.edition_year and o.team_name = s.opponent_team_name) then s.opponent_team_name end,
                                'opponent_score', case when exists (select 1 from app.historical_results o where o.listed and o.competition = h.competition and o.edition_year = h.edition_year and o.team_name = s.opponent_team_name) then s.opponent_score end)
                              order by case s.round
                                         when 'preliminary' then 1 when 'quarter_final' then 2
                                         when 'semi_final' then 3 when 'final_champion' then 4
                                         else 5 end)
                       from app.historical_round_scores s
                      where s.result_id = h.id), '[]'::jsonb))
                 order by app.historical_stage_order(h.stage_reached) desc, h.placement nulls last, h.team_name)
             ) as j
        from app.historical_results h
       where h.listed and h.country_code = v_code
       group by h.competition, h.edition_year
    ) c;

  -- SEAM: live BTC events (provenance 'seduh_score'). A later migration fills v_live with the championships of
  -- published, non-test, non-shadow BTC events in which every team has a country_code, in the SAME shape as above
  -- (competition, edition_year, teams with stage_reached and rounds), and adds them to the teams summary below.
  -- It does not exist yet: is_shadow and the published payload's country are not built. Until then this stays empty.
  v_live := '[]'::jsonb;

  -- Teams, across the years: a team is the same team only by the name the owner loaded (owner rule, 2026-11-13).
  select coalesce(jsonb_agg(t.j order by t.best_order desc, t.team_name), '[]'::jsonb)
    into v_teams
    from (
      select h.team_name,
             max(app.historical_stage_order(h.stage_reached)) as best_order,
             jsonb_build_object(
               'team_name', h.team_name,
               'years', jsonb_agg(h.edition_year order by h.edition_year),
               'best_stage', (array_agg(h.stage_reached
                                order by app.historical_stage_order(h.stage_reached) desc, h.placement nulls last))[1],
               'best_placement', (array_agg(h.placement
                                order by app.historical_stage_order(h.stage_reached) desc, h.placement nulls last))[1],
               'provenance', 'organiser_archive') as j
        from app.historical_results h
       where h.listed and h.country_code = v_code
       group by h.team_name
    ) t;

  return jsonb_build_object(
    'country_code', v_code,
    'has_record', (jsonb_array_length(v_champs) + jsonb_array_length(v_live)) > 0,
    'stats', jsonb_build_object(
      'championships', v_n_champs,
      'entries', v_n_entries,
      'teams', v_n_teams,
      'matches_won', coalesce(v_won, 0),
      'matches_lost', coalesce(v_lost, 0),
      'best_finish', v_best),
    'championships', v_champs || v_live,
    'teams', v_teams);
end;
$$;

revoke all on function public.public_country_record(text) from public, anon, authenticated, service_role;
grant execute on function public.public_country_record(text) to anon, authenticated;
