-- Seduh Score Next · T-GATE.B1: the entitlement core (tables, resolvers, catalog seed), shipped DARK
--
-- Why: gating is a database boundary, not a client stub (spec: Handoffs and Specs/GATING-SPEC.md, local; 3.2, 3.3,
-- 3.6 and the owner decisions in 6d/6e, 2026-10-23). This migration adds only the data model and the pure
-- resolution functions. Nothing calls them yet and EVERY key is seeded `enforced = false`, so behaviour is unchanged
-- everywhere (D-G11): `has_entitlement` answers true for every key until an operator flips it with an audited admin
-- function (a later migration). No trigger, policy or RPC that exists today is touched.
--
-- What this adds:
--   * app.entitlement_tiers / app.entitlement_keys / app.entitlement_caps: platform reference data in the `app`
--     schema (not exposed by the API; RLS on with no policy and every API role's privileges revoked, the rule for
--     platform tables in CONVENTIONS.md). Seeded from supabase/entitlements.catalog.json, which is embedded below
--     verbatim as a dollar-quoted literal tagged "catalog" in the seed block; a Vitest contract test fails if the file and this seed differ, and
--     if src/core/entitlements.js disagrees with either (the "cannot drift" requirement).
--   * public.entitlement_grants: a TENANT table (D-G18): `org_id` is always set, `event_id` is an optional extra
--     (an event grant: Per-event). The pair is a composite foreign key to events(id, org_id), so an event grant can
--     only name an event of the same organisation, declaratively (events gains `unique (id, org_id)` for it).
--     Read-only through the API to the organisation's members; nobody writes through the API at all (no write
--     policy, no write privilege): rows come from the admin functions of a later migration. A grant is never
--     edited in place: every column except `revoked_at` is frozen by app.forbid_parent_change, so the history is the
--     table. (Deleting an event or an organisation cascades to its grants, on purpose: a test event must stay
--     deletable; the durable history is the admin audit log, which has no foreign keys.) Tier names are rows, not an enum, so a tier is a seed row.
--   * app.effective_tier / app.has_entitlement / app.entitlement_limit: SECURITY DEFINER resolvers in `app`, not
--     executable by any API role (the triggers and RPCs of later migrations are definers and reach them).
--   * public.my_entitlements(p_org, p_event): what the browser reads once per session to hide or explain things.
--     Member-gated: a non-member gets the standard 42501, and so does an event that is not the organisation's.
--
-- Resolution (3.1): the effective tier is the HIGHEST of the default (the lowest-ranked tier, no row needed), the
-- organisation's current grants and, for a given event, that event's current grants. "Current" = not revoked and
-- valid_from <= now < valid_until (null = open-ended). Highest wins, never a sum. A key with window_bound = false
-- (the registration page, D-G16) resolves from any non-revoked grant whatever its dates.
-- has_entitlement: unknown key raises (22023, hint entitlement_key_unknown); a key that is not enforced is allowed
-- for everyone; a flag key needs the effective tier to rank at or above min_tier (null = every tier); a cap key is
-- allowed unless its limit for the tier is 0. entitlement_limit: null = unlimited; also null while not enforced.
-- A missing caps row for a tier reads as unlimited, so the seed must carry one row per capped key and tier (pgTAP
-- 052 and the Vitest contract test check that). Time is compared in the database only; the optional p_at exists
-- so tests can pass a clock (threat model 4.6); the API never reaches these functions.
--
-- Not here (later steps): snapshot-at-first-publish (D-G4), the events / event_entries triggers (D-G8, D-G19), the
-- admin grant functions, the one-open-event rule, the Per-event window lock. Nothing is pushed to the cloud before
-- the BTC pitch (D-G13).
--
-- rollback:
--   drop function if exists public.my_entitlements(uuid, uuid);
--   drop function if exists app.entitlement_limit(uuid, text, uuid, timestamptz);
--   drop function if exists app.has_entitlement(uuid, text, uuid, timestamptz);
--   drop function if exists app.effective_tier(uuid, uuid, timestamptz, boolean);
--   drop table if exists public.entitlement_grants;
--   drop table if exists app.entitlement_caps;
--   drop table if exists app.entitlement_keys;
--   drop table if exists app.entitlement_tiers;
--   alter table public.events drop constraint if exists events_id_org_id_key;

-- ============ reference data (app schema, closed to every API role) ============

create table app.entitlement_tiers (
  tier text primary key check (tier ~ '^[a-z][a-z0-9_]*$'),
  rank int  not null unique check (rank >= 0)
);

create table app.entitlement_keys (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  kind         text not null check (kind in ('flag', 'cap')),
  min_tier     text references app.entitlement_tiers (tier),
  enforced     boolean not null default false,
  window_bound boolean not null default true,
  note         text,
  unique (key, kind),
  check (kind = 'flag' or min_tier is null)
);

create table app.entitlement_caps (
  key       text not null,
  kind      text not null default 'cap' check (kind = 'cap'),
  tier      text not null references app.entitlement_tiers (tier),
  cap_limit int check (cap_limit is null or cap_limit >= 0),   -- null = unlimited
  primary key (key, tier),
  foreign key (key, kind) references app.entitlement_keys (key, kind)
);

alter table app.entitlement_tiers enable row level security;
alter table app.entitlement_keys enable row level security;
alter table app.entitlement_caps enable row level security;
revoke all on app.entitlement_tiers, app.entitlement_keys, app.entitlement_caps
  from public, anon, authenticated, service_role;

-- seed from the catalog (embedded verbatim; test: src/core/entitlements.contract.test.js)
do $seed$
declare
  v_catalog jsonb := $catalog$
{
  "tiers": [
    {
      "tier": "community",
      "rank": 0
    },
    {
      "tier": "per_event",
      "rank": 1
    },
    {
      "tier": "annual",
      "rank": 2
    }
  ],
  "keys": [
    {
      "key": "cup_taster_participants",
      "kind": "cap",
      "min_tier": null,
      "window_bound": true,
      "note": "Active (non-withdrawn) roster entries per Cup Taster event. Community 8; Per-event and Annual unlimited (D-G3, D-G19). First key to be switched on (D-G27).",
      "caps": {
        "community": 8,
        "per_event": null,
        "annual": null
      }
    },
    {
      "key": "btc_format",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": true,
      "note": "Creating a BTC (Barista Team Championship) event. Not on Community (owner, 2026-10-23)."
    },
    {
      "key": "cup_taster_report",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": true,
      "note": "Printable report and CSV export (Cup Taster)."
    },
    {
      "key": "cup_taster_analytics",
      "kind": "flag",
      "min_tier": "annual",
      "window_bound": true,
      "note": "Per-cupper and per-set analytics (Cup Taster)."
    },
    {
      "key": "audience_branding",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": true,
      "note": "Own branding on audience screens (Level 2, D-G17). Planned; the key only reserves the gate."
    },
    {
      "key": "results_archive_optional",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": true,
      "note": "May choose not to list results in the public archive (Community listing is compulsory)."
    },
    {
      "key": "season_history",
      "kind": "flag",
      "min_tier": "annual",
      "window_bound": true,
      "note": "History across seasons. Planned (needs the archive)."
    },
    {
      "key": "registration_page",
      "kind": "flag",
      "min_tier": "per_event",
      "window_bound": false,
      "note": "Public registration page per event (Seduh ID layer 2). Not bound by the Per-event window (D-G16)."
    },
    {
      "key": "guess_the_bean_create",
      "kind": "flag",
      "min_tier": null,
      "window_bound": true,
      "note": "Creating a Guess the Bean session. Open to every tier (D-G5): registered, not gated."
    }
  ]
}
$catalog$::jsonb;
  k jsonb;
  t jsonb;
begin
  for t in select * from jsonb_array_elements(v_catalog -> 'tiers') loop
    insert into app.entitlement_tiers (tier, rank) values (t ->> 'tier', (t ->> 'rank')::int);
  end loop;
  for k in select * from jsonb_array_elements(v_catalog -> 'keys') loop
    insert into app.entitlement_keys (key, kind, min_tier, enforced, window_bound, note)
    values (k ->> 'key', k ->> 'kind', k ->> 'min_tier', false, coalesce((k ->> 'window_bound')::boolean, true), k ->> 'note');
    if k ->> 'kind' = 'cap' then
      for t in select * from jsonb_array_elements(v_catalog -> 'tiers') loop
        if not ((k -> 'caps') ? (t ->> 'tier')) then
          raise exception 'catalog: cap key % has no entry for tier %', k ->> 'key', t ->> 'tier';
        end if;
        insert into app.entitlement_caps (key, tier, cap_limit)
        values (k ->> 'key', t ->> 'tier', (k -> 'caps' ->> (t ->> 'tier'))::int);
      end loop;
    end if;
  end loop;
end
$seed$;

-- ============ grants (tenant table) ============

-- events must be able to be the target of a composite foreign key (id is already unique; this adds the pair)
alter table public.events add constraint events_id_org_id_key unique (id, org_id);

create table public.entitlement_grants (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  event_id         uuid,
  tier             text not null references app.entitlement_tiers (tier),
  valid_from       timestamptz not null default now(),
  valid_until      timestamptz,
  source           text not null check (source in ('default', 'manual', 'payment')),
  granted_by       uuid,                      -- deliberately no FK: the history outlives a login
  note             text check (note is null or char_length(note) <= 500),
  extends_grant_id uuid references public.entitlement_grants (id),
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint entitlement_grants_event_same_org
    foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade,
  constraint entitlement_grants_window check (valid_until is null or valid_until > valid_from)
);

create index entitlement_grants_org_idx on public.entitlement_grants (org_id, event_id);
create index entitlement_grants_event_idx on public.entitlement_grants (event_id);   -- serves the cascade from events

alter table public.entitlement_grants enable row level security;

create policy entitlement_grants_read on public.entitlement_grants
  for select using (app.is_org_member(org_id));
-- (no write policy on purpose: only the admin functions write, as the table owner)

-- Parent and identity columns frozen (tenancy rule), and so is everything else except revoked_at: a change is a
-- new row. Row-level, unconditional.
create trigger trg_entitlement_grants_parent_immutable
  before update on public.entitlement_grants
  for each row execute function app.forbid_parent_change(
    'id', 'org_id', 'event_id', 'tier', 'valid_from', 'valid_until', 'source', 'granted_by', 'note',
    'extends_grant_id', 'created_at');

-- The API roles may read (RLS narrows that to the organisation's members) and do nothing else. Revoke first:
-- a database built from scratch by a newer Supabase CLI hands every API role ALL privileges on a new table.
revoke all on public.entitlement_grants from public, anon, authenticated, service_role;
-- Column-level: operator metadata (granted_by, note) is not for tenants; members read the plan through my_entitlements.
grant select (id, org_id, event_id, tier, valid_from, valid_until, source, extends_grant_id, revoked_at, created_at)
  on public.entitlement_grants to authenticated;

-- ============ resolvers (SECURITY DEFINER, closed to the API roles) ============

create or replace function app.effective_tier(
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
    (select t.tier
       from public.entitlement_grants g
       join app.entitlement_tiers t on t.tier = g.tier
      where g.org_id = p_org
        and (g.event_id is null or g.event_id = p_event)
        and (g.revoked_at is null or g.revoked_at > p_at)
        and (p_ignore_window
             or (g.valid_from <= p_at and (g.valid_until is null or g.valid_until > p_at)))
      order by t.rank desc
      limit 1),
    (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1));
$$;

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
     and c.tier = app.effective_tier(p_org, p_event, p_at, not v_key.window_bound);
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
  v_tier := app.effective_tier(p_org, p_event, p_at, not v_key.window_bound);
  return (select r.rank from app.entitlement_tiers r where r.tier = v_tier)
      >= (select m.rank from app.entitlement_tiers m where m.tier = v_key.min_tier);
end;
$$;

revoke all on function app.effective_tier(uuid, uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
revoke all on function app.entitlement_limit(uuid, text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.has_entitlement(uuid, text, uuid, timestamptz) from public, anon, authenticated, service_role;

-- ============ what the browser reads ============

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
  return jsonb_build_object('tier', app.effective_tier(p_org, p_event), 'keys', v_keys);
end;
$$;

revoke all on function public.my_entitlements(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_entitlements(uuid, uuid) to authenticated;
