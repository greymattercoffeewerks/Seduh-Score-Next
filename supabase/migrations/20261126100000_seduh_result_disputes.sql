-- Seduh Score Next · T-ID2.NM: "This isn't mine" on a recorded result
-- (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md section 14.6, second bullet.)
--
-- THE PROBLEM. A result reaches a claimed profile as "Recorded by Seduh Score" because an organiser's roster linked a person (by
-- phone) to that identity. A wrong phone can put a stranger's result on someone's page. The profile's owner may say "This isn't
-- mine" on each recorded result: it is hidden from their public profile AT ONCE, and queued for the platform owner's review next
-- to the weekly feed review. It is audited, and the person can undo it while it is pending (or after the owner decided the result
-- stands). The event's public results page is never touched: a dispute hides a result from a PROFILE, nothing else.
--
-- What this adds:
--   * app.seduh_result_disputes: one row per (account, event, result key). Owner-only table (RLS on, no policy, no API grant).
--     The result is identified by `result_key`, a one-way token of (event id, trimmed name, trimmed cafe) of the payload row the
--     profile shows (app.seduh_result_key). No uuid ever leaves the database and no free text from the person but an optional
--     200-character reason (the same text rules as every Seduh ID field). Status: pending (hidden, waiting), stands (the owner
--     reviewed: the result is theirs; it stays hidden at the person's request until they withdraw), link_wrong (the owner decided
--     the roster link was wrong, unlinks the person, and the result stays hidden; it cannot be withdrawn).
--   * app.seduh_result_hidden(identity, event, key): the ONE rule for "is this result hidden by a dispute". It is used by
--     app.seduh_published_matches (the C5 discovery helper: search by cafe, results-page profile links) and by the profile list.
--   * app.seduh_recorded_rows(account, identity) and app.seduh_recorded_results(account, identity, owner): the profile's
--     recorded-results query, moved out of public.public_seduh_profile so the profile door and My Seduh ID read ONE query. The
--     public mode drops disputed rows and carries no key; the owner mode (only seduh_my_record) lists every result with its key and
--     its dispute, regardless of the person's visibility setting (a person always sees their own record).
--   * two doors for `authenticated` only, each opening with app.seduh_my_account(true) (the caller's open account or one 42501
--     `no_account`), taking no account uuid, and refusing anything that is not one of the CALLER'S OWN recorded results with the one
--     answer `not_found` (a key of someone else's result, an unknown key, a self-reported entry, a malformed key):
--       public.seduh_dispute_result(result_key, reason)   -> the result is hidden and queued (audit result_dispute.open)
--       public.seduh_withdraw_dispute(result_key)         -> the result shows again (audit result_dispute.withdraw)
--   * seduh_my_record gains `recorded_results` (with keys and dispute states) and counts.
--   * owner-only functions in `app` (no API grant), each audited: seduh_disputes_overview() and
--     seduh_dispute_resolve(id, outcome, note). Resolving does NOT unlink anyone: the owner does that with the existing runbook
--     (docs/runbooks/seduh-result-disputes.md) and then records the outcome.
--
-- POLICY CHOICES (owner to confirm): (1) the person may dispute even while vis_recorded_results is hidden (they see their results
-- in My Seduh ID either way); (2) the cap is 50 disputes per account; (3) a dispute belongs to the ACCOUNT (like entries), so after
-- an undo-claim and a fresh claim the results show again until disputed again; (4) a dispute whose roster link is later corrected
-- simply stops matching; the row stays as the record of the decision; (5) 'stands' can be withdrawn by the person, 'link_wrong'
-- cannot (the result was not theirs).
--
-- ROLLBACK (the table holds people's choices and the audit rows are append-only: do not roll back once used):
-- rollback:
--   -- restore the previous functions first: re-run `app.seduh_published_matches` from 20261125100000_seduh_discovery.sql (a plain
--   -- `create function` there: run it as `create or replace`), `app.seduh_my_record_json` from the same file (already `create or
--   -- replace`) and `public.public_seduh_profile` from 20261123100000_seduh_photo.sql (already `create or replace`), then:
--   drop function if exists app.seduh_dispute_resolve(bigint, text, text);
--   drop function if exists app.seduh_disputes_overview();
--   drop function if exists public.seduh_withdraw_dispute(text);
--   drop function if exists public.seduh_dispute_result(text, text);
--   drop function if exists app.seduh_recorded_results(uuid, uuid, boolean);
--   drop function if exists app.seduh_recorded_rows(uuid, uuid);
--   drop function if exists app.seduh_result_hidden(uuid, uuid, text);
--   drop function if exists app.seduh_result_key(uuid, text, text);
--   drop table if exists app.seduh_result_disputes;
--   alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
--   alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
--     check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo',
--                       'membership.confirm', 'membership.unconfirm', 'membership.remove', 'photo.remove'));
--   (the last statement fails once a result_dispute.* audit row exists: the history is append-only, keep the constraint wider then.)

-- ============ the audit gains three actions ============

alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
  check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo',
                    'membership.confirm', 'membership.unconfirm', 'membership.remove', 'photo.remove',
                    'result_dispute.open', 'result_dispute.withdraw', 'result_dispute.resolve'));

-- ============ the table ============

create table app.seduh_result_disputes (
  id              bigint generated always as identity primary key,
  account_id      uuid not null references app.seduh_accounts (id) on delete restrict,
  -- an event that is deleted takes its disputes with it (there is nothing left to hide)
  event_id        uuid not null references public.events (id) on delete cascade,
  result_key      text not null,
  status          text not null default 'pending',
  reason          text,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint seduh_result_disputes_one_per_result unique (account_id, event_id, result_key),
  constraint seduh_result_disputes_key_shape check (result_key ~ '^[0-9a-f]{32}$'),
  constraint seduh_result_disputes_status_vocab check (status in ('pending', 'stands', 'link_wrong')),
  constraint seduh_result_disputes_resolved_shape check ((status = 'pending') = (resolved_at is null)),
  constraint seduh_result_disputes_reason_length
    check (reason is null or (char_length(reason) between 1 and 200 and app.seduh_text_ok(reason))),
  constraint seduh_result_disputes_note_length
    check (resolution_note is null or (char_length(resolution_note) between 1 and 200 and app.seduh_text_ok(resolution_note)))
);
create index seduh_result_disputes_queue_idx on app.seduh_result_disputes (status, created_at);
create index seduh_result_disputes_event_idx on app.seduh_result_disputes (event_id);

create trigger trg_seduh_result_disputes_parent_immutable
  before update of id, account_id, event_id, result_key on app.seduh_result_disputes
  for each row execute function app.forbid_parent_change('id', 'account_id', 'event_id', 'result_key');
create trigger trg_seduh_result_disputes_set_updated_at
  before update on app.seduh_result_disputes
  for each row execute function app.set_updated_at();

alter table app.seduh_result_disputes enable row level security;
revoke all on app.seduh_result_disputes from public, anon, authenticated, service_role;
revoke all on sequence app.seduh_result_disputes_id_seq from public, anon, authenticated, service_role;

-- ============ the key and the one hide rule ============

-- opaque, stable, one-way: the same payload row always has the same key, and the key names no internal id
create function app.seduh_result_key(p_event uuid, p_name text, p_cafe text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select left(encode(sha256(convert_to('seduh-result:' || p_event::text || '|' || p_name || '|' || p_cafe, 'UTF8')), 'hex'), 32);
$$;
revoke all on function app.seduh_result_key(uuid, text, text) from public, anon, authenticated, service_role;

-- hidden = the identity's OPEN account has a dispute (any status) on this result
create function app.seduh_result_hidden(p_identity uuid, p_event uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.seduh_result_disputes d
      join app.seduh_accounts a on a.id = d.account_id
     where a.identity_id = p_identity and a.closed_at is null and d.event_id = p_event and d.result_key = p_key)
$$;
revoke all on function app.seduh_result_hidden(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ============ the recorded-results query (moved out of public_seduh_profile, unchanged rule) ============

-- Every Cup Taster payload row of a published, non-test event that names this identity (exactly one roster entry with that name
-- and cafe, linked to the identity, exactly one payload row with that name and cafe: the rule of the archive feed), WITH the
-- account's dispute on it, if any. Internal: callers choose what to show. `pos` is the profile's order (newest event first).
create function app.seduh_recorded_rows(p_account uuid, p_identity uuid)
returns table (event_id uuid, result_key text, dispute_id bigint, dispute_status text, dispute_at timestamptz, pos bigint, j jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select c.event_id, k.key, d.id, d.status, d.created_at,
         row_number() over (order by c.event_date desc nulls last, c.published_at desc, c.ord),
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
           'provenance',     'seduh_score')
    from (
      select e.id as event_id, pr.published_at, pr.payload, e.format, e.name as event_name, e.event_date, o.name as org_name,
             x.ord, x.nm, x.cf,
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
                 and coalesce(btrim(en2.cafe), '') = x.cf) as same_entries
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
       where pe.global_person_id = p_identity
         and e.is_test is not true
         -- SEAM is_shadow: when MARCH-2027-BOARD-PLAN P1 adds events.is_shadow, add `and e.is_shadow is not true`
         -- here AND in app.seduh_published_matches. A shadow-run result must never reach a profile.
         and e.format = 'cup_taster'          -- the payload shape read above is Cup Taster's
         and x.nm = btrim(en.display_name)
         and x.cf = coalesce(btrim(en.cafe), '')
    ) c
    cross join lateral (select app.seduh_result_key(c.event_id, c.nm, c.cf) as key) k
    left join app.seduh_result_disputes d on d.account_id = p_account and d.event_id = c.event_id and d.result_key = k.key
   where c.same_rows = 1 and c.same_entries = 1
$$;
revoke all on function app.seduh_recorded_rows(uuid, uuid) from public, anon, authenticated, service_role;

-- public mode: the profile's list (a disputed result is dropped; no key, no dispute). Owner mode: the person's own list, every
-- result with its key and dispute, for My Seduh ID only.
create function app.seduh_recorded_results(p_account uuid, p_identity uuid, p_owner boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           case when p_owner
                then r.j || jsonb_build_object(
                       'result_key', r.result_key,
                       'dispute', case when r.dispute_id is not null
                                       then jsonb_build_object('status', r.dispute_status,
                                                               'opened_on', (r.dispute_at at time zone 'UTC')::date) end)
                else r.j end
           order by r.pos), '[]'::jsonb)
    from app.seduh_recorded_rows(p_account, p_identity) r
   where p_owner or r.dispute_id is null
$$;
revoke all on function app.seduh_recorded_results(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- ============ the C5 helper hides a disputed result too ============

create or replace function app.seduh_published_matches(p_event uuid, p_identity uuid)
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
         -- SEAM is_shadow: add `and e.is_shadow is not true` where the profile query does (MARCH-2027-BOARD-PLAN P1).
         and e.format = 'cup_taster'
         and x.nm = btrim(en.display_name)
         and x.cf = coalesce(btrim(en.cafe), '')
    ) c
   where c.same_rows = 1 and c.same_entries = 1
     -- T-ID2.NM: a result the person said is not theirs is not theirs for search and results-page links either
     and not app.seduh_result_hidden(c.gid, c.event_id, app.seduh_result_key(c.event_id, c.nm, c.cf))
$$;

-- ============ the profile door: the same, reading the shared query ============

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
  v_photo     text;
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
           coalesce(s.vis_organiser_results, 'hidden'), coalesce(s.vis_self_reported_results, 'hidden'),
           ph.photo_path
      into v_acc_id, v_identity, v_name, v_country, v_founding, v_claimed, v_vis_id, v_vis_rec, v_vis_ko, v_vis_org, v_vis_self, v_photo
      from app.seduh_accounts a
      join app.seduh_identities i on i.id = a.identity_id
      left join app.seduh_profile_settings s on s.account_id = a.id
      left join app.seduh_account_photos ph on ph.account_id = a.id
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
                                  'claimed_on', v_claimed,
                                  -- C2: a RELATIVE path under the project's public Storage; the page prefixes its own Supabase URL
                                  'photo_url', case when v_photo is not null then app.seduh_photo_url(v_photo) end);
  else
    v_ident := jsonb_build_object('display_name', null, 'country_code', null, 'founding_number', null,
                                  'claimed_on', null, 'photo_url', null);
  end if;

  -- ============ recorded results (Cup Taster, from the published payload) ============
  -- The query is app.seduh_recorded_rows (the rule of the archive feed). A result the person disputed ("This isn't mine", T-ID2.NM)
  -- is dropped here at once, whatever its status; the event's own results page is not affected.
  if v_vis_rec = 'public' then
    v_results := app.seduh_recorded_results(v_acc_id, v_identity, false);
  end if;

  -- ============ knockout record: SEAM (nothing is read; see 20261116100000). v_vis_ko is kept for the seam. ============

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

-- ============ My Seduh ID shows the person their recorded results and disputes ============

create or replace function app.seduh_my_record_json(p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acct     jsonb;
  v_identity uuid;
  v_settings jsonb;
  v_entries  jsonb;
  v_links    jsonb;
  v_by_kind  jsonb;
  v_recorded jsonb;
begin
  select jsonb_build_object(
           'handle', a.handle, 'founding_number', a.founding_number, 'display_name', i.display_name,
           'country_code', i.country_code, 'claimed_on', (a.claimed_at at time zone 'UTC')::date,
           'profile_path', '/id/' || a.handle || '/',
           'photo_url', case when ph.photo_path is not null then app.seduh_photo_url(ph.photo_path) end,
           'photo_updated_at', ph.photo_updated_at),
         a.identity_id
    into v_acct, v_identity
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

  -- the person's own recorded results, WITH keys and disputes (T-ID2.NM); shown whatever vis_recorded_results is
  v_recorded := app.seduh_recorded_results(p_account, v_identity, true);

  return jsonb_build_object(
    'account', v_acct,
    'settings', coalesce(v_settings, '{}'::jsonb),
    'entries', v_entries,
    'team_links', v_links,
    'recorded_results', v_recorded,
    'counts', jsonb_build_object(
      'entries', jsonb_array_length(v_entries), 'by_kind', v_by_kind, 'team_links', jsonb_array_length(v_links),
      'recorded_results', jsonb_array_length(v_recorded),
      'disputes', (select count(*)::integer from app.seduh_result_disputes d where d.account_id = p_account),
      'disputes_pending', (select count(*)::integer from app.seduh_result_disputes d
                            where d.account_id = p_account and d.status = 'pending')),
    'limits', jsonb_build_object('entries', 200, 'team_links', 40, 'disputes', 50));
end;
$$;

-- ============ the person's two doors ============

-- Finds ONE of the caller's own recorded results by key: the only way to name a result. Anything else is `not_found`.
create function public.seduh_dispute_result(p_result_key text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct     uuid := app.seduh_my_account(true);
  v_identity uuid;
  v_key      text := btrim(coalesce(p_result_key, ''));
  v_reason   text := app.seduh_clean_text(p_reason, 200, false, 'bad_reason');
  r          record;
  v_id       bigint;
begin
  select a.identity_id into v_identity from app.seduh_accounts a where a.id = v_acct;
  -- a malformed, unknown, someone else's or self-reported key is ONE answer (nobody learns that another person's result exists)
  select x.event_id, x.dispute_id into r from app.seduh_recorded_rows(v_acct, v_identity) x where x.result_key = v_key;
  if not found then
    raise exception 'That result was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if r.dispute_id is not null then
    raise exception 'You already said that result is not yours.' using errcode = 'P0001', hint = 'already_disputed';
  end if;
  if (select count(*) from app.seduh_result_disputes where account_id = v_acct) >= 50 then
    raise exception 'You have reached the limit of 50 results marked as not yours.' using errcode = 'P0001', hint = 'too_many_disputes';
  end if;
  insert into app.seduh_result_disputes (account_id, event_id, result_key, reason)
  values (v_acct, r.event_id, v_key, v_reason)
  returning id into v_id;
  perform app.seduh_claim_audit_write('result_dispute.open', null, v_identity, null, v_acct,
    jsonb_build_object('dispute_id', v_id, 'event_id', r.event_id, 'result_key', v_key, 'reason', v_reason));
  return jsonb_build_object('result_key', v_key,
    'dispute', jsonb_build_object('status', 'pending', 'opened_on', (now() at time zone 'UTC')::date));
end;
$$;

create function public.seduh_withdraw_dispute(p_result_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct     uuid := app.seduh_my_account(true);
  v_identity uuid;
  v_key      text := btrim(coalesce(p_result_key, ''));
  r          record;
  v_status   text;
begin
  select a.identity_id into v_identity from app.seduh_accounts a where a.id = v_acct;
  select x.event_id, x.dispute_id into r from app.seduh_recorded_rows(v_acct, v_identity) x where x.result_key = v_key;
  if not found or r.dispute_id is null then
    raise exception 'That result was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select d.status into v_status from app.seduh_result_disputes d where d.id = r.dispute_id and d.account_id = v_acct for update;
  if v_status is null then
    raise exception 'That result was not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_status = 'link_wrong' then
    raise exception 'That result was checked and is not yours, so it cannot be shown again.' using errcode = 'P0001', hint = 'not_undoable';
  end if;
  delete from app.seduh_result_disputes where id = r.dispute_id and account_id = v_acct;
  perform app.seduh_claim_audit_write('result_dispute.withdraw', null, v_identity, null, v_acct,
    jsonb_build_object('dispute_id', r.dispute_id, 'event_id', r.event_id, 'result_key', v_key, 'was_status', v_status));
  return jsonb_build_object('result_key', v_key, 'dispute', null);
end;
$$;

revoke all on function public.seduh_dispute_result(text, text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_withdraw_dispute(text) from public, anon, authenticated, service_role;
grant execute on function public.seduh_dispute_result(text, text) to authenticated;
grant execute on function public.seduh_withdraw_dispute(text) to authenticated;

-- ============ the owner's functions (owner SQL only: no API role may run them) ============

-- the review queue: pending first, oldest first. `still_matches` is false once the roster link was corrected;
-- `linked_person_id` is the roster person the result came through (the unlink runbook starts there).
create function app.seduh_disputes_overview()
returns table (dispute_id bigint, status text, handle text, founding_number integer, display_name text, event_name text,
               event_date date, org_name text, reason text, still_matches boolean, linked_person_id uuid,
               created_at timestamptz, resolved_at timestamptz, resolution_note text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.status, a.handle, a.founding_number, i.display_name, e.name, e.event_date, o.name, d.reason,
         exists (select 1 from app.seduh_recorded_rows(a.id, a.identity_id) r
                  where r.event_id = d.event_id and r.result_key = d.result_key),
         (select en.person_id
            from public.event_entries en join public.people pe on pe.id = en.person_id
           where en.event_id = d.event_id and pe.global_person_id = a.identity_id
             and app.seduh_result_key(en.event_id, btrim(en.display_name), coalesce(btrim(en.cafe), '')) = d.result_key
           limit 1),
         d.created_at, d.resolved_at, d.resolution_note
    from app.seduh_result_disputes d
    join app.seduh_accounts a on a.id = d.account_id
    join app.seduh_identities i on i.id = a.identity_id
    join public.events e on e.id = d.event_id
    join public.orgs o on o.id = e.org_id
   order by (d.status <> 'pending'), d.created_at, d.id;
$$;
revoke all on function app.seduh_disputes_overview() from public, anon, authenticated, service_role;

-- records the owner's decision on a PENDING dispute. 'stands': the result is the person's, it stays hidden at their request (they may
-- withdraw). 'link_wrong': the roster link was wrong (the owner unlinks the person first, runbook); the result stays hidden for good.
create function app.seduh_dispute_resolve(p_dispute_id bigint, p_outcome text, p_note text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  d app.seduh_result_disputes;
  v_identity uuid;
  v_note text := app.seduh_clean_text(p_note, 200, true, 'bad_reason');
begin
  if p_outcome is null or p_outcome not in ('stands', 'link_wrong') then
    raise exception 'seduh_dispute_resolve: outcome must be stands or link_wrong' using errcode = 'P0001';
  end if;
  select * into d from app.seduh_result_disputes where id = p_dispute_id for update;
  if not found then raise exception 'seduh_dispute_resolve: no such dispute %', p_dispute_id using errcode = 'P0002'; end if;
  if d.status <> 'pending' then raise exception 'seduh_dispute_resolve: dispute % is already %', p_dispute_id, d.status using errcode = 'P0001'; end if;
  select a.identity_id into v_identity from app.seduh_accounts a where a.id = d.account_id;
  update app.seduh_result_disputes set status = p_outcome, resolved_at = now(), resolution_note = v_note where id = d.id;
  perform app.seduh_claim_audit_write('result_dispute.resolve', null, v_identity, null, d.account_id,
    jsonb_build_object('dispute_id', d.id, 'event_id', d.event_id, 'outcome', p_outcome, 'note', v_note));
end;
$$;
revoke all on function app.seduh_dispute_resolve(bigint, text, text) from public, anon, authenticated, service_role;
