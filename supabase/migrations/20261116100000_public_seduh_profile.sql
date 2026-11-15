-- Seduh Score Next · T-ID2.B1: the profile door, public.public_seduh_profile(p_handle text)
-- (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md sections 4, 6, 8, 10, 14.4, 14.5.)
--
-- ONE anonymous door behind every person page at /id/<handle>/. It reads the claimed-account tables of 20261115120000
-- (app.seduh_accounts, app.seduh_profile_settings), applies the person's privacy settings IN SQL, and returns one jsonb
-- object with a stable shape. Nothing is written, nothing stored: every figure is derived when the door is read.
-- SECURITY DEFINER, STABLE, search_path pinned to the empty string, executable by anon and authenticated only (the pattern
-- of public_country_record, 20261113120000). It takes TEXT only, so the cross-organisation RPC matrix (041) has no entry
-- to make; 037 pins the anonymous door list (this door is added) and 080_public_seduh_profile.sql pins this door.
--
-- THE CORE INVARIANT: a profile never reveals a result the public results pages do not already show. A result counts only
-- if it is on /results/, and /results/ is exactly the rows of public.public_results (anon-readable, one per published
-- event). So the door reads the PUBLISHED PAYLOAD (public_results.payload: the full `standings` when the organiser
-- published them, else the `podium`) and never the live scoring tables for a result. The payload's own figures (place, round
-- label, correct, total, time) are what is shown, so the profile can never be fuller than the page. A published event that
-- is a test event is excluded again here (the publish trigger already refuses one; belt and braces); is_shadow does not
-- exist yet, see the SEAM below.
--
-- WHO A PAYLOAD ROW BELONGS TO: the rule of the archive feed (20261103100000, seduh_feed_slots_internal), unchanged: a
-- payload row names a person only when EXACTLY ONE roster entry of that event has the same trimmed name and cafe, that entry
-- has a person of the event's organisation, and that person is linked (people.global_person_id) to this identity. It is
-- also required that exactly one payload row of that publication has that name and cafe (two identical rows name nobody).
-- A name edited on the roster after publishing therefore matches nothing: the result stays off the profile rather than
-- being guessed. Record coverage (every placing, a reviewed backfill) is B2.
--
-- FORMATS (verified 2026-11-16):
--   * Cup Taster: results, read from the published payload as above. Key figures: correct, total, time_secs.
--   * Throwdown: nothing (its publish path writes no payload: only Cup Taster builds one today); see KNOCKOUT RECORD below.
--   * BTC: NOTHING. BTC competitors are btc_teams rows and judges are btc_judges rows; neither has a person or identity link
--     (the team's members are not modelled as people; judges are a name on an event). BTC also has no payload that names
--     people. Returned nothing for it, on purpose; judging_roles stays an empty seam for the same reason.
--
-- KNOCKOUT RECORD: RETURNS NOTHING YET (owner decision 2026-11-16, "nothing until published"). Throwdown publishes no
-- results payload, and match outcomes are not on /results/, so a profile showing them would show more than the public pages do.
-- knockout_record is always {won: 0, lost: 0, opponents: []}, and the live td_* tables are NOT read. SEAM: once Throwdown
-- publishes a results payload, fill it from THAT PAYLOAD ONLY (published, non-test, non-shadow). The future reader must enforce:
-- (1) read the payload, never td_matches or td_match_results; (2) count only matches the payload shows as decided between two
-- named competitors (no byes, level or undecided matches, pool rounds); (3) name an opponent only if that opponent is a claimed,
-- open, 18-attested, active account with BOTH vis_identity and vis_knockout_record public, otherwise counts only; (4) a hidden
-- vis_knockout_record gives the same zeros. (An earlier draft of this migration read td_matches; it was removed before merge.)
--
-- VISIBILITY: 'public' shows a part. 'organisers' means "only organisers I competed for", an organiser-scoped view that does
-- not exist for an anonymous caller, so it is treated as hidden here, as is 'hidden'. A hidden part looks exactly like a part
-- with nothing in it (an empty list, zero counts, null fields), so the shape never reveals a setting.
--
-- EXISTENCE: a claimed, open account's handle is public by design (it is their page): has_profile is true even when every
-- part is hidden, so a printed QR code never breaks. An unknown handle, a closed account, an identity that is not 'active'
-- (merged, opted out), an account without adult_attested_at, and any input that is not a valid unreserved handle all return
-- ONE identical empty shape (has_profile false, handle null) with no error. The input is lower-cased and trimmed, and checked
-- for length and shape and against app.seduh_handle_reserved exactly as the account table does, and is never echoed.
--
-- NEVER RETURNED: phone, email, user_id, any uuid or internal id, org_id, the claim token or its hash, a setting of a part
-- the person hid, or any result of an unpublished, test or shadow event.
--
-- SEAMS (all returned as empty arrays or null, each named for the phase that fills it):
--   photo_url (inside identity)  Phase C2 (the avatar bucket).
--   organiser_records            Phase C (team links to organiser records, spec 14.5).
--   self_reported                Phase C (self-reported entries, spec 14.4).
--   judging_roles                needs a judge-to-identity link (L2-5): BTC judges have no people row today.
--   cafe_affiliations            two-sided acceptance is not modelled (org_person_affiliations is one-sided): none until it is.
--   is_shadow                    the shadow-run flag does not exist yet (MARCH-2027-BOARD-PLAN P1): see the marked line below.
--
-- ROLLBACK is safe (nothing is stored):
-- rollback:
--   drop function if exists public.public_seduh_profile(text);

create function public.public_seduh_profile(p_handle text)
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
  v_ident     jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_won       integer := 0;
  v_lost      integer := 0;
  v_opps      jsonb := '[]'::jsonb;
begin
  -- Input: the same shape and reserved rules as the account table. Anything else gets the empty shape below.
  if v_handle ~ '^[a-z0-9](-?[a-z0-9])*$'
     and char_length(v_handle) between 3 and 30
     and not app.seduh_handle_reserved(v_handle) then
    select a.id, a.identity_id, i.display_name, i.country_code, a.founding_number,
           (a.claimed_at at time zone 'UTC')::date,
           -- a missing settings row (the account trigger makes one) fails closed
           coalesce(s.vis_identity, 'hidden'), coalesce(s.vis_recorded_results, 'hidden'),
           coalesce(s.vis_knockout_record, 'hidden')
      into v_acc_id, v_identity, v_name, v_country, v_founding, v_claimed, v_vis_id, v_vis_rec, v_vis_ko
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

  return jsonb_build_object(
    'has_profile', true,
    'handle', v_handle,
    'identity', v_ident,
    'recorded_results', v_results,
    'knockout_record', jsonb_build_object('won', coalesce(v_won, 0), 'lost', coalesce(v_lost, 0), 'opponents', v_opps),
    'organiser_records', '[]'::jsonb,   -- SEAM Phase C: team links to organiser records
    'self_reported', '[]'::jsonb,       -- SEAM Phase C: self-reported entries (never counted as recorded)
    'judging_roles', '[]'::jsonb,       -- SEAM: needs a judge-to-identity link (BTC judges have no people row)
    'cafe_affiliations', '[]'::jsonb);  -- SEAM: two-sided acceptance is not modelled yet
end;
$$;

revoke all on function public.public_seduh_profile(text) from public, anon, authenticated, service_role;
grant execute on function public.public_seduh_profile(text) to anon, authenticated;
