-- Seduh Score Next · T-ID2.A2: the schema for CLAIMED Seduh IDs (Layer 2)
-- (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md sections 3, 4, 10, 14.4; scoping doc 6.6 to 6.8, 10.2.)
--
-- Tables, constraints and triggers ONLY. Nothing here is callable by a person: the claim, the public profile door and
-- sign-in are Phase B. Nothing writes these tables yet, and no function reads them.
--
-- What this adds (all in `app`, the platform-table pattern of app.seduh_identities: RLS on, NO policy, an ACL naming
-- only the owner, every privilege revoked from public, anon, authenticated and service_role):
--   * app.seduh_accounts: one row per CLAIMED identity. identity_id unique, user_id unique (an auth.users row, never an
--     org_members row, so app.is_org_member stays false for it), claimed_at, claim_method (organiser_link now, sms
--     reserved), adult_attested_at NOT NULL (L2-7: claiming needs "I am 18 or over"), closed_at.
--   * the HANDLE and the FOUNDING NUMBER, both on this table (see the two decisions below).
--   * app.seduh_profile_settings: one row per account, one column per privacy choice of spec section 4. The row is
--     created by a trigger on the account insert, so every account has one and starts from the L2-1 defaults.
--   * app.seduh_claim_links: the organiser-issued link (L2-2, option C): a SHA-256 hash of the token, never the token.
--   * app.seduh_identities.country_code: a nullable ISO 3166-1 alpha-2 code (shape as btc_teams.country_code, upper
--     case). The free-text `country` stays.
--
-- DECISION 1, where the handle lives: on app.seduh_accounts, NOT on app.seduh_identities. Layer 1 creates identities
-- for people who never log in (17 in the cloud, more with the feed); a handle is chosen at claim (spec 3.3), so an
-- identity-level column would be NULL for nearly every row, would need a "set once" rule on top of the freeze, and
-- would let a handle exist for a person who never claimed. On the account it is NOT NULL from the first insert, is
-- frozen from then on, and its life is exactly the account's life. A closed account keeps its row (it is never
-- deleted), so its handle stays taken: retired, never reissued.
--
-- DECISION 2, the #0001 reservation: the number comes from a sequence that STARTS AT 2 (minvalue 2, no cycle), so no
-- default-driven claim can ever receive 1, and the row can only get 1 by an EXPLICIT value. A BEFORE INSERT trigger
-- refuses an explicit 1 unless the transaction has set `app.seduh_owner_assignment` to 'on' (a deliberate, documented
-- step in CONVENTIONS.md, "Seduh ID #0001"). The unique constraint then makes 1 single-use for ever. This is a guard
-- against a slip or a buggy Phase B function, not a security boundary: nobody but the owner role can reach the table.
-- Gaps in the sequence (a rolled-back claim burns a number) are fine: numbers are never reissued, not never skipped.
-- No cohort columns: cohort rules are a 2b decision (L2-6).
--
-- DECISION 3, is app.seduh_claim_links tenant data? It carries an org_id (the issuing organisation) and an issued_by
-- user, so it is org-scoped. It is still NOT in the tenant matrices: 033/040/042 look only at `public` tables, no
-- organiser can read or write the table (no policy, no grant), and the organiser acts only through a Phase B function.
-- The tenancy rules are applied anyway, the cheap way: org_id and identity_id are FROZEN by forbid_parent_change (a link
-- cannot be moved to another organisation, SQLSTATE 23001), as are the token hash and the expiry (a credential cannot be
-- rewritten); and any future policy MUST use app.is_org_member(org_id), never read org_members directly (CLAUDE.md,
-- Tenancy). The Phase B issuing function must open with app.refuse_non_member(org_id) and prove the person is on that
-- organisation's roster; this migration cannot check that across tables.
--
-- WHY the tenant matrices 040 (tables) and 041 (RPCs) do not apply: there is no `public` table and no function here.
-- test 050 pins the table list for `app`, and test 079 pins the shape of these tables.
--
-- NEVER REISSUED, how it is held: accounts cannot be deleted or truncated (an ENABLE ALWAYS trigger; the table owner
-- could still drop it, the same honest limit as app.seduh_identity_merges); closed_at, once set, cannot be cleared;
-- the handle, the number, the identity and the claim facts are frozen; user_id is ON DELETE SET NULL (deleting a login
-- must not delete the account row, because the row is what retires the handle and the number), and is refused unless
-- the account is closed (account_user_or_closed).
-- AUDIT: spec section 14 says claims and links are audited. There is no audit column here: the audit row is written by
-- the Phase B issue and claim functions. Note too that org_id is ON DELETE CASCADE, so removing a throwaway organisation
-- by SQL also removes its claim links; the claim provenance a Phase B audit row records must therefore live outside
-- this table. An EXPIRED but unrevoked link still counts as open (a partial index cannot use now()): the Phase B issue
-- function must revoke expired links before issuing a new one. A closed account keeps its user_id (until the login is
-- deleted): Phase B sign-in and profile functions must reject closed_at is not null.
-- LATER (Phase B, not here): the claim function must check the identity is `active` and not merged; the merge function
-- must refuse to merge an identity that holds an account.
--
-- ROLLBACK LOSES DATA once these tables hold rows (a claim cannot be rebuilt, and a retired handle or number would be
-- free again): do not roll back a populated table.
--
-- rollback:
--   drop table if exists app.seduh_claim_links;
--   drop table if exists app.seduh_profile_settings;
--   drop table if exists app.seduh_accounts;
--   drop sequence if exists app.seduh_founding_number_seq;
--   drop function if exists app.seduh_claim_links_guard();
--   drop function if exists app.seduh_accounts_after_insert();
--   drop function if exists app.seduh_accounts_no_delete();
--   drop function if exists app.seduh_accounts_before_update();
--   drop function if exists app.seduh_accounts_before_insert();
--   drop function if exists app.seduh_handle_reserved(text);
--   alter table app.seduh_identities drop constraint if exists seduh_identities_country_code_shape;
--   alter table app.seduh_identities drop column if exists country_code;

-- ============ ISO country on the identity ============

alter table app.seduh_identities
  add column country_code text,
  add constraint seduh_identities_country_code_shape check (country_code ~ '^[A-Z]{2}$');

-- ============ the reserved handles: ONE place ============
-- A handle is a path segment under /id/, and must never collide with a fixed page (/id/country/...) or a word the
-- site may need. To extend the list: a NEW migration that does `create or replace function` with the longer array
-- (existing handles are not rechecked: a handle is frozen, so a later reservation only stops NEW claims).
create function app.seduh_handle_reserved(p_handle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_handle = any (array[
    'about', 'admin', 'api', 'app', 'assets', 'bts', 'claim', 'community', 'contact', 'country', 'countries',
    'edit', 'event', 'events', 'favicon', 'guess-the-bean', 'help', 'id', 'index', 'live', 'login', 'logout', 'me',
    'moderator', 'new', 'null', 'official', 'org', 'orgs', 'owner', 'pricing', 'privacy', 'public', 'results', 'robots',
    'root', 'score', 'security', 'seduh', 'seduh-score', 'seduhscore', 'staff', 'settings', 'signin', 'signup', 'sitemap', 'static', 'support', 'team', 'teams', 'terms', 'tools',
    'tour', 'undefined', 'www'
  ]);
$$;
revoke all on function app.seduh_handle_reserved(text) from public, anon, authenticated, service_role;

-- ============ the account ============

create sequence app.seduh_founding_number_seq as integer minvalue 2 start with 2 no cycle;
revoke all on sequence app.seduh_founding_number_seq from public, anon, authenticated, service_role;

create table app.seduh_accounts (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references app.seduh_identities (id) on delete restrict,
  user_id            uuid references auth.users (id) on delete set null,
  handle             text not null,
  founding_number    integer not null default nextval('app.seduh_founding_number_seq'),
  claimed_at         timestamptz not null default now(),
  claim_method       text not null,
  adult_attested_at  timestamptz not null,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint seduh_accounts_identity_id_key unique (identity_id),
  -- lets a claim link name BOTH its account and that account's identity (composite foreign key below)
  constraint seduh_accounts_id_identity_key unique (id, identity_id),
  constraint seduh_accounts_user_id_key unique (user_id),
  constraint seduh_accounts_handle_key unique (handle),
  constraint seduh_accounts_founding_number_key unique (founding_number),
  constraint seduh_accounts_handle_shape
    check (handle ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(handle) between 3 and 30),
  constraint seduh_accounts_founding_number_positive check (founding_number >= 1),
  constraint seduh_accounts_claim_method_vocab check (claim_method in ('organiser_link', 'sms')),
  constraint seduh_accounts_closed_after_claim check (closed_at is null or closed_at >= claimed_at),
  constraint seduh_accounts_user_or_closed check (user_id is not null or closed_at is not null)
);
alter sequence app.seduh_founding_number_seq owned by app.seduh_accounts.founding_number;

create function app.seduh_accounts_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.seduh_handle_reserved(new.handle) then
    raise exception 'seduh_accounts: the handle % is reserved', new.handle using errcode = '23514';
  end if;
  -- #0001 is the owner's. The sequence starts at 2, so only an explicit value can be 1, and only on purpose.
  if new.founding_number = 1
     and coalesce(current_setting('app.seduh_owner_assignment', true), '') <> 'on' then
    raise exception 'seduh_accounts: founding number 1 is reserved for the owner (see CONVENTIONS.md, Seduh ID #0001)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function app.seduh_accounts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception 'seduh_accounts: a closed account stays closed' using errcode = '23001';
  end if;
  -- user_id is not frozen (ON DELETE SET NULL must be able to clear it), but once cleared it is never set again:
  -- a closed account cannot be handed to another login
  if old.user_id is null and new.user_id is not null then
    raise exception 'seduh_accounts: a closed account cannot be given a new login' using errcode = '23001';
  end if;
  return new;
end;
$$;

create function app.seduh_accounts_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'seduh_accounts rows are never deleted: close the account (the handle and the number stay retired)'
    using errcode = '42501';
end;
$$;

create function app.seduh_accounts_after_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into app.seduh_profile_settings (account_id) values (new.id);
  return new;
end;
$$;

revoke all on function app.seduh_accounts_before_insert() from public, anon, authenticated, service_role;
revoke all on function app.seduh_accounts_before_update() from public, anon, authenticated, service_role;
revoke all on function app.seduh_accounts_no_delete() from public, anon, authenticated, service_role;
revoke all on function app.seduh_accounts_after_insert() from public, anon, authenticated, service_role;

-- ============ the privacy settings (spec section 4, L2-1) ============

create table app.seduh_profile_settings (
  account_id                uuid primary key references app.seduh_accounts (id) on delete restrict,
  -- name, photo, country: public or hidden
  vis_identity              text not null default 'public',
  -- results, judging roles: public, only organisers the person competed for, or hidden
  vis_recorded_results      text not null default 'public',
  vis_organiser_results     text not null default 'public',
  vis_self_reported_results text not null default 'public',
  vis_judging_roles         text not null default 'public',
  -- café affiliations: public or hidden (shown only once the café also confirms: a read-time rule, not stored)
  vis_cafe_affiliations     text not null default 'public',
  -- knockout win/loss and most-met opponent: public or hidden
  vis_knockout_record       text not null default 'public',
  -- "People from this country" listing (2b): off until the person turns it on
  listed_on_country_pages   boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint seduh_profile_settings_vis_identity_vocab
    check (vis_identity in ('public', 'hidden')),
  constraint seduh_profile_settings_vis_recorded_results_vocab
    check (vis_recorded_results in ('public', 'organisers', 'hidden')),
  constraint seduh_profile_settings_vis_organiser_results_vocab
    check (vis_organiser_results in ('public', 'organisers', 'hidden')),
  constraint seduh_profile_settings_vis_self_reported_results_vocab
    check (vis_self_reported_results in ('public', 'organisers', 'hidden')),
  constraint seduh_profile_settings_vis_judging_roles_vocab
    check (vis_judging_roles in ('public', 'organisers', 'hidden')),
  constraint seduh_profile_settings_vis_cafe_affiliations_vocab
    check (vis_cafe_affiliations in ('public', 'hidden')),
  constraint seduh_profile_settings_vis_knockout_record_vocab
    check (vis_knockout_record in ('public', 'hidden'))
);

create trigger trg_seduh_profile_settings_parent_immutable
  before update of account_id on app.seduh_profile_settings
  for each row execute function app.forbid_parent_change('account_id');
create trigger trg_seduh_profile_settings_set_updated_at
  before update on app.seduh_profile_settings
  for each row execute function app.set_updated_at();

-- ============ the claim link (L2-2, option C) ============

create table app.seduh_claim_links (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references app.seduh_identities (id) on delete restrict,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  issued_by    uuid references auth.users (id) on delete set null,
  -- the SHA-256 of the token as 64 lower-case hex characters; the raw token is never stored (a raw token that is not
  -- exactly this shape is refused, so a pasted token cannot land here by mistake)
  token_hash   text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '72 hours',
  used_at      timestamptz,
  account_id   uuid,
  revoked_at   timestamptz,
  -- the account a link made must be the account OF THE LINK'S OWN identity (match simple: NULL while unused)
  constraint seduh_claim_links_account_same_identity
    foreign key (account_id, identity_id) references app.seduh_accounts (id, identity_id) on delete restrict,
  constraint seduh_claim_links_token_hash_key unique (token_hash),
  constraint seduh_claim_links_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint seduh_claim_links_expiry_window
    check (expires_at > created_at and expires_at <= created_at + interval '72 hours'),
  constraint seduh_claim_links_used_in_window check (used_at is null or (used_at >= created_at and used_at <= expires_at)),
  constraint seduh_claim_links_used_iff_account check ((used_at is null) = (account_id is null)),
  constraint seduh_claim_links_not_used_and_revoked check (used_at is null or revoked_at is null)
);

-- Single use: at most one OPEN (unused, unrevoked) link per identity, so issuing a new one means revoking the old; an
-- account is created by at most one link.
create unique index seduh_claim_links_one_open_per_identity
  on app.seduh_claim_links (identity_id) where used_at is null and revoked_at is null;
create unique index seduh_claim_links_one_per_account
  on app.seduh_claim_links (account_id) where account_id is not null;
-- Foreign-key lookups (the identity side is served by the partial index only for open links).
create index seduh_claim_links_identity_idx on app.seduh_claim_links (identity_id);
create index seduh_claim_links_org_idx on app.seduh_claim_links (org_id);
create index seduh_claim_links_issued_by_idx on app.seduh_claim_links (issued_by) where issued_by is not null;

-- Frozen (tenancy rule, decision 3, and a credential must not be rewritten): the organisation, the identity, the hash,
-- the expiry. issued_by is not frozen: deleting the issuer's login sets it to NULL.
create trigger trg_seduh_claim_links_parent_immutable
  before update of id, org_id, identity_id, token_hash, created_at, expires_at on app.seduh_claim_links
  for each row execute function app.forbid_parent_change('id', 'org_id', 'identity_id', 'token_hash', 'created_at', 'expires_at');

-- One way only: a used or revoked link cannot be reopened, and a used link cannot be repointed at another account.
create function app.seduh_claim_links_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.used_at is not null and (new.used_at is distinct from old.used_at or new.account_id is distinct from old.account_id))
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'seduh_claim_links: a used or revoked link cannot be changed' using errcode = '23001';
  end if;
  return new;
end;
$$;
revoke all on function app.seduh_claim_links_guard() from public, anon, authenticated, service_role;
create trigger trg_seduh_claim_links_guard
  before update on app.seduh_claim_links
  for each row execute function app.seduh_claim_links_guard();

-- ============ triggers on the account (after the settings table exists) ============

create trigger trg_seduh_accounts_before_insert
  before insert on app.seduh_accounts
  for each row execute function app.seduh_accounts_before_insert();
create trigger trg_seduh_accounts_before_update
  before update on app.seduh_accounts
  for each row execute function app.seduh_accounts_before_update();
create trigger trg_seduh_accounts_set_updated_at
  before update on app.seduh_accounts
  for each row execute function app.set_updated_at();
-- the handle, the number, the identity and the claim facts never change; user_id is left out on purpose (ON DELETE SET NULL)
create trigger trg_seduh_accounts_parent_immutable
  before update of id, identity_id, handle, founding_number, claimed_at, claim_method, adult_attested_at on app.seduh_accounts
  for each row execute function app.forbid_parent_change(
    'id', 'identity_id', 'handle', 'founding_number', 'claimed_at', 'claim_method', 'adult_attested_at');
create trigger trg_seduh_accounts_no_delete
  before delete on app.seduh_accounts
  for each row execute function app.seduh_accounts_no_delete();
create trigger trg_seduh_accounts_no_truncate
  before truncate on app.seduh_accounts
  for each statement execute function app.seduh_accounts_no_delete();
alter table app.seduh_accounts enable always trigger trg_seduh_accounts_no_delete;
alter table app.seduh_accounts enable always trigger trg_seduh_accounts_no_truncate;
create trigger trg_seduh_accounts_after_insert
  after insert on app.seduh_accounts
  for each row execute function app.seduh_accounts_after_insert();

-- ============ access: owner only ============

alter table app.seduh_accounts enable row level security;
alter table app.seduh_profile_settings enable row level security;
alter table app.seduh_claim_links enable row level security;
revoke all on app.seduh_accounts from public, anon, authenticated, service_role;
revoke all on app.seduh_profile_settings from public, anon, authenticated, service_role;
revoke all on app.seduh_claim_links from public, anon, authenticated, service_role;
