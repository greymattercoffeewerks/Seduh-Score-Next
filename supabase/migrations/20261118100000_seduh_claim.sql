-- Seduh Score Next · T-ID2.B3a: claiming a Seduh ID (the BACKEND; screens are B3b)
-- (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md sections 3, 8, 9, 10, 14.4; tables: 20261115120000.)
--
-- The path: an organiser who has the person on their roster issues a ONE-TIME claim link (issue_seduh_claim_link); the
-- person opens it, proves an email (the Edge Function `seduh-claim` calls seduh_claim_begin, then has Auth email a 6-digit
-- code; the page verifies it in the browser), and then, signed in, calls claim_seduh_id with the token, a handle and "I am 18
-- or over". Nothing here creates an identity: identities come from the reviewed feed (and the owner's SQL for #0001).
--
-- WHAT THIS ADDS
--   app.seduh_claim_audit          append-only audit of every issue, revoke and claim (see DECISION A).
--   app.seduh_reserved_numbers     the owner's reservation of founding number 1 for one identity (DECISION B).
--   app.seduh_claim_links          two columns: code_sends and last_code_sent_at (a per-link cap on emailed codes, DECISION D).
--   public.issue_seduh_claim_link(p_person_id uuid) returns text       organiser; the RAW token, once.
--   public.revoke_seduh_claim_link(p_person_id uuid) returns void      organiser.
--   public.seduh_claim_statuses(p_org_id uuid, p_person_ids uuid[])    organiser; the People screen's read.
--   public.claim_seduh_id(p_token text, p_handle text, p_adult boolean) returns jsonb   the signed-in person.
--   public.seduh_handle_available(p_handle text) returns text         anon: available | taken | reserved | invalid.
--   public.seduh_claim_begin(p_token text) returns jsonb               SERVICE ROLE ONLY (the Edge Function's door).
--
-- DECISION A, the audit table. The admin audit log (app.admin_audit_log) is the platform operator's: its writer is gated on a
-- platform admin at aal2 (an organiser can never call it), its reader is the admin console's Audit log screen (organisers'
-- claim events do not belong in the console's "what an admin did" feed), and test 047 pins every function that mentions it.
-- So claim events get their own small table with the SAME pattern: in `app`, RLS on and no policy, no API privilege, append-only
-- by ENABLE ALWAYS triggers (the same honest limit: the table owner could still drop them), no foreign keys (the history
-- survives an organisation or a login being deleted), and the same detail hygiene check (no key name containing pass, token,
-- secret, email, phone, jwt, otp, credential). `claim.undo` is written by the owner's undo runbook (CONVENTIONS.md). NEVER a raw token, an email or a phone: ids and short codes only. Only SUCCESSES
-- are written (a refused call writes nothing, so a hostile caller cannot fill the table).
--
-- DECISION B, #0001. The founding number is frozen at insert (A2), so it must be assigned AT CLAIM. The owner INSERTs one row into
-- app.seduh_reserved_numbers (founding_number = 1, identity_id = their identity); claim_seduh_id looks the claiming identity up
-- there and, only if it finds an unconsumed reservation, passes that number EXPLICITLY and sets app.seduh_owner_assignment to
-- 'on' for that one insert (transaction-local, cleared straight after). Any other claim takes the sequence, which starts at 2.
-- The table accepts only the number 1 (numbers from 2 are the sequence's: a reservation of 7 would collide with an ordinary
-- claim). Cohort numbering is a 2b decision (L2-6).
--
-- DECISION C, who may issue. Any member of the person's organisation (owner or organiser), like link_person_identity. The
-- organisation is DERIVED from the person (app.org_id_for_person_internal), then app.refuse_non_member runs: a missing person,
-- another organisation's person and a NULL id are ONE 42501. With no signed-in caller (owner SQL, the service role) the gate is
-- skipped as everywhere else, issued_by is NULL and the audit actor is NULL.
--
-- DECISION D, rate limits. (1) Nobody can email a code without a VALID, OPEN token (seduh_claim_begin checks it first, so the
-- function cannot be used to mail strangers or to burn the project's hourly email limit). (2) Each link can have at most 6
-- codes emailed (code_sends), on top of Auth's own per-address frequency limit. (3) A token is 256 bits, so guessing one is not
-- a threat; claim_seduh_id answers every unusable token with a hint and does no work before it has hashed it.
--
-- DECISION E, refusal hints. A refusal is raised with ERRCODE P0001 and a short snake_case HINT, the way the admin functions
-- do (the page translates the hint, never the message): no_identity, identity_unavailable, identity_claimed, link_invalid,
-- link_used, link_revoked, link_expired, handle_invalid, handle_reserved, handle_taken, adult_required, account_exists,
-- admin_cannot_claim, no_open_link, bad_input. An opted-out identity answers `no_identity` (the same as a person with none),
-- so the organiser cannot learn who objected; a merged tombstone answers `identity_unavailable`. A caller who is not signed in,
-- or is not a member of the organisation, gets the standard 42501.
--
-- WHAT THIS DOES NOT DO: send email (Auth does, from the Edge Function); create a login (the Edge Function does, with the
-- service role, so public email signup can stay off); show a profile (B1's door does); let a person change a handle (never).
--
-- ROLLBACK LOSES the audit history and any reservation: do not roll back a populated database.
-- rollback:
--   drop function if exists public.seduh_claim_begin(text);
--   drop function if exists public.seduh_handle_available(text);
--   drop function if exists public.claim_seduh_id(text, text, boolean);
--   drop function if exists public.seduh_claim_statuses(uuid, uuid[]);
--   drop function if exists public.revoke_seduh_claim_link(uuid);
--   drop function if exists public.issue_seduh_claim_link(uuid);
--   drop function if exists app.seduh_claim_audit_write(text, uuid, uuid, uuid, uuid, jsonb);
--   drop function if exists app.seduh_claim_token_hash(text);
--   drop table if exists app.seduh_reserved_numbers;
--   drop function if exists app.seduh_reserved_numbers_guard();
--   drop table if exists app.seduh_claim_audit;
--   drop function if exists app.forbid_seduh_claim_audit_mutation();
--   alter table app.seduh_claim_links drop constraint if exists seduh_claim_links_code_sends_range;
--   alter table app.seduh_claim_links drop column if exists last_code_sent_at;
--   alter table app.seduh_claim_links drop column if exists code_sends;

-- ============ the audit table ============

create table app.seduh_claim_audit (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  action       text not null,
  actor_id     uuid,
  org_id       uuid,
  identity_id  uuid,
  link_id      uuid,
  account_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  constraint seduh_claim_audit_action_vocab
    check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo')),
  constraint seduh_claim_audit_detail_object check (jsonb_typeof(detail) = 'object'),
  constraint seduh_claim_audit_detail_size check (char_length(detail::text) <= 2000),
  constraint seduh_claim_audit_detail_no_secrets check (app.admin_audit_detail_ok(detail))
);
create index seduh_claim_audit_identity_idx on app.seduh_claim_audit (identity_id, id desc);
create index seduh_claim_audit_org_idx on app.seduh_claim_audit (org_id, id desc);

create function app.forbid_seduh_claim_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'seduh_claim_audit is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.forbid_seduh_claim_audit_mutation() from public, anon, authenticated, service_role;

create trigger trg_seduh_claim_audit_no_update_delete
  before update or delete on app.seduh_claim_audit
  for each row execute function app.forbid_seduh_claim_audit_mutation();
create trigger trg_seduh_claim_audit_no_truncate
  before truncate on app.seduh_claim_audit
  for each statement execute function app.forbid_seduh_claim_audit_mutation();
alter table app.seduh_claim_audit enable always trigger trg_seduh_claim_audit_no_update_delete;
alter table app.seduh_claim_audit enable always trigger trg_seduh_claim_audit_no_truncate;

alter table app.seduh_claim_audit enable row level security;
revoke all on app.seduh_claim_audit from public, anon, authenticated, service_role;
revoke all on sequence app.seduh_claim_audit_id_seq from public, anon, authenticated, service_role;

create function app.seduh_claim_audit_write(
  p_action text, p_org_id uuid, p_identity_id uuid, p_link_id uuid, p_account_id uuid, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.seduh_claim_audit (action, actor_id, org_id, identity_id, link_id, account_id, detail)
  values (p_action, auth.uid(), p_org_id, p_identity_id, p_link_id, p_account_id, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function app.seduh_claim_audit_write(text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- ============ the #0001 reservation ============

create table app.seduh_reserved_numbers (
  founding_number  integer primary key,
  identity_id      uuid not null,
  reserved_at      timestamptz not null default now(),
  note             text,
  account_id       uuid,
  consumed_at      timestamptz,
  constraint seduh_reserved_numbers_identity_key unique (identity_id),
  constraint seduh_reserved_numbers_account_key unique (account_id),
  constraint seduh_reserved_numbers_only_one check (founding_number = 1),
  constraint seduh_reserved_numbers_note_len check (note is null or char_length(note) <= 200),
  constraint seduh_reserved_numbers_consumed_both check ((consumed_at is null) = (account_id is null)),
  constraint seduh_reserved_numbers_identity_fkey
    foreign key (identity_id) references app.seduh_identities (id) on delete restrict,
  -- the account that consumed the reservation must be the account OF THAT identity
  constraint seduh_reserved_numbers_account_same_identity
    foreign key (account_id, identity_id) references app.seduh_accounts (id, identity_id) on delete restrict
);

create function app.seduh_reserved_numbers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- once consumed a reservation is history: it cannot be changed or removed (the number is retired with the account)
  if old.consumed_at is not null then
    raise exception 'seduh_reserved_numbers: a consumed reservation cannot be changed or removed' using errcode = '23001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.founding_number is distinct from old.founding_number then
    raise exception 'seduh_reserved_numbers.founding_number is immutable' using errcode = '23001';
  end if;
  return new;
end;
$$;
revoke all on function app.seduh_reserved_numbers_guard() from public, anon, authenticated, service_role;
create trigger trg_seduh_reserved_numbers_guard
  before update or delete on app.seduh_reserved_numbers
  for each row execute function app.seduh_reserved_numbers_guard();

alter table app.seduh_reserved_numbers enable row level security;
revoke all on app.seduh_reserved_numbers from public, anon, authenticated, service_role;

-- ============ the per-link cap on emailed codes ============

alter table app.seduh_claim_links
  add column code_sends smallint not null default 0,
  add column last_code_sent_at timestamptz,
  add constraint seduh_claim_links_code_sends_range check (code_sends between 0 and 6);

-- ============ helpers ============

create function app.seduh_claim_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;
revoke all on function app.seduh_claim_token_hash(text) from public, anon, authenticated, service_role;

-- ============ issue ============

create function public.issue_seduh_claim_link(p_person_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_identity  uuid;
  v_status    text;
  v_token     text;
  v_link      uuid;
  v_replaced  integer;
begin
  -- 1. membership first, with the organisation DERIVED from the person: a missing person, another organisation's person
  --    and NULL are the same refusal for a non-member
  v_org := app.org_id_for_person_internal(p_person_id);
  perform app.refuse_non_member(v_org, 'people');
  if v_org is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  select p.global_person_id into v_identity from public.people p where p.id = p_person_id;
  if v_identity is null then
    raise exception 'This person has no Seduh ID yet: it is made when a published result is reviewed.'
      using errcode = 'P0001', hint = 'no_identity';
  end if;

  -- 2. serialise everything about this identity (issue, revoke, claim all lock it first)
  select i.status into v_status from app.seduh_identities i where i.id = v_identity for update;
  if v_status = 'opted_out' then
    raise exception 'This person has no Seduh ID yet: it is made when a published result is reviewed.'
      using errcode = 'P0001', hint = 'no_identity';
  elsif v_status is distinct from 'active' then
    raise exception 'This Seduh ID cannot be claimed.' using errcode = 'P0001', hint = 'identity_unavailable';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.identity_id = v_identity) then
    raise exception 'This Seduh ID has already been claimed.' using errcode = 'P0001', hint = 'identity_claimed';
  end if;

  -- 3. at most one open link per identity: revoke every open one, EXPIRED ones too (a partial index cannot see the clock)
  update app.seduh_claim_links l set revoked_at = now()
   where l.identity_id = v_identity and l.used_at is null and l.revoked_at is null;
  get diagnostics v_replaced = row_count;

  -- 4. 256 random bits, URL-safe (43 characters); only the SHA-256 is stored
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=' || chr(10), '-_');
  insert into app.seduh_claim_links (identity_id, org_id, issued_by, token_hash)
  values (v_identity, v_org, auth.uid(), app.seduh_claim_token_hash(v_token))
  returning id into v_link;

  perform app.seduh_claim_audit_write('claim_link.issue', v_org, v_identity, v_link, null,
    jsonb_build_object('person_id', p_person_id, 'replaced_open_links', v_replaced));
  return v_token;
end;
$$;

-- ============ revoke ============

create function public.revoke_seduh_claim_link(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_identity  uuid;
  v_link      uuid;
begin
  v_org := app.org_id_for_person_internal(p_person_id);
  perform app.refuse_non_member(v_org, 'people');
  if v_org is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  select p.global_person_id into v_identity from public.people p where p.id = p_person_id;
  if v_identity is not null then
    perform 1 from app.seduh_identities i where i.id = v_identity for update;
    update app.seduh_claim_links l set revoked_at = now()
     where l.identity_id = v_identity and l.used_at is null and l.revoked_at is null
    returning l.id into v_link;
  end if;
  if v_link is null then
    raise exception 'There is no open claim link for this person.' using errcode = 'P0001', hint = 'no_open_link';
  end if;

  perform app.seduh_claim_audit_write('claim_link.revoke', v_org, v_identity, v_link, null,
    jsonb_build_object('person_id', p_person_id));
end;
$$;

-- ============ status (the People screen) ============
-- One row per requested person; an id that is not a person of THIS organisation refuses the whole call (42501, as issue). The state:
--   no_identity   no Seduh ID (also an opted-out one: the organiser must not learn who objected)
--   unavailable   the identity is a merged tombstone
--   can_issue     an active, unclaimed identity with no live link (an expired link counts as none)
--   link_open     a live link; expires_at says until when
--   claimed       a claimed account; handle is the public handle (already public by design). Never a token, a hash or a user.
create function public.seduh_claim_statuses(p_org_id uuid, p_person_ids uuid[])
returns table (person_id uuid, state text, expires_at timestamptz, handle text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(p_org_id, 'people');
  if p_org_id is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_person_ids), 0) > 500 then
    raise exception 'Too many people at once.' using errcode = 'P0001', hint = 'bad_input';
  end if;

  -- every id must be a person of THIS organisation: a missing id and another organisation's person are the SAME refusal
  if (select count(*) from public.people p where p.org_id = p_org_id and p.id = any (coalesce(p_person_ids, '{}'::uuid[])))
     <> (select count(distinct x) from unnest(coalesce(p_person_ids, '{}'::uuid[])) x) then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  return query
  select p.id,
         case
           when p.global_person_id is null or i.id is null or i.status = 'opted_out' then 'no_identity'
           when i.status = 'merged' then 'unavailable'
           when a.id is not null then 'claimed'
           when l.id is not null then 'link_open'
           else 'can_issue'
         end,
         case when a.id is null and i.status = 'active' then l.expires_at end,
         case when i.status = 'active' and a.closed_at is null then a.handle end
    from public.people p
    left join app.seduh_identities i on i.id = p.global_person_id
    left join app.seduh_accounts a on a.identity_id = i.id
    left join app.seduh_claim_links l
           on l.identity_id = i.id and l.used_at is null and l.revoked_at is null and l.expires_at > now()
   where p.org_id = p_org_id and p.id = any (coalesce(p_person_ids, '{}'::uuid[]));
end;
$$;

-- ============ the handle check (public by design: a handle is a public page address) ============

create function public.seduh_handle_available(p_handle text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select lower(btrim(coalesce(p_handle, ''))) as v)
  select case
           when not (h.v ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(h.v) between 3 and 30) then 'invalid'
           when app.seduh_handle_reserved(h.v) then 'reserved'
           when exists (select 1 from app.seduh_accounts a where a.handle = h.v) then 'taken'
           else 'available'
         end
    from h;
$$;

-- ============ the Edge Function's door ============
-- Checks the token and, when it is usable, counts one emailed code against the link. SERVICE ROLE ONLY. Returns
-- {status: ok|invalid|used|revoked|expired|unavailable|too_many, display_name?}. It never returns an id, a phone or a hash.
create function public.seduh_claim_begin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l     app.seduh_claim_links%rowtype;
  v_st  text;
  v_dn  text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into l from app.seduh_claim_links where token_hash = app.seduh_claim_token_hash(p_token) for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if l.used_at is not null then return jsonb_build_object('status', 'used'); end if;
  if l.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;

  select i.status, i.display_name into v_st, v_dn from app.seduh_identities i where i.id = l.identity_id;
  if v_st is distinct from 'active'
     or exists (select 1 from app.seduh_accounts a where a.identity_id = l.identity_id) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if l.code_sends >= 6 then
    return jsonb_build_object('status', 'too_many');
  end if;
  update app.seduh_claim_links set code_sends = code_sends + 1, last_code_sent_at = now() where id = l.id;
  return jsonb_build_object('status', 'ok', 'display_name', v_dn);
end;
$$;

-- ============ claim ============

create function public.claim_seduh_id(p_token text, p_handle text, p_adult boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_handle    text := lower(btrim(coalesce(p_handle, '')));
  l           app.seduh_claim_links%rowtype;
  v_identity  uuid;
  v_status    text;
  v_hash      text;
  v_acct      uuid;
  v_number    integer;
  v_reserved  boolean := false;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- an admin login never becomes a competitor account (the owner uses a separate competitor email)
  if exists (select 1 from app.platform_admins pa where pa.user_id = v_uid) then
    raise exception 'This login is an administrator login and cannot claim a Seduh ID.'
      using errcode = 'P0001', hint = 'admin_cannot_claim';
  end if;
  if p_adult is distinct from true then
    raise exception 'You must confirm you are 18 or over.' using errcode = 'P0001', hint = 'adult_required';
  end if;

  -- handle: shape, reserved, taken (a closed account keeps its handle, so that is taken too)
  if not (v_handle ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(v_handle) between 3 and 30) then
    raise exception 'That handle is not allowed.' using errcode = 'P0001', hint = 'handle_invalid';
  end if;
  if app.seduh_handle_reserved(v_handle) then
    raise exception 'That handle is reserved.' using errcode = 'P0001', hint = 'handle_reserved';
  end if;

  -- the link: found by hash, without a lock first, so the identity can be locked BEFORE the link (issue and revoke lock the
  -- identity first too: one lock order, no deadlock)
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'This claim link is not valid.' using errcode = 'P0001', hint = 'link_invalid';
  end if;
  v_hash := app.seduh_claim_token_hash(p_token);
  select l0.identity_id into v_identity from app.seduh_claim_links l0 where l0.token_hash = v_hash;
  if v_identity is null then
    raise exception 'This claim link is not valid.' using errcode = 'P0001', hint = 'link_invalid';
  end if;
  select i.status into v_status from app.seduh_identities i where i.id = v_identity for update;
  select * into l from app.seduh_claim_links where token_hash = v_hash for update;

  if l.used_at is not null then
    raise exception 'This claim link has already been used.' using errcode = 'P0001', hint = 'link_used';
  elsif l.revoked_at is not null then
    raise exception 'This claim link was cancelled.' using errcode = 'P0001', hint = 'link_revoked';
  elsif l.expires_at <= now() then
    raise exception 'This claim link has expired.' using errcode = 'P0001', hint = 'link_expired';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'This Seduh ID cannot be claimed.' using errcode = 'P0001', hint = 'identity_unavailable';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.identity_id = v_identity) then
    raise exception 'This Seduh ID has already been claimed.' using errcode = 'P0001', hint = 'identity_claimed';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.user_id = v_uid) then
    raise exception 'This login already has a Seduh ID.' using errcode = 'P0001', hint = 'account_exists';
  end if;
  if exists (select 1 from app.seduh_accounts a where a.handle = v_handle) then
    raise exception 'That handle is taken.' using errcode = 'P0001', hint = 'handle_taken';
  end if;

  -- the owner's #0001: a reservation for THIS identity, and nothing else, may pass the number explicitly
  select r.founding_number into v_number
    from app.seduh_reserved_numbers r
   where r.identity_id = v_identity and r.consumed_at is null
   for update;
  v_reserved := found;

  begin
    if v_reserved then
      perform set_config('app.seduh_owner_assignment', 'on', true);
      insert into app.seduh_accounts (identity_id, user_id, handle, founding_number, claim_method, adult_attested_at)
      values (v_identity, v_uid, v_handle, v_number, 'organiser_link', now())
      returning id, founding_number into v_acct, v_number;
      perform set_config('app.seduh_owner_assignment', '', true);
    else
      insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at)
      values (v_identity, v_uid, v_handle, 'organiser_link', now())
      returning id, founding_number into v_acct, v_number;
    end if;
  exception when unique_violation then
    -- a concurrent claim won the handle (or the login): say which, from the constraint
    perform set_config('app.seduh_owner_assignment', '', true);
    if exists (select 1 from app.seduh_accounts a where a.user_id = v_uid) then
      raise exception 'This login already has a Seduh ID.' using errcode = 'P0001', hint = 'account_exists';
    end if;
    raise exception 'That handle is taken.' using errcode = 'P0001', hint = 'handle_taken';
  end;

  if v_reserved then
    update app.seduh_reserved_numbers set account_id = v_acct, consumed_at = now()
     where identity_id = v_identity and consumed_at is null;
  end if;
  update app.seduh_claim_links set used_at = now(), account_id = v_acct where id = l.id;

  perform app.seduh_claim_audit_write('claim.complete', l.org_id, v_identity, l.id, v_acct,
    jsonb_build_object('claim_method', 'organiser_link', 'founding_number', v_number, 'reserved_number', v_reserved));

  return jsonb_build_object('handle', v_handle, 'founding_number', v_number, 'profile_path', '/id/' || v_handle || '/');
end;
$$;

-- ============ access ============
-- The organiser doors and the claim: signed-in callers only. The handle check: anyone. The Edge Function's door: the service role
-- only. Nothing to PUBLIC, and every function pins search_path to the empty string.

revoke all on function public.issue_seduh_claim_link(uuid) from public, anon, authenticated, service_role;
revoke all on function public.revoke_seduh_claim_link(uuid) from public, anon, authenticated, service_role;
revoke all on function public.seduh_claim_statuses(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.claim_seduh_id(text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.seduh_handle_available(text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_claim_begin(text) from public, anon, authenticated, service_role;

grant execute on function public.issue_seduh_claim_link(uuid) to authenticated;
grant execute on function public.revoke_seduh_claim_link(uuid) to authenticated;
grant execute on function public.seduh_claim_statuses(uuid, uuid[]) to authenticated;
grant execute on function public.claim_seduh_id(text, text, boolean) to authenticated;
grant execute on function public.seduh_handle_available(text) to anon, authenticated;
grant execute on function public.seduh_claim_begin(text) to service_role;
