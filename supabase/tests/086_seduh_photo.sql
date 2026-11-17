-- T-ID2.C2: a claimed person's profile PHOTO (migration 20261123100000_seduh_photo.sql). Fictional data only.
-- Proves:
--   * ACL: the two person doors are executable by `authenticated` only; the owner function and the helpers by NO API role (the two
--     the Storage policies call are executable by authenticated only); the photo table is reachable by no API role (RLS on, no policy).
--   * THE BUCKET: public read, 204800 bytes, image/webp and image/jpeg. (The Storage API's own refusal of a wrong type or size is
--     proved over HTTP by tests/e2e/seduh-photo-live.spec.js; pgTAP cannot reach the API, a direct insert bypasses that check.)
--   * STORAGE RLS: the owner of an open, attested account can insert into their OWN folder; another account, anon, an organiser
--     with no account, a login with no account and a CLOSED account cannot write into someone else's folder (or any folder); a name
--     of the wrong shape is refused; the 6th object in a folder is refused; delete and select reach only the caller's own folder.
--   * THE DOORS: refused for anon / no account / organiser / closed account (one 42501 `no_account`); a path outside the caller's
--     folder, of the wrong shape or null is `bad_path`; a missing object is `no_object`; an oversized or non-image object is refused;
--     success records the reference, deletes every other object in the folder, and a replacement swaps it; remove clears all.
--   * THE PROFILE DOOR: photo_url is the public path only while vis_identity is public and the account is open; hidden, closed and
--     removed all answer null. The person's own record shows it regardless of the setting.
--   * THE OWNER FUNCTION: audited (photo.remove, no path in the audit), refuses an unknown handle, a handle with no photo and a bare reason.
--   * the table's constraints and frozen parent; a copy of the migration's rollback block (kept in step by hand) removes what it added.
begin;
select plan(89);

create schema t086;
grant usage on schema t086 to anon, authenticated, service_role;

create function t086.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad((86000 + n)::text, 12, '0'))::uuid
$$;
-- a valid object name in a handle's folder; `k` is one hex digit that makes the file name
create function t086.obj(h text, k text default 'a', ext text default 'webp') returns text language sql immutable as $$
  select h || '/' || repeat(k, 32) || '.' || ext
$$;
create function t086.attempt(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || case when v_hint ~ '^[a-z_]+$' then v_hint else '' end;
end $$;
create function t086.run(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || case when v_hint ~ '^[a-z_]+$' then v_hint else '' end;
end $$;
create function t086.as_run(n int, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t086.u(n)::text, true); set local role authenticated; end if;
  r := t086.run(stmt);
  reset role;
  return r;
end $$;
create function t086.as_attempt(n int, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t086.u(n)::text, true); set local role authenticated; end if;
  r := t086.attempt(stmt);
  reset role;
  return r;
end $$;
-- a door's jsonb as a signed-in user (0 = anon)
create function t086.j(n int, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t086.u(n)::text, true); set local role authenticated; end if;
  execute q into r;
  reset role;
  return r;
end $$;
-- rows of the avatar bucket in one folder, as postgres
create function t086.n_objects(h text) returns int language sql as $$
  select count(*)::int from storage.objects where bucket_id = 'seduh-avatars' and (storage.foldername(name))[1] = h
$$;
-- an object row as postgres (the API would have written it after a real upload)
create function t086.put(nm text, sz int default 1000, mime text default 'image/webp') returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('seduh-avatars', nm, jsonb_build_object('size', sz, 'mimetype', mime))
$$;
-- a delete of a storage row the way the API does it (flag set), as the signed-in user; returns how many rows went
create function t086.as_delete(n int, nm text) returns int language plpgsql as $$
declare c int;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t086.u(n)::text, true); set local role authenticated; end if;
  delete from storage.objects where bucket_id = 'seduh-avatars' and name = nm;
  get diagnostics c = row_count;
  reset role;
  perform set_config('storage.allow_delete_query', 'false', true);
  return c;
end $$;
grant execute on all functions in schema t086 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- users 1..6. 1 alpha (open), 2 bravo (open), 3 charlie (CLOSED), 4 an organiser with no account, 5 no account at all, 6 delta (open, hidden identity)
insert into auth.users (id, email) select t086.u(n), 'u' || n || '@t086.seduh-next' from generate_series(1, 6) n;
insert into orgs (id, name, slug) values (t086.u(901), 'T086 Org', 't086-org');
insert into org_members (org_id, user_id, role) values (t086.u(901), t086.u(4), 'owner');
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t086.u(n), '+67386000' || lpad(n::text, 2, '0'), 'T086 Person ' || n, 'organiser_roster', 'BN' from unnest(array[1, 2, 3, 6]) n;
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t086.u(100 + n), t086.u(n), t086.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t86'), (2, 'bravo-t86'), (3, 'charlie-t86'), (6, 'delta-t86')) v(n, h);
update app.seduh_accounts set closed_at = now() where id = t086.u(103);
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t086.u(106);

-- ============ ACL, bucket, policies ============

select is((select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('seduh_set_my_photo', 'seduh_remove_my_photo')
              and not has_function_privilege('authenticated', p.oid, 'execute')), 'none', 'both person doors are executable by authenticated');
select is((select coalesce(string_agg(p.proname || '/' || r, ', ' order by p.proname), 'none')
             from pg_proc p, unnest(array['anon', 'service_role', 'public']) r
            where p.pronamespace = 'public'::regnamespace and p.proname in ('seduh_set_my_photo', 'seduh_remove_my_photo')
              and has_function_privilege(r, p.oid, 'execute')), 'none', '...and by neither anon, service_role nor PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('seduh_set_my_photo', 'seduh_remove_my_photo') and p.prosecdef and p.proconfig @> array['search_path=""']), 2,
  'both are SECURITY DEFINER with search_path pinned to the empty string');
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('seduh_photo_remove', 'seduh_photo_url', 'seduh_photo_purge_folder')
              and has_function_privilege(r, p.oid, 'execute')), 'none', 'the owner function and the url and purge helpers are executable by no API role');
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text), 'none')
             from pg_proc p, unnest(array['anon', 'service_role', 'public']) r
            where p.pronamespace = 'app'::regnamespace and p.proname in ('seduh_my_photo_folder', 'seduh_photo_room')
              and has_function_privilege(r, p.oid, 'execute')), 'none', 'the two helpers the Storage policies call are NOT executable by anon, service_role or PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('seduh_my_photo_folder', 'seduh_photo_room')
            and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']), 2,
  '...but authenticated can (a policy runs as the caller); both SECURITY DEFINER with a pinned search_path');
select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where has_table_privilege(r, 'app.seduh_account_photos', 'select, insert, update, delete')), 'none',
  'no API role holds any privilege on the photo table');
select ok((select relrowsecurity from pg_class where oid = 'app.seduh_account_photos'::regclass) and
          (select count(*) from pg_policy where polrelid = 'app.seduh_account_photos'::regclass) = 0, 'RLS is on for it, with no policy');
select is((select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'seduh-avatars'),
  '(t,204800,"{image/webp,image/jpeg}")', 'the bucket is public, 200 KB, webp and jpeg only');
select is((select string_agg(cmd || ':' || roles::text, ', ' order by cmd) from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname like 'seduh_avatars%'),
  'DELETE:{authenticated}, INSERT:{authenticated}, SELECT:{authenticated}',
  'three Storage policies for the bucket: delete, insert and select, all for authenticated, none for anon and none for UPDATE');

-- ============ Storage RLS: insert ============

select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{"size":1000,"mimetype":"image/webp"}') $$, t086.obj('alpha-t86'))),
  'ok', 'the owner of an open account can insert into their own folder');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', 'b', 'jpg'))),
  'ok', '...a .jpg name as well');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('bravo-t86'))),
  '42501/', 'another account cannot write into someone else''s folder');
select is(t086.as_attempt(0, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', 'c'))),
  '42501/', 'anon cannot write into any folder');
select is(t086.as_attempt(4, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', 'c'))),
  '42501/', 'an organiser with no Seduh ID cannot write into someone''s folder');
select is(t086.as_attempt(5, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', 'c'))),
  '42501/', 'a login with no account cannot either');
select is(t086.as_attempt(3, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('charlie-t86'))),
  '42501/', 'a CLOSED account cannot write even into its own (retired) folder');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, 'alpha-t86/me.webp')),
  '42501/', 'a file name that is not 32 random hex digits is refused');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, 'alpha-t86/' || repeat('A', 32) || '.webp')),
  '42501/', '...upper-case hex is refused');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', 'd', 'png'))),
  '42501/', '...a .png name is refused');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, 'alpha-t86/sub/' || repeat('d', 32) || '.webp')),
  '42501/', '...a nested path is refused');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, repeat('e', 32) || '.webp')),
  '42501/', '...a file in the bucket root is refused');
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, 'ALPHA-T86/' || repeat('e', 32) || '.webp')),
  '42501/', '...and so is a folder that only differs in case');
-- the cap: alpha already has two (the two inserts above were rolled back by attempt, so build the folder as postgres)
select t086.put(t086.obj('alpha-t86', '1'));
select t086.put(t086.obj('alpha-t86', '2'));
select t086.put(t086.obj('alpha-t86', '3'));
select t086.put(t086.obj('alpha-t86', '4'));
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', '5'))),
  'ok', 'the 5th object in a folder is allowed');
select t086.put(t086.obj('alpha-t86', '5'));
select is(t086.as_attempt(1, format($$ insert into storage.objects (bucket_id, name, metadata) values ('seduh-avatars', %L, '{}') $$, t086.obj('alpha-t86', '6'))),
  '42501/', '...the 6th is refused (a person cannot fill the project''s Storage with unrecorded uploads)');

-- ============ Storage RLS: select and delete ============

select is(t086.j(1, $$ select count(*)::int::text::jsonb from storage.objects where bucket_id = 'seduh-avatars' $$), '5'::jsonb,
  'the owner lists exactly their own five objects');
select is(t086.j(2, $$ select count(*)::int::text::jsonb from storage.objects where bucket_id = 'seduh-avatars' $$), '0'::jsonb,
  'another account lists none of them');
select is(t086.j(0, $$ select count(*)::int::text::jsonb from storage.objects where bucket_id = 'seduh-avatars' $$), '0'::jsonb,
  'anon lists none of them (the public URL works by exact path, with no policy; the API list endpoint needs one and anon has none)');
select is(t086.as_delete(2, t086.obj('alpha-t86', '1')), 0, 'another account deletes nothing of alpha''s');
select is(t086.as_delete(0, t086.obj('alpha-t86', '1')), 0, 'anon deletes nothing');
select is(t086.as_delete(4, t086.obj('alpha-t86', '1')), 0, 'an organiser deletes nothing');
select is(t086.n_objects('alpha-t86'), 5, '...all five are still there');
select is(t086.as_delete(1, t086.obj('alpha-t86', '1')), 1, 'the owner deletes their own');
select is(t086.as_attempt(1, format($$ delete from storage.objects where bucket_id = 'seduh-avatars' and name = %L $$, t086.obj('alpha-t86', '2'))),
  '42501/', 'a delete without the Storage API''s flag is refused by Supabase''s own guard (the doors set it for themselves)');
select is(t086.as_attempt(1, format($$ update storage.objects set name = %L where bucket_id = 'seduh-avatars' and name = %L $$, t086.obj('bravo-t86', '9'), t086.obj('alpha-t86', '2'))),
  'ok', 'there is no UPDATE policy: an update matches no row (an object cannot be moved into someone else''s folder)');
select is(t086.n_objects('bravo-t86'), 0, '...and nothing arrived in bravo''s folder');

-- ============ the person's doors: who may ============

select is(t086.as_attempt(0, $$ select public.seduh_set_my_photo('x') $$), '42501/', 'set: anon is refused (no execute privilege at all)');
select is(t086.as_attempt(5, $$ select public.seduh_set_my_photo('x') $$), '42501/no_account', 'set: a login with no account is refused');
select is(t086.as_attempt(4, $$ select public.seduh_set_my_photo('x') $$), '42501/no_account', 'set: an organiser with no account is refused');
select is(t086.as_attempt(3, $$ select public.seduh_remove_my_photo() $$), '42501/no_account', 'remove: a closed account is refused');
select is(t086.as_attempt(0, $$ select public.seduh_remove_my_photo() $$), '42501/', 'remove: anon is refused (no execute privilege at all)');

-- ============ set_my_photo ============

select is(t086.as_attempt(1, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('bravo-t86'))), 'P0001/bad_path', 'a path in another person''s folder is bad_path');
select is(t086.as_attempt(1, $$ select public.seduh_set_my_photo('alpha-t86/me.webp') $$), 'P0001/bad_path', 'a path of the wrong shape is bad_path');
select is(t086.as_attempt(1, $$ select public.seduh_set_my_photo(null) $$), 'P0001/bad_path', 'a null path is bad_path');
select is(t086.as_attempt(1, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('alpha-t86', 'f'))), 'P0001/no_object', 'an object that was never uploaded is no_object');
select t086.put(t086.obj('alpha-t86', '7'), 300000);
select t086.put(t086.obj('alpha-t86', '8'), 1000, 'image/png');
select is(t086.as_attempt(1, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('alpha-t86', '7'))), 'P0001/photo_too_big', 'an object over 200 KB is refused');
select is(t086.as_attempt(1, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('alpha-t86', '8'))), 'P0001/photo_bad_type', 'an object that is not webp or jpeg is refused');
select is((select count(*)::int from app.seduh_account_photos), 0, 'no refusal wrote a reference');

select is(t086.as_run(1, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('alpha-t86', '3'))), 'ok', 'a good photo is recorded');
select is((select photo_path from app.seduh_account_photos where account_id = t086.u(101)), t086.obj('alpha-t86', '3'), '...as the account''s reference');
select is(t086.n_objects('alpha-t86'), 1, '...and every OTHER object in the folder is gone (stray uploads, the unfit ones)');
select is(t086.j(1, $$ select public.seduh_set_my_photo('alpha-t86/' || repeat('3', 32) || '.webp') $$) ->> 'photo_url',
  '/storage/v1/object/public/seduh-avatars/alpha-t86/' || repeat('3', 32) || '.webp', 'the door returns the relative public path');
select is(t086.n_objects('bravo-t86'), 0, 'nothing in anyone else''s folder was touched');
select t086.put(t086.obj('bravo-t86', '1'));
select t086.put(t086.obj('alpha-t86', '9'));
select is(t086.as_run(1, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('alpha-t86', '9'))), 'ok', 'a replacement is recorded');
select is((select photo_path from app.seduh_account_photos where account_id = t086.u(101)), t086.obj('alpha-t86', '9'), '...and the reference moved');
select is(t086.n_objects('alpha-t86'), 1, '...the replaced object is deleted (its old URL is dead)');
select is(t086.n_objects('bravo-t86'), 1, '...and bravo''s object is still there');

-- ============ the profile door ============

select is(t086.j(0, $$ select public.public_seduh_profile('alpha-t86') $$) -> 'identity' ->> 'photo_url',
  '/storage/v1/object/public/seduh-avatars/alpha-t86/' || repeat('9', 32) || '.webp', 'the public page gets the photo path while the name is public');
select is(t086.j(1, $$ select public.seduh_my_record() $$) -> 'account' ->> 'photo_url',
  '/storage/v1/object/public/seduh-avatars/alpha-t86/' || repeat('9', 32) || '.webp', 'the person''s own record shows it too');
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t086.u(101);
select is(t086.j(0, $$ select public.public_seduh_profile('alpha-t86') $$) -> 'identity' ->> 'photo_url', null, 'hidden identity: the public door returns no photo');
select isnt(t086.j(1, $$ select public.seduh_my_record() $$) -> 'account' ->> 'photo_url', null, '...but the person still sees their own in My Seduh ID');
update app.seduh_profile_settings set vis_identity = 'public' where account_id = t086.u(101);
select is(t086.j(0, $$ select public.public_seduh_profile('delta-t86') $$) -> 'identity' ->> 'photo_url', null, 'hidden identity and no photo: null');
-- a third open account with a photo, to be closed (a closed account cannot be reopened)
insert into auth.users (id, email) values (t086.u(7), 'u7@t086.seduh-next');
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values (t086.u(7), '+6738600007', 'T086 Person 7', 'organiser_roster', 'BN');
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values (t086.u(107), t086.u(7), t086.u(7), 'echo-t86', 'organiser_link', now());
select t086.put(t086.obj('echo-t86', '1'));
insert into app.seduh_account_photos (account_id, photo_path) values (t086.u(107), t086.obj('echo-t86', '1'));
select isnt(t086.j(0, $$ select public.public_seduh_profile('echo-t86') $$) -> 'identity' ->> 'photo_url', null, 'an open account with a photo shows it');
update app.seduh_accounts set closed_at = now() where id = t086.u(107);
select is(t086.j(0, $$ select public.public_seduh_profile('echo-t86') $$) ->> 'has_profile', 'false', 'a closed account has no profile, so no photo');
select is(t086.j(0, $$ select public.public_seduh_profile('echo-t86') $$) -> 'identity' ->> 'photo_url', null, '...and its photo_url is null');
-- no account exists without the 18-or-over attestation (the column is NOT NULL and frozen), and both the door and the Storage
-- helper require it, so a photo can never show for, or be written by, someone who has not attested
select is((select attnotnull from pg_attribute where attrelid = 'app.seduh_accounts'::regclass and attname = 'adult_attested_at'), true,
  'adult_attested_at is NOT NULL: every account is attested');
select is((select count(*)::int from pg_proc where oid in ('app.seduh_my_photo_folder()'::regprocedure, 'public.public_seduh_profile(text)'::regprocedure)
            and prosrc like '%adult_attested_at is not null%'), 2, '...and the Storage helper and the profile door both still check it');

-- ============ remove_my_photo and the owner's removal ============

select is(t086.j(1, $$ select public.seduh_remove_my_photo() $$) ->> 'removed', 'true', 'remove: the person removes their own photo');
select is((select count(*)::int from app.seduh_account_photos where account_id = t086.u(101)), 0, '...the reference is gone');
select is(t086.n_objects('alpha-t86'), 0, '...and the object');
select is(t086.j(0, $$ select public.public_seduh_profile('alpha-t86') $$) -> 'identity' ->> 'photo_url', null, '...so the public door has no photo again');
select is(t086.j(1, $$ select public.seduh_remove_my_photo() $$) ->> 'removed', 'false', 'removing again is a harmless no-op');

select t086.put(t086.obj('bravo-t86', '2'));
select is(t086.as_run(2, format($$ select public.seduh_set_my_photo(%L) $$, t086.obj('bravo-t86', '2'))), 'ok', 'bravo records a photo (setup for the owner''s removal)');
select throws_ok($$ select app.seduh_photo_remove('nobody-t86', 'a reason') $$, 'P0002', null, 'owner removal: an unknown handle is refused');
select throws_ok($$ select app.seduh_photo_remove('alpha-t86', 'a reason') $$, 'P0002', null, '...and so is a handle with no photo');
select throws_ok($$ select app.seduh_photo_remove('bravo-t86', '') $$, 'P0001', null, '...and a bare reason');
select lives_ok($$ select app.seduh_photo_remove('bravo-t86', 'T086 reported by a viewer') $$, 'the owner removes a photo');
select is(t086.n_objects('bravo-t86'), 0, '...the objects are gone');
select is((select count(*)::int from app.seduh_account_photos where account_id = t086.u(102)), 0, '...and the reference');
select is(t086.j(0, $$ select public.public_seduh_profile('bravo-t86') $$) -> 'identity' ->> 'photo_url', null, '...so the public page shows initials');
select is((select count(*)::int from app.seduh_claim_audit where action = 'photo.remove' and account_id = t086.u(102)
            and detail ->> 'reason' = 'T086 reported by a viewer' and detail ->> 'handle' = 'bravo-t86' and strpos(detail::text, repeat('2', 32)) = 0), 1,
  '...and it is audited, with the reason and without the removed photo''s path (its random name is not in the detail)');
select is((select array(select k from app.seduh_claim_audit, jsonb_object_keys(detail) k where action = 'photo.remove' order by k)),
  array['had_reference', 'handle', 'reason'], '...and the audit detail holds exactly handle, reason and had_reference (a new key would have to be reviewed)');
select is((select count(*)::int from app.seduh_claim_audit where action = 'photo.remove'), 1, '...once, and the refusals above wrote nothing');

-- ============ the table's own rules ============

select throws_ok($$ insert into app.seduh_account_photos (account_id, photo_path) values (t086.u(101), 'alpha-t86/short.webp') $$, '23514', null, 'the table refuses a path of the wrong shape');
insert into app.seduh_account_photos (account_id, photo_path) values (t086.u(101), t086.obj('alpha-t86', '0'));
select throws_ok(format($$ insert into app.seduh_account_photos (account_id, photo_path) values (%L, %L) $$, t086.u(106), t086.obj('alpha-t86', '0')), '23505', null,
  'one path belongs to one account');
select throws_ok(format($$ update app.seduh_account_photos set account_id = %L where account_id = %L $$, t086.u(106), t086.u(101)), '23001', null,
  'the parent account is frozen (a photo cannot be moved to another person)');

-- ============ rollback ============
-- a copy of the migration's rollback block (kept in step by hand; the two restored functions are not re-created here)
drop policy if exists seduh_avatars_insert on storage.objects;
drop policy if exists seduh_avatars_delete on storage.objects;
drop policy if exists seduh_avatars_select on storage.objects;
drop function if exists app.seduh_photo_remove(text, text);
drop function if exists public.seduh_remove_my_photo();
drop function if exists public.seduh_set_my_photo(text);
drop function if exists app.seduh_photo_purge_folder(text, text);
drop function if exists app.seduh_photo_room(text);
drop function if exists app.seduh_my_photo_folder();
drop function if exists app.seduh_photo_url(text);
drop table if exists app.seduh_account_photos;
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
            and p.proname in ('seduh_set_my_photo', 'seduh_remove_my_photo', 'seduh_photo_remove', 'seduh_photo_url', 'seduh_photo_purge_folder', 'seduh_photo_room', 'seduh_my_photo_folder')), 0,
  'the rollback block removes every function it added');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'seduh_avatars%'), 0, '...and the three Storage policies');
select is(to_regclass('app.seduh_account_photos') is null, true, '...and the table');

select * from finish();
rollback;
