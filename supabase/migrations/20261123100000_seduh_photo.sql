-- Seduh Score Next · T-ID2.C2: a claimed person's profile PHOTO (spec: Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md section 5)
--
-- What this adds:
--   * the Storage bucket `seduh-avatars`: PUBLIC read, file_size_limit 204800 bytes, allowed_mime_types image/webp and image/jpeg.
--     The Storage API enforces both limits on every upload, whatever the page does.
--   * Storage RLS on storage.objects for this bucket only: an authenticated person writes (INSERT) and removes (DELETE) only in
--     the folder of their OWN open, attested account, with a file name of a fixed random shape, and never more than 5 objects at
--     once in that folder. SELECT (listing) is the same folder and `authenticated` only. NO policy for anon: see "listing" below.
--   * app.seduh_account_photos: one row per account (the CURRENT photo's path). Owner-only: RLS on, no policy, no API grant.
--   * the person's doors (authenticated only, each opens with app.seduh_my_account(), one 42501 `no_account` otherwise):
--       seduh_set_my_photo(p_path), seduh_remove_my_photo().
--   * the owner's function (no API role): app.seduh_photo_remove(handle, reason), AUDITED (audit action `photo.remove`).
--   * public.public_seduh_profile redefined: `identity.photo_url` is filled ONLY when vis_identity = 'public' (the door already
--     requires an open, attested account on an active identity). public.seduh_my_record's account gains photo_url and
--     photo_updated_at (app.seduh_my_record_json redefined).
--
-- DESIGN CHOICES (the spec left these open):
--   1. THE OBJECT PATH is `<handle>/<32 random hex>.<webp|jpg>`, not `<identity_id>.webp` and not the account uuid.
--        - The folder is the account's HANDLE: it is already public (it is in the profile URL), frozen for life, never reissued
--          (a closed account keeps it retired), and unique, so it identifies the owner without putting an internal uuid into a
--          public image address. An account or identity id never leaves the database (CONVENTIONS.md).
--        - The file name is random PER UPLOAD (128 bits, made by the browser; the policy only checks the shape, which is enough
--          because a person can only ever write into their own folder). A replaced, hidden or owner-removed photo's old URL is
--          therefore never predictable from the new one, and a stable "<handle>.webp" address cannot be fetched or cached
--          after the photo is gone. An old URL a third party already saved is dead the moment the object is deleted (below).
--   2. THE PUBLIC URL is built by the page, not stored: the door returns the RELATIVE path
--      `/storage/v1/object/public/seduh-avatars/<path>` and the page prefixes its own Supabase URL. The database cannot know
--      the project's address (local, staging and cloud differ), and a setting for it would be one more thing to forget at release.
--      No secret is involved: a public bucket's URL is the credential-free address.
--   3. LISTING. In a Supabase PUBLIC bucket an object is fetched by its exact path (`/storage/v1/object/public/...`) with no
--      policy; the list endpoint (`/storage/v1/object/list/seduh-avatars`) is governed by a SELECT policy on storage.objects,
--      and anon has none, so anon cannot list anything. A signed-in person can list only their own folder. (Both are proved by
--      tests/e2e/seduh-photo-live.spec.js against the real Storage API; pgTAP cannot reach the API.)
--   4. NO UPDATE POLICY. A name is never reused, so the page never upserts; without UPDATE nobody can swap the bytes behind an
--      existing URL or move an object between folders. (The task listed INSERT, UPDATE and DELETE; UPDATE was left out on purpose.)
--   5. THE PHOTO'S REMOVAL IS A REAL DELETE OF THE ROW. Supabase blocks `delete from storage.objects` unless the transaction sets
--      `storage.allow_delete_query = 'true'` (a guard against orphaned files). The doors set it for the one statement and clear
--      it. A deleted ROW makes the public URL answer 404 at once, in the same transaction as the database change. The BYTES in
--      the backing file store are freed only by a Storage API delete, so the page calls the API remove FIRST (it has the DELETE
--      policy) and then the door, which deletes any row still left. An owner removal (SQL) therefore leaves the 200 KB file in
--      the backing store, unreachable; the runbook (CONVENTIONS.md) lists the cleanup.
--   6. set_my_photo also DELETES every other object in the person's folder (an abandoned earlier upload, the replaced photo). An
--      upload from a second tab that has not been recorded yet is removed by this and its own set answers `no_object`.
--   7. A photo never shows for someone who is not 18 or over by construction: the door only finds an account that has an
--      `adult_attested_at`, and the person's own doors refuse one without it.
--   8. OWNER REMOVAL does not stop the person adding a new photo later (it is not a ban; a ban is a moderation policy for 2b).
--
-- ROLLBACK DELETES the photo references (the files stay in the bucket, unreferenced): do not roll back a populated table.
--
-- rollback:
--   -- restore the previous two functions first: re-run public.public_seduh_profile and app.seduh_my_record_json from
--   -- 20261122100000_seduh_my_record.sql (create or replace), then:
--   drop policy if exists seduh_avatars_insert on storage.objects;
--   drop policy if exists seduh_avatars_delete on storage.objects;
--   drop policy if exists seduh_avatars_select on storage.objects;
--   drop function if exists app.seduh_photo_remove(text, text);
--   drop function if exists public.seduh_remove_my_photo();
--   drop function if exists public.seduh_set_my_photo(text);
--   drop function if exists app.seduh_photo_purge_folder(text, text);
--   drop function if exists app.seduh_photo_room(text);
--   drop function if exists app.seduh_my_photo_folder();
--   drop function if exists app.seduh_photo_url(text);
--   drop table if exists app.seduh_account_photos;
--   -- the bucket: empty it through the Storage API first (the API refuses to delete a non-empty bucket), then
--   --   select set_config('storage.allow_delete_query', 'true', true); delete from storage.buckets where id = 'seduh-avatars';
--   alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
--   alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
--     check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo',
--                       'membership.confirm', 'membership.unconfirm', 'membership.remove'));
--   (the last statement fails once a photo.remove audit row exists: the history is append-only, keep the constraint wider then.)

-- ============ the bucket ============

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seduh-avatars', 'seduh-avatars', true, 204800, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ============ the photo reference (owner-only table) ============

create table app.seduh_account_photos (
  account_id       uuid primary key references app.seduh_accounts (id) on delete restrict,
  photo_path       text not null,
  photo_updated_at timestamptz not null default now(),
  -- <handle>/<32 hex>.<webp|jpg>, the same shape the Storage policy requires
  constraint seduh_account_photos_path_shape
    check (photo_path ~ '^[a-z0-9](-?[a-z0-9])*/[0-9a-f]{32}\.(webp|jpg)$' and char_length(photo_path) <= 80),
  constraint seduh_account_photos_path_key unique (photo_path)
);

create trigger trg_seduh_account_photos_parent_immutable
  before update of account_id on app.seduh_account_photos
  for each row execute function app.forbid_parent_change('account_id');

alter table app.seduh_account_photos enable row level security;
revoke all on app.seduh_account_photos from public, anon, authenticated, service_role;

-- ============ the audit gains one action ============

alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
  check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo',
                    'membership.confirm', 'membership.unconfirm', 'membership.remove', 'photo.remove'));

-- ============ helpers ============

create function app.seduh_photo_url(p_path text)
returns text
language sql
immutable
set search_path = ''
as $$ select '/storage/v1/object/public/seduh-avatars/' || p_path $$;
revoke all on function app.seduh_photo_url(text) from public, anon, authenticated, service_role;

-- The handle that names the caller's own Storage folder: the caller's OPEN, attested account on an active identity, or null.
-- It is the one function the Storage policies call, so it must be executable by `authenticated` (a policy runs as the caller);
-- it reveals only the caller's own handle, and null to anon and to anyone without an account.
create function app.seduh_my_photo_folder()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.handle
    from app.seduh_accounts a join app.seduh_identities i on i.id = a.identity_id
   where a.user_id = auth.uid() and a.closed_at is null and a.adult_attested_at is not null and i.status = 'active'
$$;
revoke all on function app.seduh_my_photo_folder() from public, anon, authenticated, service_role;
grant execute on function app.seduh_my_photo_folder() to authenticated;

-- true while the folder holds fewer than 5 objects (the current photo plus a few abandoned uploads); keeps a person from
-- filling the project's free-plan Storage with uploads they never record
create function app.seduh_photo_room(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 5 from storage.objects o
   where o.bucket_id = 'seduh-avatars' and (storage.foldername(o.name))[1] = p_folder
$$;
revoke all on function app.seduh_photo_room(text) from public, anon, authenticated, service_role;
grant execute on function app.seduh_photo_room(text) to authenticated;

-- delete every object of one folder (except p_keep) from the bucket. Supabase refuses a direct delete unless the flag is set,
-- so it is set for this one statement and cleared. Not reachable by any API role.
create function app.seduh_photo_purge_folder(p_folder text, p_keep text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o
   where o.bucket_id = 'seduh-avatars' and (storage.foldername(o.name))[1] = p_folder
     and o.name is distinct from p_keep;
  get diagnostics v_n = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  return v_n;
end;
$$;
revoke all on function app.seduh_photo_purge_folder(text, text) from public, anon, authenticated, service_role;

-- ============ Storage RLS (this bucket only) ============

create policy seduh_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'seduh-avatars'
    and name ~ '^[a-z0-9](-?[a-z0-9])*/[0-9a-f]{32}\.(webp|jpg)$'
    and (storage.foldername(name))[1] = app.seduh_my_photo_folder()
    and app.seduh_photo_room((storage.foldername(name))[1]));

create policy seduh_avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'seduh-avatars' and (storage.foldername(name))[1] = app.seduh_my_photo_folder());

create policy seduh_avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'seduh-avatars' and (storage.foldername(name))[1] = app.seduh_my_photo_folder());

-- ============ the person's doors ============

create function public.seduh_set_my_photo(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct   uuid := app.seduh_my_account(true);
  v_handle text;
  v_size   bigint;
  v_mime   text;
  v_at     timestamptz := now();
begin
  select a.handle into v_handle from app.seduh_accounts a where a.id = v_acct;
  -- the path must be in the caller's OWN folder and of the policy's shape (a path in another folder answers like a bad shape)
  if p_path is null or p_path !~ '^[a-z0-9](-?[a-z0-9])*/[0-9a-f]{32}\.(webp|jpg)$' or split_part(p_path, '/', 1) <> v_handle then
    raise exception 'That photo cannot be used.' using errcode = 'P0001', hint = 'bad_path';
  end if;
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_size, v_mime
    from storage.objects o where o.bucket_id = 'seduh-avatars' and o.name = p_path;
  if not found then
    raise exception 'The photo was not uploaded.' using errcode = 'P0001', hint = 'no_object';
  end if;
  -- belt and braces: the bucket already refuses these at upload
  if v_size is null or v_size < 1 or v_size > 204800 then
    raise exception 'That photo is too large.' using errcode = 'P0001', hint = 'photo_too_big';
  end if;
  if v_mime is null or v_mime not in ('image/webp', 'image/jpeg') then
    raise exception 'That photo is not a supported type.' using errcode = 'P0001', hint = 'photo_bad_type';
  end if;

  insert into app.seduh_account_photos (account_id, photo_path, photo_updated_at)
  values (v_acct, p_path, v_at)
  on conflict (account_id) do update set photo_path = excluded.photo_path, photo_updated_at = excluded.photo_updated_at;

  perform app.seduh_photo_purge_folder(v_handle, p_path);
  return jsonb_build_object('photo_url', app.seduh_photo_url(p_path), 'photo_updated_at', v_at);
end;
$$;

create function public.seduh_remove_my_photo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acct   uuid := app.seduh_my_account(true);
  v_handle text;
  v_had    boolean;
begin
  select a.handle into v_handle from app.seduh_accounts a where a.id = v_acct;
  delete from app.seduh_account_photos where account_id = v_acct;
  v_had := found;
  perform app.seduh_photo_purge_folder(v_handle, null);
  return jsonb_build_object('removed', v_had);
end;
$$;

revoke all on function public.seduh_set_my_photo(text) from public, anon, authenticated, service_role;
revoke all on function public.seduh_remove_my_photo() from public, anon, authenticated, service_role;
grant execute on function public.seduh_set_my_photo(text) to authenticated;
grant execute on function public.seduh_remove_my_photo() to authenticated;

-- ============ the owner's removal (audited; no API role) ============

create function app.seduh_photo_remove(p_handle text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_reason text := app.seduh_clean_text(p_reason, 200, true, 'bad_reason');
  v_acct   uuid;
  v_ident  uuid;
  v_path   text;
begin
  select a.id, a.identity_id into v_acct, v_ident from app.seduh_accounts a where a.handle = v_handle;
  if v_acct is null then raise exception 'seduh_photo_remove: no such handle' using errcode = 'P0002'; end if;
  select p.photo_path into v_path from app.seduh_account_photos p where p.account_id = v_acct for update;
  -- a folder may hold an abandoned upload with no reference: removing "the photo" clears those too, but a handle with neither is an error
  if v_path is null and not exists (select 1 from storage.objects o
                                     where o.bucket_id = 'seduh-avatars' and (storage.foldername(o.name))[1] = v_handle) then
    raise exception 'seduh_photo_remove: % has no photo', v_handle using errcode = 'P0002';
  end if;
  delete from app.seduh_account_photos where account_id = v_acct;
  perform app.seduh_photo_purge_folder(v_handle, null);
  perform app.seduh_claim_audit_write('photo.remove', null, v_ident, null, v_acct,
    jsonb_build_object('handle', v_handle, 'reason', v_reason, 'had_reference', v_path is not null));
end;
$$;
revoke all on function app.seduh_photo_remove(text, text) from public, anon, authenticated, service_role;

-- ============ the doors that show it ============

create or replace function app.seduh_my_record_json(p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acct     jsonb;
  v_settings jsonb;
  v_entries  jsonb;
  v_links    jsonb;
  v_by_kind  jsonb;
begin
  select jsonb_build_object(
           'handle', a.handle, 'founding_number', a.founding_number, 'display_name', i.display_name,
           'country_code', i.country_code, 'claimed_on', (a.claimed_at at time zone 'UTC')::date,
           'profile_path', '/id/' || a.handle || '/',
           'photo_url', case when ph.photo_path is not null then app.seduh_photo_url(ph.photo_path) end,
           'photo_updated_at', ph.photo_updated_at)
    into v_acct
    from app.seduh_accounts a join app.seduh_identities i on i.id = a.identity_id
    left join app.seduh_account_photos ph on ph.account_id = a.id
   where a.id = p_account;

  select jsonb_build_object(
           'vis_identity', s.vis_identity, 'vis_recorded_results', s.vis_recorded_results,
           'vis_organiser_results', s.vis_organiser_results, 'vis_self_reported_results', s.vis_self_reported_results,
           'vis_judging_roles', s.vis_judging_roles, 'vis_cafe_affiliations', s.vis_cafe_affiliations,
           'vis_knockout_record', s.vis_knockout_record, 'listed_on_country_pages', s.listed_on_country_pages)
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

  return jsonb_build_object(
    'account', v_acct,
    'settings', coalesce(v_settings, '{}'::jsonb),
    'entries', v_entries,
    'team_links', v_links,
    'counts', jsonb_build_object(
      'entries', jsonb_array_length(v_entries), 'by_kind', v_by_kind, 'team_links', jsonb_array_length(v_links)),
    'limits', jsonb_build_object('entries', 200, 'team_links', 40));
end;
$$;

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

revoke all on function public.public_seduh_profile(text) from public, anon, authenticated, service_role;
grant execute on function public.public_seduh_profile(text) to anon, authenticated;
