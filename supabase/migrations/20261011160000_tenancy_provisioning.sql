-- Seduh Score Next · T-TEN.B4: org provisioning (service role only)
--
-- Why: until now an org and its first login were "provisioned directly" (hand-written SQL). With
-- several orgs on one database, creating one has to be a single, validated, atomic operation, and
-- putting an EXISTING account into a second org has to be a deliberate, service-role-only act:
-- decision D-T1 (invite-only: no signup UI, no API role can create an org) and D-T6 (multi-org
-- membership is created only through a service-role path, never by the Team screen).
--
-- What this adds:
--   * create_org(p_name, p_slug, p_owner_user_id) -> the new org's id. One transaction: validates the
--     name and slug, creates the org and makes the given existing, eligible account its owner.
--     This is the ONLY path that creates an org; a later gating phase hooks its default grant here.
--   * org_add_existing_member(p_org_id, p_user_id, p_role) — the only way to give an account a SECOND
--     membership. Refuses a duplicate. An operator tool; there is no UI for it.
--   * orgs.slug is immutable once set (D-T8): slugs appear in printed and QR audience links, so a
--     rename would silently kill every link already in the world. (Known gap, recorded in ROADMAP:
--     deleting an org frees its slug for reuse.)
--   * orgs_slug_format: a CHECK constraint, so the slug format is a hard rule for every writer, not
--     only for create_org. The reserved list stays in the function, because it has to be able to grow.
--   Both functions are executable by the service role only (revoked from public, anon and
--   authenticated), SECURITY DEFINER with search_path pinned.
--
-- Validation (every refusal carries a stable `hint`; clients should switch on the hint, not the text):
--   name   1 to 80 characters after trimming; no control characters, no bidi-override characters, and
--          not made only of whitespace / zero-width characters .......................... org_name_invalid
--   slug   trimmed, then ASCII letters and digits with single hyphens between them (checked BEFORE
--          lower-casing, so a look-alike such as the Kelvin sign is refused, whatever the database
--          locale), 3 to 40 characters, folded to lower case ........................... org_slug_invalid
--          not a reserved word (checked after folding, so ADMIN and " Live " are caught) org_slug_reserved
--          not already taken, compared case-insensitively ............................... org_slug_taken
--   owner / member account  must exist and be eligible: not deleted, not banned, not anonymous
--          ..................................................... org_owner_not_found / member_user_not_found
--   role   owner or organiser ................................................. member_role_invalid
--   org    must exist ........................................................... org_not_found
--   member must not already be in that org ..................................... member_exists
-- "Not found" and "invalid" use SQLSTATE 22023 (PostgREST answers 400; P0002 would be a 500), a
-- conflict uses 23505.
--
-- Reserved slugs: the directories that serve root pages today (about, app, community, contact,
-- guess-the-bean, neutrality, privacy, results, terms, tools, tour), the other root paths the
-- repository ships (assets, bts, marketing), the console and audience words (admin, api, www, live,
-- events, team, projector, phone, splash, login, signup, auth) and a few generic ones that are
-- cheap to reserve now and impossible to take back later (help, docs, support, pricing, status,
-- static, settings, dashboard).
--
-- OPERATOR NOTE (security review): never attach to a second org an account that a Team screen
-- created and whose holder has not yet set their own password. Its one-time password is known to
-- that org's owner, so adding it elsewhere would let the first org's owner sign in there. Attach
-- only accounts whose holder has set their own password, or create a fresh account.
--
-- Not changed, deliberately: team_add_member still refuses an account that already belongs to an org
-- and team_can_manage still refuses a target who belongs to another org (the Team screen manages
-- accounts that live in ONE org only). pgTAP 036 pins both.
--
-- rollback:
--   alter table orgs drop constraint if exists orgs_slug_format;
--   drop trigger if exists trg_orgs_slug_immutable on orgs;
--   drop function if exists org_add_existing_member(uuid, uuid, text);
--   drop function if exists create_org(text, text, uuid);

alter table orgs
  add constraint orgs_slug_format
  check (slug ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(slug) between 3 and 40);

create trigger trg_orgs_slug_immutable
  before update of slug on orgs
  for each row execute function app.forbid_parent_change('slug');

create or replace function create_org(p_name text, p_slug text, p_owner_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_name, E' \t\r\n');
  v_slug_raw text := btrim(p_slug, E' \t\r\n');
  v_slug text;
  v_reserved constant text[] := array[
    'app', 'admin', 'api', 'www', 'live', 'results', 'tour', 'community', 'tools',
    'guess-the-bean', 'about', 'contact', 'privacy', 'terms', 'neutrality',
    'login', 'signup', 'auth',
    'assets', 'bts', 'marketing', 'events', 'team', 'projector', 'phone', 'splash',
    'help', 'docs', 'support', 'pricing', 'status', 'static', 'settings', 'dashboard'
  ];
  v_org_id uuid;
  v_constraint text;
begin
  -- A cheap guard first: nothing sensible is this long, and it keeps the checks below fast.
  if length(p_name) > 400 or length(p_slug) > 400 then
    raise exception 'create_org: the name or slug is far too long'
      using errcode = '22023',
            hint = case when length(p_name) > 400 then 'org_name_invalid' else 'org_slug_invalid' end;
  end if;

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 80
     or v_name ~ '[[:cntrl:]]'
     or v_name ~ E'[\\u202a-\\u202e\\u2066-\\u2069]'
     or v_name ~ E'^[[:space:]\\u00a0\\u200b-\\u200d\\u2060\\ufeff]*$' then
    raise exception 'create_org: the organisation name must be 1 to 80 characters'
      using errcode = '22023', hint = 'org_name_invalid';
  end if;

  if v_slug_raw is null
     or char_length(v_slug_raw) < 3 or char_length(v_slug_raw) > 40
     or v_slug_raw !~ '^[A-Za-z0-9](-?[A-Za-z0-9])*$' then
    raise exception 'create_org: the slug must be 3 to 40 lower-case letters and digits, with single hyphens between them'
      using errcode = '22023', hint = 'org_slug_invalid';
  end if;
  v_slug := lower(v_slug_raw);

  if v_slug = any (v_reserved) then
    raise exception 'create_org: that slug is reserved'
      using errcode = '22023', hint = 'org_slug_reserved';
  end if;

  if p_owner_user_id is null
     or not exists (
       select 1 from auth.users u
       where u.id = p_owner_user_id
         and u.deleted_at is null
         and u.is_anonymous is not true
         and (u.banned_until is null or u.banned_until <= now())
     ) then
    raise exception 'create_org: the owner must be an existing, active account'
      using errcode = '22023', hint = 'org_owner_not_found';
  end if;

  if exists (select 1 from public.orgs o where lower(o.slug) = v_slug) then
    raise exception 'create_org: that slug is already taken'
      using errcode = '23505', hint = 'org_slug_taken';
  end if;

  insert into public.orgs (name, slug) values (v_name, v_slug) returning id into v_org_id;
  insert into public.org_members (org_id, user_id, role) values (v_org_id, p_owner_user_id, 'owner');

  return v_org_id;
exception
  when unique_violation then
    -- two operators racing on the same slug: the loser gets the same answer as the check above.
    -- Any OTHER unique violation (a future index, a trigger's insert) is not ours to relabel.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'orgs_slug_key' then
      raise exception 'create_org: that slug is already taken'
        using errcode = '23505', hint = 'org_slug_taken';
    end if;
    raise;
  when foreign_key_violation then
    -- the owner account was deleted between the check and the insert
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'org_members_user_id_fkey' then
      raise exception 'create_org: the owner must be an existing, active account'
        using errcode = '22023', hint = 'org_owner_not_found';
    end if;
    raise;
end;
$$;

create or replace function org_add_existing_member(p_org_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_constraint text;
begin
  if p_role is null or p_role not in ('owner', 'organiser') then
    raise exception 'org_add_existing_member: role must be owner or organiser'
      using errcode = '22023', hint = 'member_role_invalid';
  end if;

  if p_org_id is null or not exists (select 1 from public.orgs o where o.id = p_org_id) then
    raise exception 'org_add_existing_member: no such organisation'
      using errcode = '22023', hint = 'org_not_found';
  end if;

  if p_user_id is null
     or not exists (
       select 1 from auth.users u
       where u.id = p_user_id
         and u.deleted_at is null
         and u.is_anonymous is not true
         and (u.banned_until is null or u.banned_until <= now())
     ) then
    raise exception 'org_add_existing_member: no such active account'
      using errcode = '22023', hint = 'member_user_not_found';
  end if;

  if exists (select 1 from public.org_members m where m.org_id = p_org_id and m.user_id = p_user_id) then
    raise exception 'org_add_existing_member: that account is already a member of this organisation'
      using errcode = '23505', hint = 'member_exists';
  end if;

  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_user_id, p_role);
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'org_members_pkey' then
      raise exception 'org_add_existing_member: that account is already a member of this organisation'
        using errcode = '23505', hint = 'member_exists';
    end if;
    raise;
  when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'org_members_org_id_fkey' then
      raise exception 'org_add_existing_member: no such organisation'
        using errcode = '22023', hint = 'org_not_found';
    elsif v_constraint = 'org_members_user_id_fkey' then
      raise exception 'org_add_existing_member: no such active account'
        using errcode = '22023', hint = 'member_user_not_found';
    end if;
    raise;
end;
$$;

revoke all on function create_org(text, text, uuid) from public, anon, authenticated;
revoke all on function org_add_existing_member(uuid, uuid, text) from public, anon, authenticated;
grant execute on function create_org(text, text, uuid) to service_role;
grant execute on function org_add_existing_member(uuid, uuid, text) to service_role;
