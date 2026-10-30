-- Seduh Score Next · T-ID.B2: the link between a person and a Seduh ID identity
--
-- Why: Seduh ID Layer 1 (Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md 3.3, 3.5, 3.6, 4.1; owner decisions of
-- 2026-10-28 in HANDOFF-CORRECTION-004.md). B1 added the private identity tables; this makes people.global_person_id
-- a real, DATABASE-WRITTEN reference to one. Nothing here creates an identity (creation is B4 / D1 / the owner only)
-- and nothing makes an identity readable: a member sees, on their own people rows, an opaque uuid and nothing else.
--
-- What this adds:
--   1. app.guard_people_global_person_id(): BEFORE INSERT OR UPDATE on people. No API caller can set or change
--      global_person_id (NULL to uuid, uuid to uuid, uuid to NULL, a two-organisation member included, SQLSTATE
--      42501). The only writers are the link function below and the owner (migrations, owner SQL, B4's backfill),
--      and each must say so: the guard lets a change through only when the TRANSACTION-LOCAL flag
--      `app.seduh_link_write` is 'on' (set_config(..., true)) AND the current role is not an API role. The flag is
--      the opt-in (a future SECURITY DEFINER function that copies client data into people stays refused until it
--      deliberately sets the flag); the role test is the backstop, so a flag an API caller managed to set is still
--      refused. This is spec 3.3's preferred shape over guard_event_ended's role deny-list on its own. The flag is
--      reset to '' by the writer straight after its statement.
--      Also: when `phone` changes (update_roster_entry and a direct update both rewrite it) the trigger sets
--      global_person_id to NULL, so a stale link never survives a number change; the next link call re-evaluates.
--      The FK's ON DELETE SET NULL (below) is a referential action, not a writer: it is recognised as a nested
--      (pg_trigger_depth() > 1) NULL-ing update that changes no other column's phone, run by a non-API role, and
--      passes by design (spec 3.3). Assumption, stated: no trigger in this schema updates people, so depth > 1 can be
--      reached only through that action; a catalog test (062) pins "no other function writes the column".
--   2. FK people.global_person_id -> app.seduh_identities(id) ON DELETE SET NULL (the column stays nullable).
--      SAFE ON A DATABASE THAT ALREADY HOLDS VALUES: a guard (the people_phone_e164 pattern) counts the rows whose
--      value names no identity and, if any, raises with the COUNT and a hint, never a value, changing nothing; the
--      migration can then be pushed again after the owner looks. DECISION: raise, not "null the unknown values
--      first". The owner's A1 audit found no stored value (2026-10-29: 0 of 40), so nothing is lost by refusing, and
--      silently destroying a value that someone wrote on purpose is worse than stopping a push. B1 created the
--      identity table empty, so on any database today every non-NULL value is "unknown".
--   3. app.org_id_for_person_internal(uuid): the B6 `_internal` resolver (never depends on who is calling,
--      executable by no API role), used by the link function so a missing person and another organisation's person
--      are the SAME refusal.
--   4. app.person_link_blocks: the per-person "do not link" marker (the home B1 left open, see below).
--   5. public.link_person_identity(p_org_id, p_person_id) returns void: SECURITY DEFINER, search_path '',
--      executable by `authenticated` only. Opens with app.refuse_non_member, so a non-member, a NULL organisation,
--      a wrong organisation, a missing person and another organisation's person are ONE 42501 with ONE message
--      (verified in 062 and over real PostgREST in tests/e2e/identity-link-live.spec.js). It only FINDS an identity
--      for the own-organisation person's phone and sets the link; it NEVER creates one; it returns nothing; it
--      links an opted_out identity too (inert), so the readable link cannot tell a member which phones objected; a
--      merged tombstone resolves through merged_into (bounded; a cycle links nothing). A blocked person (4) is left
--      unlinked. Idempotent.
--
-- DECISION 1 (B1 hand-over): where per-organisation UNLINK lives. Layer 1 has NO admin function and NO console
-- screen for it (owner decision 7: counts only, merges and unlinks by owner SQL). An unlink is OWNER SQL, in one
-- transaction, and it must be DURABLE, otherwise the next link call would re-link the person. So it writes a marker:
-- app.person_link_blocks (person_id, phone_e164): "this person row is not to be linked while it holds this phone".
-- Keyed by the person row (an unlink detaches one organisation's person, not the number: opted_out already blocks
-- the number everywhere) and by the phone it was written for, so a phone change makes the block lapse on its own,
-- as it does the link, with no trigger needed. It cascades with the person row. The runbook is in CONVENTIONS.md
-- ("Seduh ID link: the owner's runbook"). Nothing reads it but the link function. If the owner later wants an
-- audited admin function, it is a new migration on top of this table.
--   The block is for that organisation's person ROW: one of its own members can delete and re-create the person and
--   the next link call re-links it (opted_out is the number-wide control). It has no org_id column on purpose: it is a
--   platform table in `app` (no API role can read it), reached by the person's id, and cascades with the person.
--   merge_people interaction (spec 3.6): it deletes the merged people row, so that row's link (and block) go with
--   it. The kept row is re-linked by phone on its next link call. B3's merge_people is NOT changed here: nothing in
--   this migration needs it, and a block on a deleted row is moot (two rows of one organisation never share a phone,
--   so the kept row's number is a different number).
-- DECISION 2 (B1 hand-over): when a merge blanks a name. There is NO merge function in Layer 1 (decision 7), so
-- nothing blanks a name automatically. The owner's merge SQL (runbook) keeps the merged tombstone's display_name
-- AS IS; it blanks it (display_name = NULL, allowed for a tombstone by B1's CHECK) only on an erasure/objection
-- request for that person, as a separate explicit step. Rationale: a name left on a tombstone helps an operator
-- answer an access request and costs nothing at Layer 1 (no API role can read it); blanking is the erasure act, not
-- a side effect of tidying duplicates. The runbook also REFUSES to merge an opted_out identity (status is
-- single-valued: merging it would turn it into 'merged' and lose the opt-out, and the next link would resolve the
-- phone to the kept identity) and checks the kept identity is not a descendant of the merged one (no cycle).
--
-- Remaining signals, accepted and named (spec 3.3), for the owner:
--   (1) a member can insert a people row with any phone and call the link; whether global_person_id ends up set
--       reveals that an identity exists for that phone, i.e. (identities being created only from a published
--       non-test result) that a published result for it exists: a new, weak oracle by phone for a fact the archive
--       already shows by name. Opted-out phones are indistinguishable from active ones.
--   (2) two organisations see the SAME uuid for the same person, so a member of two organisations can correlate.
--   Timing differs by microseconds (B6 recorded the same class).
--
-- rollback: (once rows exist, dropping the table app.person_link_blocks loses the owner's unlinks)
--   drop function if exists public.link_person_identity(uuid, uuid);
--   drop trigger if exists trg_people_global_person_id_guard on public.people;
--   alter table public.people drop constraint if exists people_global_person_id_fkey;
--   drop function if exists app.guard_people_global_person_id();
--   drop function if exists app.org_id_for_person_internal(uuid);
--   drop table if exists app.person_link_blocks;

-- ============ (2) the foreign key's guard: stored values that name no identity ============

do $guard$
declare
  v_unknown bigint;
begin
  select count(*) into v_unknown
  from public.people p
  where p.global_person_id is not null
    and not exists (select 1 from app.seduh_identities i where i.id = p.global_person_id);

  if v_unknown > 0 then
    raise exception 'people_global_person_id_fkey: % row(s) in public.people hold a global_person_id that names no Seduh ID identity. Look at them as the owner; nothing was changed.', v_unknown
      using hint = 'people_global_person_id_unknown';
  end if;
end;
$guard$;

-- ============ (4) the per-person block ============

create table app.person_link_blocks (
  person_id  uuid primary key references public.people (id) on delete cascade,
  phone_e164 text not null,
  blocked_at timestamptz not null default now(),
  constraint person_link_blocks_phone_e164_shape
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

alter table app.person_link_blocks enable row level security;
revoke all on app.person_link_blocks from public, anon, authenticated, service_role;

-- ============ (3) the resolver ============

create or replace function app.org_id_for_person_internal(p_person_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.people where id = p_person_id;
$$;
revoke all on function app.org_id_for_person_internal(uuid) from public, anon, authenticated, service_role;

-- ============ (1) the guard ============

create or replace function app.guard_people_global_person_id()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_writer  boolean := coalesce(current_setting('app.seduh_link_write', true), '') = 'on'
                       and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator');
  v_changes boolean;
begin
  if tg_op = 'INSERT' then
    v_changes := new.global_person_id is not null;
  else
    v_changes := new.global_person_id is distinct from old.global_person_id;
  end if;

  if v_changes and not v_writer then
    -- the FK's ON DELETE SET NULL: nested, clears the value, touches no phone, not an API role
    if tg_op = 'UPDATE' and new.global_person_id is null and pg_trigger_depth() > 1
       and new.phone is not distinct from old.phone
       and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
      return new;
    end if;
    raise exception 'people.global_person_id is written by the database only'
      using errcode = '42501', hint = 'global_person_id_database_only';
  end if;

  -- a stale link must not survive a number change (an explicit write by the link writer is kept)
  if tg_op = 'UPDATE' and new.phone is distinct from old.phone and not v_writer then
    new.global_person_id := null;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_people_global_person_id() from public, anon, authenticated, service_role;

create trigger trg_people_global_person_id_guard
  before insert or update on public.people
  for each row execute function app.guard_people_global_person_id();

-- ============ (2) the foreign key ============

alter table public.people
  add constraint people_global_person_id_fkey
  foreign key (global_person_id) references app.seduh_identities (id) on delete set null;

-- ============ (5) the link function ============

create or replace function public.link_person_identity(p_org_id uuid, p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone  text;
  v_id     uuid;
  v_status text;
  v_next   uuid;
  v_hops   int := 0;
begin
  -- 1. membership first: a non-member (or a NULL organisation) gets the standard refusal whatever ids they name
  perform app.refuse_non_member(p_org_id, 'people');
  -- 2. a missing person and another organisation's person: the SAME refusal (message and SQLSTATE)
  if app.org_id_for_person_internal(p_person_id) is distinct from p_org_id then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  -- the person row is locked while we decide, and the final update re-checks the phone, so a number changed by a
  -- concurrent writer (update_roster_entry on another device) cannot be left linked to the OLD number's identity
  select phone into v_phone from public.people where id = p_person_id for update;

  -- a block written for an earlier number no longer applies (and must not revive if the number comes back)
  delete from app.person_link_blocks where person_id = p_person_id and phone_e164 <> v_phone;

  -- an owner-set block (unlink) holds while the person still has the phone it was written for
  if exists (select 1 from app.person_link_blocks b where b.person_id = p_person_id and b.phone_e164 = v_phone) then
    return;
  end if;

  select i.id, i.status, i.merged_into into v_id, v_status, v_next
  from app.seduh_identities i where i.phone_e164 = v_phone;
  if v_id is null then
    return;                                  -- no identity: nothing is created, nothing is said
  end if;

  -- a merged tombstone resolves through merged_into (bounded: a cycle, which the schema does not forbid, links nothing)
  while v_status = 'merged' loop
    v_hops := v_hops + 1;
    if v_hops > 8 then
      return;
    end if;
    select i.id, i.status, i.merged_into into v_id, v_status, v_next from app.seduh_identities i where i.id = v_next;
    if v_id is null then
      return;
    end if;
  end loop;

  -- opted_out is linked too (inert): the readable link must not tell a member which phones objected
  perform set_config('app.seduh_link_write', 'on', true);
  update public.people set global_person_id = v_id
   where id = p_person_id and phone = v_phone and global_person_id is distinct from v_id;
  perform set_config('app.seduh_link_write', '', true);
end;
$$;

revoke all on function public.link_person_identity(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.link_person_identity(uuid, uuid) to authenticated;
