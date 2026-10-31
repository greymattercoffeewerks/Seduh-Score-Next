-- Seduh Score Next · T-ID.B4: the owner-run, idempotent identity backfill
--
-- Why: Seduh ID Layer 1 (Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md 2, 3.2, 3.3, 3.5, 4.1; owner decision 3 in
-- HANDOFF-CORRECTION-004.md: an identity is created ONLY from a published, non-test result, or by an admin). B1 made the
-- private identity tables, B2 made people.global_person_id database-written and a link function that only FINDS an
-- identity. Nothing has created one yet. This is the one-time step that creates the identities for the people the
-- platform already names publicly, and links the people rows behind them. It is also the function the later archive
-- feed (D1) can call, which is why it is a function and not only a script.
--
-- What this adds (all in `app`, executable by NO API role, service_role included):
--   1. app.seduh_backfill_slots_internal(p_result_ids): one row per "name slot" of every published non-test result (see below),
--      with how many event entries match the slot and, when exactly one does, the person behind it. Read-only.
--   2. app.seduh_backfill_plan_internal(p_result_ids): one row per named person with the decision the backfill takes for them
--      (eligible, bad_phone, blocked, merge_cycle) and the identity their phone already resolves to, if any. Read-only.
--   3. app.seduh_identity_backfill(p_apply boolean default false, p_result_ids uuid[] default null) returns jsonb: false = a dry run that writes nothing
--      and answers with counts and row ids; true = creates the missing identities, links the people, answers with the
--      same report plus what it did. SECURITY DEFINER, search_path '', refuses an API role by name as well as by ACL.
--
-- "NAMED IN A PUBLISHED RESULT", precisely. public_results.payload carries NAMES, never ids (and must not start
-- carrying ids: a public payload with internal ids is an enumeration aid). The payload's `podium` array is always
-- published; its `standings` array is present only when the organiser chose the full standings. A "name slot" is one
-- distinct (result, name, cafe) taken from those two arrays (name and cafe trimmed, a missing cafe equals an empty one).
-- A slot is matched to the event's entries by the same snapshot fields the payload was built from
-- (event_entries.display_name and .cafe, resultsPublishing.js). A person is NAMED when exactly ONE entry of the event
-- matches a slot, that entry has a person, and the person belongs to the event's organisation. Everything else is NOT a
-- person the platform names, so it creates nothing:
--   * a roster-only person, or one whose entry is not in the payload (a podium-only publish names three places);
--   * an entry with no person row (a walk-up);
--   * a slot that matches more than one entry (two entries with the same name and cafe: we cannot tell which one the
--     public archive means) or none (the entry was renamed or moved cafe after publishing). Counted, never guessed.
-- A test event's result is excluded (events.is_test; check_public_results_org already refuses to create one). The
-- person has no is_test column of their own: a rehearsal person can reach a result only through a test event.
--
-- What the backfill does per NAMED person (one decision, in this order):
--   bad_phone    phone fails app.is_e164: skipped and listed by person id, never repaired or guessed;
--   blocked      the owner unlinked this person (app.person_link_blocks, still holding the phone it was written for):
--                no identity is created for them and they stay unlinked;
--   merge_cycle  the phone's identity is a merged tombstone whose chain ends nowhere within 8 hops: listed, untouched;
--   eligible     everything else. The identity for the phone is REUSED when one exists (any status, an opted_out one
--                and a merged tombstone resolved through merged_into included; the unique phone is the match key and
--                nothing existing is overwritten), otherwise CREATED: source 'archive', status 'active', phone_e164 =
--                the phone, display_name = the earliest published record's name (trimmed, cut to 120; spec 3.2:
--                untrusted metadata), country = the first valid people.country in that order. Two organisations that
--                hold one phone get ONE identity; the output never says so. The person is then linked, exactly as
--                public.link_person_identity does it (the transaction-local flag app.seduh_link_write = 'on', a
--                non-API role), an opted_out identity included (inert). A person ALREADY linked to a different
--                identity is left alone and listed (the owner's own merge SQL put them there).
--
-- WHAT THIS CANNOT PROVE (security review, confirmed by an independent check). public_results.payload, the entries and
-- the people rows are all written by organisation members, and publish_event_results never validates a payload: a
-- member can stage a non-test event, a person holding any phone and a payload naming them, and an unrestricted run would
-- create an identity for that phone with a member-chosen name. Nothing a member can write proves a result is genuine,
-- so the control is the owner's: the dry run lists, per published result, the organisation, event and how many
-- identities it would create (`creates_by_result`); the owner checks that list against events they know are real and
-- passes ONLY those result ids as p_result_ids (null = every result, for a run the owner has judged safe). A restricted
-- run reads nothing else. Run it once, soon, before there is time to seed anything: it is not a standing feed.
--
-- Output: counts and uuids only (person ids, identity ids). Never a phone, a name, an email or a cafe. The two
-- organisations that share a phone cannot be told apart from the output, and the output goes to the owner only.
--
-- Idempotent: a second run finds every identity and every link in place and changes nothing.
-- A dry run is read-only and runs inside a READ ONLY transaction (it makes no temporary table).
--
-- Not pushed to the cloud by this change. The owner pushes it, then runs supabase/scripts/seduh_identity_backfill_dry_run.sql
-- and, after reading it, supabase/scripts/seduh_identity_backfill.sql (CONVENTIONS.md, "Seduh ID backfill").
--
-- rollback: (the function creates nothing by itself at migration time; undoing a COMMITTED RUN is a separate step, see
-- supabase/scripts/seduh_identity_backfill_undo.sql)
--   drop function if exists app.seduh_identity_backfill(boolean, uuid[]);
--   drop function if exists app.seduh_backfill_plan_internal(uuid[]);
--   drop function if exists app.seduh_backfill_slots_internal(uuid[]);

-- ============ (1) the name slots ============

create or replace function app.seduh_backfill_slots_internal(p_result_ids uuid[] default null)
returns table (result_id uuid, published_at timestamptz, nm text, cf text, entry_count integer, person_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with slots as (
    select distinct
           pr.id as result_id, pr.published_at, e.id as event_id, e.org_id,
           btrim(s.elem ->> 'name') as nm,
           coalesce(btrim(s.elem ->> 'cafe'), '') as cf
    from public.public_results pr
    join public.events e on e.id = pr.event_id
    cross join lateral (
      select x as elem from jsonb_array_elements(
        case when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium' else '[]'::jsonb end) x
      union all
      select x as elem from jsonb_array_elements(
        case when jsonb_typeof(pr.payload -> 'standings') = 'array' then pr.payload -> 'standings' else '[]'::jsonb end) x
    ) s
    where e.is_test is not true
      and (p_result_ids is null or pr.id = any (p_result_ids))
      and nullif(btrim(s.elem ->> 'name'), '') is not null
  )
  select s.result_id, s.published_at, s.nm, s.cf,
         count(en.id)::integer as entry_count,
         case when count(en.id) = 1 then (array_agg(p.id))[1] end as person_id
  from slots s
  left join public.event_entries en
    on en.event_id = s.event_id
   and btrim(en.display_name) = s.nm
   and coalesce(btrim(en.cafe), '') = s.cf
  left join public.people p
    on p.id = en.person_id
   and p.org_id = s.org_id
  group by s.result_id, s.published_at, s.nm, s.cf;
$$;
revoke all on function app.seduh_backfill_slots_internal(uuid[]) from public, anon, authenticated, service_role;

-- ============ (2) the plan, one row per named person ============

create or replace function app.seduh_backfill_plan_internal(p_result_ids uuid[] default null)
returns table (
  person_id       uuid,
  result_id       uuid,       -- this person's earliest published result (the one that names them)
  phone           text,
  class           text,       -- eligible | bad_phone | blocked | merge_cycle
  rank            integer,    -- among the eligible people of one phone, earliest published record first; null otherwise
  cand_name       text,       -- this person's earliest published record's name (trimmed)
  cand_country    text,       -- people.country when present and 1 to 60 characters, else null
  identity_id     uuid,       -- the identity the phone resolves to (through tombstones), null when none exists yet
  identity_status text,
  linked_to       uuid        -- people.global_person_id now
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive named as (
    select distinct on (s.person_id) s.person_id, s.published_at, s.result_id, s.nm
    from app.seduh_backfill_slots_internal(p_result_ids) s
    where s.person_id is not null
    order by s.person_id, s.published_at, s.result_id, s.nm
  ),
  facts as (
    select n.person_id, n.published_at, n.result_id, n.nm, p.phone, p.global_person_id,
           case when btrim(coalesce(p.country, '')) <> '' and char_length(btrim(p.country)) <= 60
                then btrim(p.country) end as country,
           case
             when not app.is_e164(p.phone) then 'bad_phone'
             when exists (select 1 from app.person_link_blocks b where b.person_id = p.id and b.phone_e164 = p.phone) then 'blocked'
             else 'eligible'
           end as class
    from named n
    join public.people p on p.id = n.person_id
  ),
  chase as (
    select i.phone_e164 as phone, i.id, i.status, i.merged_into, 0 as hops
    from app.seduh_identities i
    where i.phone_e164 in (select f.phone from facts f where f.class = 'eligible')
    union all
    select c.phone, i.id, i.status, i.merged_into, c.hops + 1
    from chase c
    join app.seduh_identities i on i.id = c.merged_into
    where c.status = 'merged' and c.hops < 8
  ),
  resolved as (
    select distinct on (c.phone) c.phone, c.id, c.status
    from chase c
    where c.status <> 'merged'
    order by c.phone, c.hops
  ),
  has_identity as (
    select distinct c.phone from chase c where c.hops = 0
  )
  select f.person_id, f.result_id, f.phone,
         case when f.class = 'eligible' and h.phone is not null and r.phone is null then 'merge_cycle' else f.class end as class,
         case when f.class = 'eligible'
              then row_number() over (partition by f.phone, f.class order by f.published_at, f.result_id, f.person_id)::integer
         end as rank,
         f.nm as cand_name,
         f.country as cand_country,
         r.id as identity_id,
         r.status as identity_status,
         f.global_person_id as linked_to
  from facts f
  left join resolved r on r.phone = f.phone
  left join has_identity h on h.phone = f.phone;
$$;
revoke all on function app.seduh_backfill_plan_internal(uuid[]) from public, anon, authenticated, service_role;

-- ============ (3) the backfill ============

create or replace function app.seduh_identity_backfill(p_apply boolean default false, p_result_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api       text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_report    jsonb;
  v_created   uuid[] := '{}';
  v_linked    uuid[] := '{}';
  v_orphans   jsonb;
begin
  -- owner-run only: the ACL already names no API role; this refuses one by name as well (a definer function cannot see
  -- the caller through current_user, so the session role and the SET ROLE value are read)
  if p_apply is null
     or session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api) then
    raise exception 'seduh_identity_backfill is run by the database owner only'
      using errcode = '42501', hint = 'seduh_backfill_owner_only';
  end if;

  -- the numbers BEFORE any write (a dry run reports the same ones). No temporary table: a READ ONLY transaction, which
  -- the dry-run script uses, refuses CREATE TABLE AS even for a temporary one.
  with pl as (select * from app.seduh_backfill_plan_internal(p_result_ids)),
       sl as (select * from app.seduh_backfill_slots_internal(p_result_ids))
  select jsonb_build_object(
    'published_results_non_test', (select count(*) from public.public_results pr join public.events e on e.id = pr.event_id where e.is_test is not true),
    'published_results_test_excluded', (select count(*) from public.public_results pr join public.events e on e.id = pr.event_id where e.is_test is true),
    'name_slots', (select count(*) from sl),
    'name_slots_ambiguous_entries', (select count(*) from sl where entry_count > 1),
    'name_slots_no_entry', (select count(*) from sl where entry_count = 0),
    'name_slots_entry_without_person', (select count(*) from sl where entry_count = 1 and person_id is null),
    'people_named', (select count(*) from pl),
    'people_eligible', (select count(*) from pl where class = 'eligible'),
    'skipped_bad_phone', jsonb_build_object(
      'count', (select count(*) from pl where class = 'bad_phone'),
      'person_ids', (select coalesce(jsonb_agg(person_id order by person_id), '[]') from pl where class = 'bad_phone')),
    'skipped_blocked', jsonb_build_object(
      'count', (select count(*) from pl where class = 'blocked'),
      'person_ids', (select coalesce(jsonb_agg(person_id order by person_id), '[]') from pl where class = 'blocked')),
    'skipped_merge_cycle', jsonb_build_object(
      'count', (select count(*) from pl where class = 'merge_cycle'),
      'person_ids', (select coalesce(jsonb_agg(person_id order by person_id), '[]') from pl where class = 'merge_cycle')),
    'restricted_to_results', p_result_ids is not null,
    -- for the owner's review: which published results would create how many identities (ids and counts only)
    'creates_by_result', (select coalesce(jsonb_agg(jsonb_build_object('result_id', x.result_id, 'org_id', x.org_id,
                                  'event_id', x.event_id, 'identities_to_create', x.n) order by x.result_id), '[]')
                            from (select pl.result_id, pr.org_id, pr.event_id, count(distinct pl.phone) as n
                                    from pl join public.public_results pr on pr.id = pl.result_id
                                   where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null
                                   group by pl.result_id, pr.org_id, pr.event_id) x),
    'identities_to_create', (select count(distinct phone) from pl where class = 'eligible' and identity_id is null and linked_to is null),
    'identities_reused', jsonb_build_object(
      'active', (select count(distinct identity_id) from pl where class = 'eligible' and identity_status = 'active'),
      'opted_out', (select count(distinct identity_id) from pl where class = 'eligible' and identity_status = 'opted_out')),
    'people_to_link', (select count(*) from pl where class = 'eligible' and linked_to is null),
    'people_already_linked', (select count(*) from pl where class = 'eligible' and identity_id is not null and linked_to = identity_id),
    'people_linked_elsewhere', jsonb_build_object(
      'count', (select count(*) from pl where class = 'eligible' and linked_to is not null and linked_to is distinct from identity_id),
      'person_ids', (select coalesce(jsonb_agg(person_id order by person_id), '[]') from pl
                      where class = 'eligible' and linked_to is not null and linked_to is distinct from identity_id))
  ) into v_report;

  if p_apply then
    -- 1. create the identities that do not exist (the unique phone is the match key; a concurrent creator is not an error)
    with pl as (select * from app.seduh_backfill_plan_internal(p_result_ids)),
    ins as (
      insert into app.seduh_identities (phone_e164, display_name, country, source, status)
      select pl.phone,
             left((array_agg(pl.cand_name order by pl.rank))[1], 120),
             (array_agg(pl.cand_country order by pl.rank) filter (where pl.cand_country is not null))[1],
             'archive', 'active'
      from pl
      where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null
      group by pl.phone
      on conflict (phone_e164) do nothing
      returning id
    )
    select coalesce(array_agg(id order by id), '{}') into v_created from ins;

    -- 2. decide again, now that the new identities exist (also re-reads blocks and links), then link
    perform set_config('app.seduh_link_write', 'on', true);
    with pl as (select * from app.seduh_backfill_plan_internal(p_result_ids)),
    upd as (
      update public.people p
         set global_person_id = pl.identity_id
        from pl
       where pl.person_id = p.id
         and pl.class = 'eligible'
         and pl.identity_id is not null
         and p.phone = pl.phone                  -- a number changed since the plan is left alone
         and p.global_person_id is null          -- never overwrite a link someone put there on purpose
      returning p.id
    )
    select coalesce(array_agg(id order by id), '{}') into v_linked from upd;
    perform set_config('app.seduh_link_write', '', true);
  end if;

  -- identities with no linked person: after the run in apply mode; in a dry run, not counting the ones the run would link
  with pl as (select * from app.seduh_backfill_plan_internal(p_result_ids)),
       orphan as (
         select i.id from app.seduh_identities i
          where i.status <> 'merged'
            and not exists (select 1 from public.people p where p.global_person_id = i.id)
            and not exists (select 1 from pl where pl.class = 'eligible' and pl.identity_id = i.id))
  select jsonb_build_object('count', (select count(*) from orphan),
                            'identity_ids', (select coalesce(jsonb_agg(id order by id), '[]') from orphan))
    into v_orphans;

  v_report := v_report || jsonb_build_object('mode', case when p_apply then 'apply' else 'dry_run' end,
                                              'orphan_identities', v_orphans);
  if p_apply then
    v_report := v_report || jsonb_build_object(
      'applied', jsonb_build_object(
        'identities_created', cardinality(v_created),
        'people_linked', cardinality(v_linked),
        -- keep these two lists: they are exactly what the undo script needs
        'created_identity_ids', to_jsonb(v_created),
        'linked_person_ids', to_jsonb(v_linked)));
  end if;
  return v_report;
end;
$$;
revoke all on function app.seduh_identity_backfill(boolean, uuid[]) from public, anon, authenticated, service_role;
