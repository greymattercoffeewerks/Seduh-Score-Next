-- Seduh Score Next · T-GATE.B3: the enforcement hooks (events, event_entries, go-live snapshot), shipped DARK
--
-- Why: the data model (20261023100000) and the audited writers (20261023110000) exist, but nothing consults them. This
-- migration adds the database-level checkpoints (spec: Handoffs and Specs/GATING-SPEC.md 3.4, D-G4, D-G8, D-G19, D-G29,
-- and the 7a risks), every one of which asks app.has_entitlement / app.entitlement_limit, so while every key is
-- unenforced (the seed) each hook is a no-op and behaviour is unchanged. Nothing is pushed to the cloud before the BTC
-- pitch (D-G13).
--
--   * events BEFORE INSERT (app.check_event_create). Opens with app.refuse_non_member(...) (BEFORE row triggers run
--     before row-level security, so a non-member must get the standard refusal first: test 045). Then, for a caller on
--     the API (a signed-in person or the anon/authenticated role; the table owner running a seed or a fixture is not
--     gated, exactly like refuse_non_member), a `btc` event needs btc_format at ORGANISATION level (the event does not
--     exist yet, so an event grant cannot apply: see the OPEN ITEM below). A caller can never insert the snapshot
--     columns (they are nulled).
--   * events.format is FROZEN (7a risk 1): otherwise a Community organisation could create a cup_taster event and
--     change it to btc, or the reverse to dodge the cap.
--   * events.entitlements_snapshot / entitlements_snapshot_at (D-G4): the tier an event resolved to when it first went
--     live, `{"tier": "..."}`, stamped by a trigger on live_sessions (first activation, NOT an edit to publish_session,
--     which a direct insert bypasses), set ONCE and then changeable only by the database's own definer functions (the
--     trigger below checks current_user, so a member's UPDATE of those columns is refused 23001 even for the stamp's
--     own organisation). From then on app.resolved_tier answers an event's questions from the snapshot (a lapsing or
--     revoked grant cannot strip a running event of people already registered, D-G6); a key with window_bound = false
--     (the registration page) ignores the snapshot. The keys' ENFORCED flags and the caps table are still read live.
--   * event_entries BEFORE INSERT and BEFORE UPDATE OF withdrawn (app.check_event_entry_cap, D-G19): a Cup Taster
--     event may not hold more active (non-withdrawn) entries than cup_taster_participants allows for its tier. It
--     (keyed so that an unknown format is capped as Cup Taster, never exempt: fail closed) runs under a per-event advisory lock (the roster can be open on several devices), counts only entries that are
--     not withdrawn, and applies to a new entry and to a REINSTATE (withdrawn true to false, a direct UPDATE that adds
--     a participant with no insert). A withdrawn row inserted withdrawn, and any update that does not reinstate, are not
--     gated. Refusal: 42501, message entitlement_cap_reached, hint entitlement_cap_reached, detail = the key.
--   * app.resolved_tier, and has_entitlement / entitlement_limit / my_entitlements REPLACED to use it.
--   * admin_event_resnapshot(p_event_id, p_reason) (audited, event.resnapshot): re-stamps an event's snapshot UPWARD
--     only (a grant bought after go-live; spec D-G4 "a platform admin can re-snapshot upward, audited"); a lower tier
--     is refused (snapshot_downgrade), the same tier is a no-op, an event with no snapshot is refused (snapshot_absent).
--
-- WHAT CHANGES WHILE DARK: the hooks that ask about entitlements are no-ops, and so is the go-live stamp (it writes
-- nothing until at least one key is enforced). The two things that apply immediately are the freeze of events.format
-- and the protection of the snapshot columns. Rollout notes: after the backfill and before enforcing a key, nothing needs
-- re-stamping; an event that went live when a key was already enforced but BEFORE its organisation's grant existed (or
-- before a future-dated Per-event window opened) keeps a lower tier until an admin runs admin_event_resnapshot.

-- A refusal by a hook is 42501 with a stable hint (entitlement_required, entitlement_cap_reached) and the key in the
-- DETAIL; the UI reads the hint, never the text.
--
-- NOT HERE (still open, logged in ROADMAP): the one-open-event rule for Community (D-G20/D-G23, "ended" needs a
-- database definition); events.status / events.is_test being member-writable (7a risk 2: a rule that exempts test
-- events is bypassable, so none is exempted here); the Per-event window lock (G-B5); the publish / results / branding
-- hooks.
--
-- OPEN ITEM (needs the owner): a BTC event is gated at creation by the ORGANISATION's tier, but Per-event is an EVENT
-- grant and an event grant needs the event to exist first (admin_grant_create takes the event). Until that is settled
-- (options: the operator holds a short organisation grant for the purchaser while the event is made; or BTC is gated at
-- first go-live, where the snapshot already exists), switching btc_format on would stop a Per-event BTC buyer from
-- creating their event. It is dark, so nothing is stranded today.
--
-- The rollback restores the B1 bodies of the three functions; the snapshot columns, and any snapshot already stamped,
-- are dropped with them.
-- rollback:
--   drop function if exists public.admin_event_resnapshot(uuid, text);
--   drop trigger if exists trg_live_sessions_stamp_entitlements on public.live_sessions;
--   drop trigger if exists trg_event_entries_cap_reinstate on public.event_entries;
--   drop trigger if exists trg_event_entries_cap_insert on public.event_entries;
--   drop trigger if exists trg_events_snapshot_frozen on public.events;
--   drop trigger if exists trg_events_org_immutable on public.events;
--   create trigger trg_events_org_immutable before update of id, org_id on public.events
--     for each row execute function app.forbid_parent_change('id', 'org_id');
--   drop trigger if exists trg_events_entitlement_create on public.events;
--   create or replace function app.entitlement_limit(p_org uuid, p_key text, p_event uuid default null, p_at timestamptz default now())
--   returns int language plpgsql stable security definer set search_path = '' as $f$
--   declare v_key app.entitlement_keys; v_limit int;
--   begin
--     select * into v_key from app.entitlement_keys where key = p_key;
--     if not found then raise exception 'entitlements: unknown key "%"', p_key using errcode = '22023', hint = 'entitlement_key_unknown'; end if;
--     if v_key.kind <> 'cap' then raise exception 'entitlements: "%" is not a capped key', p_key using errcode = '22023', hint = 'entitlement_key_not_cap'; end if;
--     if not v_key.enforced then return null; end if;
--     select c.cap_limit into v_limit from app.entitlement_caps c
--      where c.key = p_key and c.tier = app.effective_tier(p_org, p_event, p_at, not v_key.window_bound);
--     return v_limit;
--   end; $f$;
--   create or replace function app.has_entitlement(p_org uuid, p_key text, p_event uuid default null, p_at timestamptz default now())
--   returns boolean language plpgsql stable security definer set search_path = '' as $f$
--   declare v_key app.entitlement_keys; v_tier text; v_limit int;
--   begin
--     select * into v_key from app.entitlement_keys where key = p_key;
--     if not found then raise exception 'entitlements: unknown key "%"', p_key using errcode = '22023', hint = 'entitlement_key_unknown'; end if;
--     if not v_key.enforced then return true; end if;
--     if v_key.kind = 'cap' then v_limit := app.entitlement_limit(p_org, p_key, p_event, p_at); return v_limit is null or v_limit > 0; end if;
--     if v_key.min_tier is null then return true; end if;
--     v_tier := app.effective_tier(p_org, p_event, p_at, not v_key.window_bound);
--     return (select r.rank from app.entitlement_tiers r where r.tier = v_tier) >= (select m.rank from app.entitlement_tiers m where m.tier = v_key.min_tier);
--   end; $f$;
--   create or replace function public.my_entitlements(p_org uuid, p_event uuid default null)
--   returns jsonb language plpgsql stable security definer set search_path = '' as $f$
--   declare v_keys jsonb := '{}'::jsonb; k record;
--   begin
--     if not app.is_org_member(p_org) or (p_event is not null and app.org_id_for_event_internal(p_event) is distinct from p_org) then
--       raise exception 'my_entitlements: organisation not found' using errcode = '42501'; end if;
--     for k in select * from app.entitlement_keys order by key loop
--       v_keys := v_keys || jsonb_build_object(k.key, case when k.kind = 'cap'
--         then jsonb_build_object('allowed', app.has_entitlement(p_org, k.key, p_event), 'limit', app.entitlement_limit(p_org, k.key, p_event))
--         else jsonb_build_object('allowed', app.has_entitlement(p_org, k.key, p_event)) end);
--     end loop;
--     return jsonb_build_object('tier', app.effective_tier(p_org, p_event), 'keys', v_keys);
--   end; $f$;
--   drop function if exists app.resolved_tier(uuid, uuid, timestamptz, boolean);
--   drop function if exists app.forbid_event_snapshot_edit();
--   drop function if exists app.stamp_event_entitlements();
--   drop function if exists app.check_event_entry_cap();
--   drop function if exists app.check_event_create();
--   drop function if exists app.entitlement_api_caller();
--   alter table public.events drop column if exists entitlements_snapshot_at;
--   alter table public.events drop column if exists entitlements_snapshot;

alter table public.events add column entitlements_snapshot jsonb;
alter table public.events add column entitlements_snapshot_at timestamptz;

-- ============ who is a caller on the API (the same test as app.refuse_non_member) ============

create or replace function app.entitlement_api_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null or current_setting('role', true) in ('authenticated', 'anon');
$$;
revoke all on function app.entitlement_api_caller() from public, anon, authenticated, service_role;

-- ============ the snapshot-aware tier ============

create or replace function app.resolved_tier(
  p_org uuid,
  p_event uuid default null,
  p_at timestamptz default now(),
  p_ignore_window boolean default false
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.entitlements_snapshot ->> 'tier'
       from public.events e
       join app.entitlement_tiers t on t.tier = e.entitlements_snapshot ->> 'tier'
      where e.id = p_event and e.org_id = p_org and not p_ignore_window),
    app.effective_tier(p_org, p_event, p_at, p_ignore_window));
$$;
revoke all on function app.resolved_tier(uuid, uuid, timestamptz, boolean) from public, anon, authenticated, service_role;

create or replace function app.entitlement_limit(
  p_org uuid,
  p_key text,
  p_event uuid default null,
  p_at timestamptz default now()
)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key app.entitlement_keys;
  v_limit int;
begin
  select * into v_key from app.entitlement_keys where key = p_key;
  if not found then
    raise exception 'entitlements: unknown key "%"', p_key
      using errcode = '22023', hint = 'entitlement_key_unknown';
  end if;
  if v_key.kind <> 'cap' then
    raise exception 'entitlements: "%" is not a capped key', p_key
      using errcode = '22023', hint = 'entitlement_key_not_cap';
  end if;
  if not v_key.enforced then
    return null;
  end if;
  select c.cap_limit into v_limit
    from app.entitlement_caps c
   where c.key = p_key
     and c.tier = app.resolved_tier(p_org, p_event, p_at, not v_key.window_bound);
  return v_limit;
end;
$$;

create or replace function app.has_entitlement(
  p_org uuid,
  p_key text,
  p_event uuid default null,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key   app.entitlement_keys;
  v_tier  text;
  v_limit int;
begin
  select * into v_key from app.entitlement_keys where key = p_key;
  if not found then
    raise exception 'entitlements: unknown key "%"', p_key
      using errcode = '22023', hint = 'entitlement_key_unknown';
  end if;
  if not v_key.enforced then
    return true;
  end if;
  if v_key.kind = 'cap' then
    v_limit := app.entitlement_limit(p_org, p_key, p_event, p_at);
    return v_limit is null or v_limit > 0;
  end if;
  if v_key.min_tier is null then
    return true;
  end if;
  v_tier := app.resolved_tier(p_org, p_event, p_at, not v_key.window_bound);
  return (select r.rank from app.entitlement_tiers r where r.tier = v_tier)
      >= (select m.rank from app.entitlement_tiers m where m.tier = v_key.min_tier);
end;
$$;

create or replace function public.my_entitlements(p_org uuid, p_event uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_keys jsonb := '{}'::jsonb;
  k      record;
begin
  -- One refusal for "not your organisation" and "not that organisation's event": no oracle on other tenants.
  if not app.is_org_member(p_org)
     or (p_event is not null and app.org_id_for_event_internal(p_event) is distinct from p_org) then
    raise exception 'my_entitlements: organisation not found' using errcode = '42501';
  end if;
  for k in select * from app.entitlement_keys order by key loop
    v_keys := v_keys || jsonb_build_object(
      k.key,
      case when k.kind = 'cap'
        then jsonb_build_object(
          'allowed', app.has_entitlement(p_org, k.key, p_event),
          'limit', app.entitlement_limit(p_org, k.key, p_event))
        else jsonb_build_object('allowed', app.has_entitlement(p_org, k.key, p_event)) end);
  end loop;
  return jsonb_build_object('tier', app.resolved_tier(p_org, p_event), 'keys', v_keys);
end;
$$;

-- ============ events: creation gate, format freeze, snapshot protection ============

create or replace function app.check_event_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(new.org_id, 'events');
  if app.entitlement_api_caller() then
    -- the snapshot is the database's to write, never the client's
    new.entitlements_snapshot := null;
    new.entitlements_snapshot_at := null;
    if new.format = 'btc' and not app.has_entitlement(new.org_id, 'btc_format') then
      raise exception 'entitlement_required'
        using errcode = '42501', hint = 'entitlement_required', detail = 'btc_format';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.check_event_create() from public, anon, authenticated, service_role;

create trigger trg_events_entitlement_create
  before insert on public.events
  for each row execute function app.check_event_create();

-- a change of format is refused for everyone, the table owner included: format joins the columns the existing
-- immutability trigger guards (one trigger, so test 018's "guarded columns = the immutable bucket" stays exact)
drop trigger trg_events_org_immutable on public.events;
create trigger trg_events_org_immutable
  before update of id, org_id, format on public.events
  for each row execute function app.forbid_parent_change('id', 'org_id', 'format');

-- Set once, then only the database's definer functions may change it: current_user is the function owner inside
-- them and the API role for a member's own statement (a plain function, so it sees the invoking role).
create or replace function app.forbid_event_snapshot_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator', 'service_role')
     and (new.entitlements_snapshot is distinct from old.entitlements_snapshot
          or new.entitlements_snapshot_at is distinct from old.entitlements_snapshot_at) then
    raise exception 'events.entitlements_snapshot is written by the database only' using errcode = '23001';
  end if;
  return new;
end;
$$;
revoke all on function app.forbid_event_snapshot_edit() from public, anon, authenticated, service_role;

create trigger trg_events_snapshot_frozen
  before update of entitlements_snapshot, entitlements_snapshot_at on public.events
  for each row execute function app.forbid_event_snapshot_edit();

-- ============ the go-live stamp (first activation of the event's live session) ============

create or replace function app.stamp_event_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- While NO key is enforced the stamp is a no-op: an event that goes live in the dark phase (before the backfill has
  -- given existing organisations their plan) would otherwise be frozen at 'community' for good, and the first flip
  -- would cap it. Such an event resolves live until a key is enforced and it next goes live.
  if new.active and (tg_op = 'INSERT' or not old.active)
     and exists (select 1 from app.entitlement_keys k where k.enforced) then
    update public.events e
       set entitlements_snapshot = jsonb_build_object('tier', app.effective_tier(e.org_id, e.id, now())),
           entitlements_snapshot_at = now()
     where e.id = new.event_id and e.org_id = new.org_id and e.entitlements_snapshot is null;
  end if;
  return null;
end;
$$;
revoke all on function app.stamp_event_entitlements() from public, anon, authenticated, service_role;

create trigger trg_live_sessions_stamp_entitlements
  after insert or update on public.live_sessions
  for each row execute function app.stamp_event_entitlements();

-- ============ the participant cap (Cup Taster) ============

create or replace function app.check_event_entry_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_format text;
  v_key    text;
  v_limit  int;
begin
  v_org := app.org_id_for_event_internal(new.event_id);
  perform app.refuse_non_member(v_org, 'event_entries');

  -- only an insert of an active entry, or a reinstate (withdrawn true to false), adds a participant
  if new.withdrawn then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.withdrawn then
    return new;
  end if;
  if not app.entitlement_api_caller() then
    return new;
  end if;

  select e.format into v_format from public.events e where e.id = new.event_id;
  -- events.format is free text, and the app treats every format it does not know as Cup Taster (main.js sends only
  -- 'btc' to the BTC screens), so the cap is keyed the other way round: only the formats that are KNOWN not to have
  -- registered participants are exempt; anything else (a typo, another case, a future format that has not yet declared
  -- its own key) is capped as Cup Taster. A new format adds its own key and its own branch here in its first commit.
  v_key := case when v_format in ('btc', 'guess_the_bean') then null else 'cup_taster_participants' end;
  if v_key is null then
    return new;
  end if;

  -- the roster can be open on several devices: count and decide under one lock per event
  perform pg_advisory_xact_lock(hashtext('entitlement_cap:' || new.event_id::text));

  v_limit := app.entitlement_limit(v_org, v_key, new.event_id);
  if v_limit is null then
    return new;
  end if;
  if (select count(*) from public.event_entries x
       where x.event_id = new.event_id and not x.withdrawn and x.id <> new.id) >= v_limit then
    raise exception 'entitlement_cap_reached'
      using errcode = '42501', hint = 'entitlement_cap_reached', detail = v_key;
  end if;
  return new;
end;
$$;
revoke all on function app.check_event_entry_cap() from public, anon, authenticated, service_role;

create trigger trg_event_entries_cap_insert
  before insert on public.event_entries
  for each row execute function app.check_event_entry_cap();
create trigger trg_event_entries_cap_reinstate
  before update of withdrawn on public.event_entries
  for each row execute function app.check_event_entry_cap();

-- ============ re-snapshot upward (audited) ============

create or replace function public.admin_event_resnapshot(p_event_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ev     public.events;
  v_reason text;
  v_from   text;
  v_to     text;
begin
  perform app.require_platform_admin();

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'admin_event_resnapshot: a reason is required'
      using errcode = '22023', hint = 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'admin_event_resnapshot: the reason is too long'
      using errcode = '22023', hint = 'reason_too_long';
  end if;

  select * into v_ev from public.events e where e.id = p_event_id for no key update;
  if not found then
    raise exception 'admin_event_resnapshot: no such event'
      using errcode = '22023', hint = 'event_not_found';
  end if;
  if v_ev.entitlements_snapshot is null then
    raise exception 'admin_event_resnapshot: that event has no snapshot (it resolves live)'
      using errcode = '22023', hint = 'snapshot_absent';
  end if;

  v_from := v_ev.entitlements_snapshot ->> 'tier';
  v_to := app.effective_tier(v_ev.org_id, v_ev.id, now());
  if (select r.rank from app.entitlement_tiers r where r.tier = v_to)
     < coalesce((select r.rank from app.entitlement_tiers r where r.tier = v_from), -1) then
    raise exception 'admin_event_resnapshot: a snapshot only moves up'
      using errcode = '22023', hint = 'snapshot_downgrade';
  end if;
  -- the same tier: nothing to do, nothing to log
  if v_to = v_from then
    return;
  end if;

  update public.events
     set entitlements_snapshot = jsonb_build_object('tier', v_to), entitlements_snapshot_at = now()
   where id = v_ev.id;

  perform app.admin_audit(
    'event.resnapshot', v_ev.org_id, null,
    jsonb_build_object('event_id', v_ev.id, 'from', v_from, 'to', v_to, 'reason', v_reason));
end;
$$;

revoke all on function public.admin_event_resnapshot(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_event_resnapshot(uuid, text) to authenticated;
