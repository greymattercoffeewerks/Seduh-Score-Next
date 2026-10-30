-- Seduh Score Next · T-ID.B1: the Seduh ID identity tables (no data, no link yet)
--
-- Why: Seduh ID Layer 1 keeps a PRIVATE cross-organisation identity per validated E.164 phone (Handoffs and
-- Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md sections 3.1, 3.2, 3.5, 3.6; owner decisions of 2026-10-28 in
-- HANDOFF-CORRECTION-004.md: nobody can read an identity at Layer 1, key = surrogate uuid + unique E.164 phone).
-- This migration adds ONLY the two tables. The link (the foreign key and guard trigger on
-- people.global_person_id, the link function) is T-ID.B2; the roster table is T-ID.B3. Nothing writes these
-- tables yet, and no function reads them.
--
-- What this adds:
--   * app.seduh_identities: the platform-table pattern (CONVENTIONS "Platform tables and admin functions"): in the
--     `app` schema (so the tenant guards 033/040/042 do not apply and need no exemption), RLS on, NO policy, an
--     ACL naming only the owner, and every privilege revoked from public, anon, authenticated and service_role.
--     Columns are exactly spec 3.2. The CHECKs are real:
--       phone_e164  '^\+[1-9][0-9]{7,14}$', textually the shape of app.is_e164 and src/core/phone.js. NEVER null,
--                   unique: for an opted-out identity it stays as the suppression record (spec 3.5, E1).
--       display_name  conditional on status: an opted-out identity holds NO name (blanked); a merged tombstone
--                   may hold one or none; an active one holds 1 to 120 characters. Written as a CASE so a NULL
--                   name can never evaluate to NULL and slip past a CHECK.
--       source      organiser_roster | archive (the A1 provenance reservation).
--       status      active | opted_out | merged.
--       merged_into the tombstone pointer (spec 3.6 "Durability"): set if and only if status = 'merged', never to
--                   itself. A self-reference with ON DELETE RESTRICT, so a tombstone's target cannot vanish
--                   under it. Chains and cycles are NOT prevented here: the merge function (a later task)
--                   resolves through tombstones and is the only writer.
--     DECISION, spec 3.6 "do_not_link" (asked of this task): NO column, no extra status. do_not_link is the
--     marker an admin UNLINK writes, and an unlink is about ONE organisation's person row (a recycled number is
--     one identity covering two humans; the repair detaches one organisation's person, not the number). A flag
--     here would instead block every organisation's person for that phone, which is what opted_out already
--     means. So the marker belongs with the per-person link (T-ID.B2), where its shape depends on the guard and
--     the link function. Adding a nullable column or a table later is cheap; a dead column now invites misuse.
--   * app.seduh_identity_merges: the ledger of the audited merge (spec 3.2 companion). kept_id and merged_id are
--     BARE uuids with no foreign key (as person_merges is), so the ledger survives an identity being removed.
--     reason_code is a FIXED list (duplicate_person, phone_changed, recycled_number, other), never free text, and
--     the ledger holds NO phone and NO name (it is append-only, so a typed value would be kept for ever;
--     app.admin_audit_detail_ok checks keys, never values). merged_by is a bare uuid (the acting platform admin).
--     Append-only for EVERY role, the owner included, by the app.admin_audit_log pattern
--     (20261014110000_admin_audit_log.sql): a BEFORE UPDATE OR DELETE row trigger and a BEFORE TRUNCATE statement
--     trigger, both ENABLE ALWAYS (so they also fire under session_replication_role = replica).
--     HONEST LIMIT (same as the audit log): the table OWNER (`postgres`, the role migrations and execute_sql
--     run as) can still disable or drop the triggers or replace the trigger function. No tamper evidence.
--   * app.forbid_seduh_identity_merge_mutation(): the plain refusal (NOT security definer, like
--     forbid_admin_audit_mutation: a definer trigger function would need a membership gate under guard 045).
--
-- Nothing in `public` is added, so the cross-organisation matrices 040 (tables) and 041 (RPCs) need no entry.
-- ROLLBACK LOSES DATA once these tables hold rows (an identity table cannot be rebuilt from the tenant tables
-- alone, and the ledger is the only record of a merge): do not roll back a populated table.
--
-- rollback:
--   drop table if exists app.seduh_identity_merges;
--   drop table if exists app.seduh_identities;
--   drop function if exists app.forbid_seduh_identity_merge_mutation();

create table app.seduh_identities (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  display_name  text,
  country       text,
  source        text not null,
  status        text not null default 'active',
  merged_into   uuid references app.seduh_identities (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint seduh_identities_phone_e164_key unique (phone_e164),
  constraint seduh_identities_phone_e164_shape
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint seduh_identities_source_vocab
    check (source in ('organiser_roster', 'archive')),
  constraint seduh_identities_status_vocab
    check (status in ('active', 'opted_out', 'merged')),
  constraint seduh_identities_display_name_by_status
    check (case status
             when 'opted_out' then display_name is null
             when 'merged'    then display_name is null or char_length(display_name) between 1 and 120
             else display_name is not null and char_length(display_name) between 1 and 120
           end),
  constraint seduh_identities_country_length
    check (country is null or char_length(country) between 1 and 60),
  constraint seduh_identities_merged_into_iff_merged
    check ((status = 'merged') = (merged_into is not null)),
  constraint seduh_identities_not_merged_into_self
    check (merged_into is null or merged_into <> id)
);

-- Serves the tombstone resolution and the ON DELETE RESTRICT check on merged_into (the unique key serves phone
-- lookups, the primary key serves id lookups).
create index seduh_identities_merged_into_idx
  on app.seduh_identities (merged_into) where merged_into is not null;

create trigger trg_seduh_identities_set_updated_at
  before update on app.seduh_identities
  for each row execute function app.set_updated_at();

alter table app.seduh_identities enable row level security;
revoke all on app.seduh_identities from public, anon, authenticated, service_role;

create table app.seduh_identity_merges (
  id          bigint generated always as identity primary key,
  kept_id     uuid not null,
  merged_id   uuid not null,
  merged_at   timestamptz not null default now(),
  merged_by   uuid not null,
  reason_code text not null,
  constraint seduh_identity_merges_reason_vocab
    check (reason_code in ('duplicate_person', 'phone_changed', 'recycled_number', 'other')),
  constraint seduh_identity_merges_distinct
    check (kept_id <> merged_id)
);

alter table app.seduh_identity_merges enable row level security;
revoke all on app.seduh_identity_merges from public, anon, authenticated, service_role;
revoke all on sequence app.seduh_identity_merges_id_seq from public, anon, authenticated, service_role;

create or replace function app.forbid_seduh_identity_merge_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'seduh_identity_merges is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.forbid_seduh_identity_merge_mutation() from public, anon, authenticated, service_role;

create trigger trg_seduh_identity_merges_no_update_delete
  before update or delete on app.seduh_identity_merges
  for each row execute function app.forbid_seduh_identity_merge_mutation();
create trigger trg_seduh_identity_merges_no_truncate
  before truncate on app.seduh_identity_merges
  for each statement execute function app.forbid_seduh_identity_merge_mutation();
alter table app.seduh_identity_merges enable always trigger trg_seduh_identity_merges_no_update_delete;
alter table app.seduh_identity_merges enable always trigger trg_seduh_identity_merges_no_truncate;
