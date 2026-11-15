-- T-ID2.B3a: claiming a Seduh ID (migration 20261118100000_seduh_claim.sql).
-- Proves:
--   * ISSUE: an organiser issues a one-time token for a roster person who HAS an identity; the raw token (43 URL-safe
--     characters, 256 bits) is returned once and never stored (only its SHA-256, 72 hours); a non-member, an unknown id, another
--     organisation's person and anon are refused; a person with no identity, an opted-out one (same answer: nobody learns who
--     objected), a merged one and an already-claimed one are refused with hints; re-issuing revokes the open link, an
--     EXPIRED-but-open one too; one open link at most.
--   * REVOKE and STATUS: no open link is a hint; a revoked token is dead; the status read answers no_identity / can_issue /
--     link_open / claimed / unavailable, refuses another organisation's ids, and exposes no token, hash or user.
--   * CLAIM: signed-in only; "I am 18 or over" must be true; handle shape, reserved and taken (case-insensitively) are hinted;
--     a guessed, malformed, used, revoked or expired token is hinted and changes nothing; a platform admin and a login that
--     already holds an account are refused and the link stays open; an already-claimed or opted-out identity is refused; the happy
--     path makes the account (attested, organiser_link), its settings, the used link and the audit row, and the profile door
--     then answers has_profile.
--   * #0001: only the number 1 can be reserved; only the RESERVED identity can take it, through the claim, with the flag cleared
--     afterwards; nobody else gets 1; an API role cannot insert an account even with the flag; a consumed reservation is frozen.
--   * HANDLE CHECK, BEGIN (the Edge Function's door): the answers, the six-code cap, the service-role-only ACL, no ids returned.
--   * AUDIT: one row per issue, revoke and claim; append-only; no token, email or phone; refusals write nothing.
--   * ACL AND CATALOG: who may execute what; every new public function is SECURITY DEFINER with search_path pinned; the rollback
--     block removes everything it added.
begin;
select plan(134);

create schema t082;
grant usage on schema t082 to anon, authenticated, service_role;

-- 'ok' (rolled back) or SQLSTATE '/' HINT; the statement runs in a sub-transaction that is always rolled back
create function t082.attempt(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || coalesce(v_hint, '');
end $$;
-- the same, but a success KEEPS its effect
create function t082.run(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || coalesce(v_hint, '');
end $$;
create function t082.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- a syntactically valid token that is stored nowhere
create function t082.fake(n int) returns text language sql immutable as $$
  select rpad('FAKE' || n::text, 43, 'x')
$$;
create function t082.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', t082.u(n)::text, true);
end $$;
-- the status of one person of organisation A, as 'state' or 'state:handle'
create function t082.st(person int) returns text language sql as $$
  select state || coalesce(':' || handle, '') from public.seduh_claim_statuses(t082.u(8210), array[t082.u(person)])
$$;
grant execute on all functions in schema t082 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- users: 8201 owner of A, 8202 owner of B, 8203 admin, 8204..8212 claimants, 8213 nobody. organisations 8210 (A) and 8211 (B).
insert into auth.users (id, email)
select t082.u(n), 'u' || n || '@t082.seduh-next' from generate_series(8201, 8213) n;
insert into orgs (id, name, slug) values (t082.u(8210), 'T082 A', 't082-a'), (t082.u(8211), 'T082 B', 't082-b');
insert into org_members (org_id, user_id, role) values
  (t082.u(8210), t082.u(8201), 'owner'), (t082.u(8211), t082.u(8202), 'owner');
insert into app.platform_admins (user_id) values (t082.u(8203));

-- identities: 1 active (the happy path), 2 for the second-account case, 3 for the taken handle, 4 opted_out, 5 merged,
-- 6 reserved for #0001, 7 expired-open link, 8 claimed while its link is open, 9 opted out after issue, 10 admin attempt,
-- 11 two-claims, 12 other-org person, 13 sequence check
insert into app.seduh_identities (id, phone_e164, display_name, source, status)
select t082.u(8300 + n), '+67382' || lpad(n::text, 5, '0'), 'T082 Person ' || n, 'archive', 'active' from generate_series(1, 13) n;
update app.seduh_identities set status = 'opted_out', display_name = null where id = t082.u(8304);
update app.seduh_identities set status = 'merged', merged_into = t082.u(8301) where id = t082.u(8305);

-- people of A: person n has identity n (except the ones noted), person 20 has none
insert into people (id, org_id, display_name, phone)
select t082.u(8400 + n), t082.u(8210), 'Person ' || n, '+67382' || lpad(n::text, 5, '0') from generate_series(1, 11) n;
insert into people (id, org_id, display_name, phone) values (t082.u(8420), t082.u(8210), 'No identity', '+67382999999');
insert into people (id, org_id, display_name, phone) values (t082.u(8412), t082.u(8211), 'Person of B', '+67382000012');
select set_config('app.seduh_link_write', 'on', true);
update people p set global_person_id = t082.u(right(p.id::text, 4)::int - 100)
 where p.org_id in (t082.u(8210), t082.u(8211)) and right(p.id::text, 4)::int between 8401 and 8412;
select set_config('app.seduh_link_write', '', true);

-- an EXPIRED link that is still open (identity 7): created five days ago
insert into app.seduh_claim_links (identity_id, org_id, token_hash, created_at, expires_at)
values (t082.u(8307), t082.u(8210), encode(sha256(convert_to(t082.fake(7), 'UTF8')), 'hex'),
        now() - interval '5 days', now() - interval '2 days');
-- identity 10: the same, for the claim and begin refusals (identity 7's is replaced by the re-issue test)
insert into app.seduh_claim_links (identity_id, org_id, token_hash, created_at, expires_at)
values (t082.u(8310), t082.u(8210), encode(sha256(convert_to(t082.fake(10), 'UTF8')), 'hex'),
        now() - interval '5 days', now() - interval '2 days');
-- identity 8: a live link, issued as the database owner; then claimed by owner SQL while the link is still open
insert into app.seduh_claim_links (identity_id, org_id, token_hash)
values (t082.u(8308), t082.u(8210), encode(sha256(convert_to(t082.fake(8), 'UTF8')), 'hex'));
insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at)
values (t082.u(8308), t082.u(8212), 'owner-sql-82', 'organiser_link', now());
-- identity 9: a live link, then the person opts out
insert into app.seduh_claim_links (identity_id, org_id, token_hash)
values (t082.u(8309), t082.u(8210), encode(sha256(convert_to(t082.fake(9), 'UTF8')), 'hex'));
update app.seduh_identities set status = 'opted_out', display_name = null where id = t082.u(8309);

set local role authenticated;
select t082.as_user(8201);

-- ============ ISSUE: refusals ============
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8420)) || ')'), 'P0001/no_identity',
  'a person with no Seduh ID: no_identity');
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8404)) || ')'), 'P0001/no_identity',
  'an OPTED-OUT identity answers no_identity too (the organiser cannot learn who objected)');
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8405)) || ')'), 'P0001/identity_unavailable',
  'a merged identity: identity_unavailable');
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8408)) || ')'), 'P0001/identity_claimed',
  'an identity that is already claimed: identity_claimed');
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8412)) || ')'), '42501/',
  'another organisation''s person: 42501');
select is(t082.attempt('select public.issue_seduh_claim_link(gen_random_uuid())'), '42501/', 'an unknown person: the SAME 42501');
select is(t082.attempt('select public.issue_seduh_claim_link(null)'), '42501/', 'a NULL person: the same 42501');
select t082.as_user(8213);
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8401)) || ')'), '42501/',
  'a signed-in stranger (a member of nothing): 42501');
select t082.as_user(8202);
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8401)) || ')'), '42501/',
  'the owner of ANOTHER organisation: 42501');
reset role;
set local role anon;
select is(t082.attempt('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8401)) || ')'), '42501/', 'anon: refused at the door');
reset role;
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8301)), 0, 'none of the refusals made a link');
select is((select count(*)::int from app.seduh_claim_audit), 0, '...or an audit row');

-- ============ ISSUE: the happy path ============
set local role authenticated;
select t082.as_user(8201);
select set_config('t082.tok1', public.issue_seduh_claim_link(t082.u(8401)), false);
reset role;
select ok(current_setting('t082.tok1') ~ '^[A-Za-z0-9_-]{43}$', 'the token is 43 URL-safe characters (256 bits)');
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8301) and used_at is null and revoked_at is null), 1,
  'one open link for the identity');
select is((select token_hash from app.seduh_claim_links where identity_id = t082.u(8301)),
  encode(sha256(convert_to(current_setting('t082.tok1'), 'UTF8')), 'hex'), 'what is stored is the SHA-256 of the token');
select is((select count(*)::int from app.seduh_claim_links l where row_to_json(l)::text like '%' || current_setting('t082.tok1') || '%'), 0,
  'the raw token is in no column of the table');
select ok((select expires_at - created_at from app.seduh_claim_links where identity_id = t082.u(8301)) between interval '71 hours 59 minutes' and interval '72 hours',
  'it expires in 72 hours');
select is((select issued_by from app.seduh_claim_links where identity_id = t082.u(8301)), t082.u(8201), 'issued_by is the organiser');
select is((select org_id from app.seduh_claim_links where identity_id = t082.u(8301)), t082.u(8210), 'and the organisation is derived from the person');
select is((select count(*)::int from app.seduh_claim_audit where action = 'claim_link.issue' and actor_id = t082.u(8201)
             and org_id = t082.u(8210) and identity_id = t082.u(8301) and link_id is not null), 1, 'one audit row for the issue');

-- re-issue: the open link is revoked, still one open link, a different token
set local role authenticated;
select t082.as_user(8201);
select set_config('t082.tok1b', public.issue_seduh_claim_link(t082.u(8401)), false);
reset role;
select ok(current_setting('t082.tok1b') <> current_setting('t082.tok1'), 're-issuing gives a different token');
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8301) and used_at is null and revoked_at is null), 1,
  'still exactly one open link');
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8301) and revoked_at is not null), 1, 'and the first one is revoked');
select is((select detail ->> 'replaced_open_links' from app.seduh_claim_audit where action = 'claim_link.issue' order by id desc limit 1), '1',
  'the audit row records that one open link was replaced');
-- an expired-but-open link is revoked by issue (identity 7)
set local role authenticated;
select t082.as_user(8201);
select is(t082.run('select public.issue_seduh_claim_link(' || quote_literal(t082.u(8407)) || ')'), 'ok', 'a new link is issued over an EXPIRED open one');
reset role;
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8307) and used_at is null and revoked_at is null), 1,
  'the expired open link was revoked: one open link');
select is((select count(*)::int from app.seduh_claim_audit where action = 'claim_link.issue'), 3, 'three issues, three audit rows (refusals wrote none)');

-- ============ STATUS ============
set local role authenticated;
select t082.as_user(8201);
select is(t082.st(8401), 'link_open', 'status: link_open');
select ok((select expires_at from public.seduh_claim_statuses(t082.u(8210), array[t082.u(8401)])) > now() + interval '71 hours', '...with its expiry');
select is(t082.st(8420), 'no_identity', 'status: no_identity');
select is(t082.st(8404), 'no_identity', 'status: an opted-out identity reads as no_identity');
select is(t082.st(8405), 'unavailable', 'status: a merged identity is unavailable');
select is(t082.st(8402), 'can_issue', 'status: can_issue');
select is(t082.st(8408), 'claimed:owner-sql-82', 'status: claimed, with the (public) handle');
select is(t082.attempt('select * from public.seduh_claim_statuses(' || quote_literal(t082.u(8210)) || ', array[' || quote_literal(t082.u(8412)) || '::uuid])'), '42501/',
  'status naming another organisation''s person: 42501');
select is(t082.attempt('select * from public.seduh_claim_statuses(' || quote_literal(t082.u(8210)) || ', array[gen_random_uuid()])'), '42501/',
  'status naming an unknown person: the same 42501');
select t082.as_user(8202);
select is(t082.attempt('select * from public.seduh_claim_statuses(' || quote_literal(t082.u(8210)) || ', array[' || quote_literal(t082.u(8401)) || '::uuid])'), '42501/',
  'status for an organisation the caller does not belong to: 42501');
reset role;
select is((select pg_get_function_result('public.seduh_claim_statuses(uuid,uuid[])'::regprocedure)),
  'TABLE(person_id uuid, state text, expires_at timestamp with time zone, handle text)',
  'the status read returns exactly those four columns (no token, no hash, no user)');

-- ============ REVOKE ============
set local role authenticated;
select t082.as_user(8202);
select is(t082.attempt('select public.revoke_seduh_claim_link(' || quote_literal(t082.u(8401)) || ')'), '42501/', 'revoke by another organisation: 42501');
select t082.as_user(8201);
select is(t082.attempt('select public.revoke_seduh_claim_link(' || quote_literal(t082.u(8402)) || ')'), 'P0001/no_open_link', 'revoke with no open link: no_open_link');
select is(t082.attempt('select public.revoke_seduh_claim_link(' || quote_literal(t082.u(8420)) || ')'), 'P0001/no_open_link', 'revoke for a person with no identity: no_open_link');
select is(t082.attempt('select public.revoke_seduh_claim_link(gen_random_uuid())'), '42501/', 'revoke for an unknown person: 42501');
-- issue a throwaway link for person 2 and revoke it
select set_config('t082.tok2', public.issue_seduh_claim_link(t082.u(8402)), false);
select is(t082.run('select public.revoke_seduh_claim_link(' || quote_literal(t082.u(8402)) || ')'), 'ok', 'an organiser revokes an open link');
reset role;
select is((select count(*)::int from app.seduh_claim_audit where action = 'claim_link.revoke' and identity_id = t082.u(8302)), 1, 'one audit row for the revoke');
set local role authenticated;
select t082.as_user(8204);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok2'), 'revoked-one')), 'P0001/link_revoked',
  'a revoked token cannot be claimed: link_revoked');
select t082.as_user(8201);
select is(t082.st(8402), 'can_issue', 'after the revoke the status is can_issue again');
reset role;

-- ============ CLAIM: refusals that change nothing ============
set local role authenticated;
select t082.as_user(8204);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, false)', current_setting('t082.tok1b'), 'happy-82')), 'P0001/adult_required', 'p_adult false: adult_required');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, null)', current_setting('t082.tok1b'), 'happy-82')), 'P0001/adult_required', 'p_adult null: adult_required');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'ab')), 'P0001/handle_invalid', 'too short a handle');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'has_underscore')), 'P0001/handle_invalid', 'an underscore');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'double--dash')), 'P0001/handle_invalid', 'a double dash');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), null)), 'P0001/handle_invalid', 'a NULL handle');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'admin')), 'P0001/handle_reserved', 'a reserved handle');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), '  COUNTRY ')), 'P0001/handle_reserved', 'a reserved handle in other case and with spaces');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', t082.fake(99), 'happy-82')), 'P0001/link_invalid', 'a well-formed token that was never issued: link_invalid');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', 'short', 'happy-82')), 'P0001/link_invalid', 'a malformed token: link_invalid');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', null, 'happy-82')), 'P0001/link_invalid', 'a NULL token: link_invalid');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1'), 'happy-82')), 'P0001/link_revoked',
  'the FIRST token of a re-issued identity is dead (link_revoked)');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', t082.fake(10), 'happy-82')), 'P0001/link_expired', 'an expired link: link_expired');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', t082.fake(8), 'happy-82')), 'P0001/identity_claimed',
  'an identity claimed by other means while its link was open: identity_claimed');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', t082.fake(9), 'happy-82')), 'P0001/identity_unavailable',
  'an identity that opted out after the link was issued: identity_unavailable');
select t082.as_user(8203);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'happy-82')), 'P0001/admin_cannot_claim',
  'a PLATFORM ADMIN login cannot claim: admin_cannot_claim');
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'happy-82')), '42501/', 'signed in with no user id: 42501');
reset role;
set local role anon;
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'happy-82')), '42501/', 'anon: refused at the door');
reset role;
select is((select count(*)::int from app.seduh_accounts where identity_id = t082.u(8301)), 0, 'none of the refusals made an account');
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8301) and used_at is null and revoked_at is null), 1, '...and the link is still open');
select is((select count(*)::int from app.seduh_claim_audit where action = 'claim.complete'), 0, '...and no claim was audited');

-- ============ CLAIM: the happy path ============
set local role authenticated;
select t082.as_user(8204);
select set_config('t082.res1', public.claim_seduh_id(current_setting('t082.tok1b'), '  Happy-82 ', true)::text, false);
reset role;
select is(current_setting('t082.res1')::jsonb ->> 'handle', 'happy-82', 'the claim returns the (normalised) handle');
select ok((current_setting('t082.res1')::jsonb ->> 'founding_number')::int >= 2, 'and a founding number from the sequence (2 or more)');
select is(current_setting('t082.res1')::jsonb ->> 'profile_path', '/id/happy-82/', 'and the profile path');
select is((select count(*)::int from app.seduh_accounts where identity_id = t082.u(8301) and user_id = t082.u(8204) and handle = 'happy-82'
             and claim_method = 'organiser_link' and adult_attested_at is not null and closed_at is null), 1, 'the account exists, attested, via organiser_link');
select is((select count(*)::int from app.seduh_profile_settings s join app.seduh_accounts a on a.id = s.account_id where a.handle = 'happy-82'), 1, 'its settings row exists');
select is((select count(*)::int from app.seduh_claim_links l join app.seduh_accounts a on a.id = l.account_id
            where l.identity_id = t082.u(8301) and l.used_at is not null and a.handle = 'happy-82'), 1, 'the link is used and names the account');
select is((select count(*)::int from app.seduh_claim_audit where action = 'claim.complete' and identity_id = t082.u(8301) and actor_id = t082.u(8204) and account_id is not null), 1,
  'one claim.complete audit row');
set local role anon;
select is((select public.public_seduh_profile('happy-82') ->> 'has_profile'), 'true', 'the profile door now answers has_profile (as anon)');
reset role;
select is((select count(*)::int from app.seduh_claim_audit a where a.detail::text like '%' || current_setting('t082.tok1b') || '%' or a.detail::text ~* '(@|\+673)'), 0,
  'no audit row holds the token, an email or a phone');

-- reuse
set local role authenticated;
select t082.as_user(8205);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'other-82')), 'P0001/link_used', 'the same token again, by someone else: link_used');
select t082.as_user(8204);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok1b'), 'other-82')), 'P0001/link_used', 'the same token again, by the claimant: link_used');
-- a second account for one login
select t082.as_user(8201);
select set_config('t082.tok3', public.issue_seduh_claim_link(t082.u(8403)), false);
select t082.as_user(8204);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok3'), 'second-82')), 'P0001/account_exists',
  'a second account for the same login: account_exists');
-- handle taken, in any case; a closed account keeps its handle too
select t082.as_user(8205);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok3'), 'HAPPY-82')), 'P0001/handle_taken', 'a taken handle, in other case: handle_taken');
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok3'), 'owner-sql-82')), 'P0001/handle_taken', 'another taken handle');
reset role;
select is((select count(*)::int from app.seduh_claim_links where identity_id = t082.u(8303) and used_at is null and revoked_at is null), 1, '(a refused claim leaves the other link open)');

-- ============ HANDLE CHECK ============
set local role anon;
select is(public.seduh_handle_available('fresh-handle-82'), 'available', 'handle check: available');
select is(public.seduh_handle_available('Happy-82'), 'taken', 'handle check: taken (any case)');
select is(public.seduh_handle_available('admin'), 'reserved', 'handle check: reserved');
select is(public.seduh_handle_available('a'), 'invalid', 'handle check: invalid (short)');
select is(public.seduh_handle_available(null), 'invalid', 'handle check: NULL is invalid');
reset role;
update app.seduh_accounts set closed_at = now() where handle = 'owner-sql-82';
select is(public.seduh_handle_available('owner-sql-82'), 'taken', 'a CLOSED account''s handle stays taken (retired, never reissued)');

-- ============ #0001 ============
select is(t082.attempt($$ insert into app.seduh_reserved_numbers (founding_number, identity_id) values (2, '00000000-0000-0000-0000-000000008313') $$), '23514/',
  'only the number 1 can be reserved (2 and up belong to the sequence)');
insert into app.seduh_reserved_numbers (founding_number, identity_id, note) values (1, t082.u(8306), 'owner');
select is(t082.attempt($$ insert into app.seduh_reserved_numbers (founding_number, identity_id) values (1, '00000000-0000-0000-0000-000000008313') $$), '23505/',
  'number 1 can be reserved once');
select is((select count(*)::int from app.seduh_accounts where founding_number = 1), 0, 'while the reservation is pending nobody holds number 1');
-- someone else claims while it is pending: gets 2 or more, never 1
set local role authenticated;
select t082.as_user(8201);
select set_config('t082.tok13', public.issue_seduh_claim_link(t082.u(8411)), false);
select t082.as_user(8206);
select ok((public.claim_seduh_id(current_setting('t082.tok13'), 'bystander-82', true) ->> 'founding_number')::int >= 2,
  'a claim by anyone else while #0001 is reserved gets a sequence number (2 or more)');
-- an API role cannot insert an account, with or without the flag
select set_config('app.seduh_owner_assignment', 'on', true);
select is(left(t082.attempt($$ insert into app.seduh_accounts (identity_id, user_id, handle, founding_number, claim_method, adult_attested_at)
  values ('00000000-0000-0000-0000-000000008313', '00000000-0000-0000-0000-000000008207', 'sneaky-82', 1, 'organiser_link', now()) $$), 6), '42501/',
  'an API role cannot insert an account even with the flag set');
select set_config('app.seduh_owner_assignment', '', true);
select is(left(t082.attempt($$ insert into app.seduh_reserved_numbers (founding_number, identity_id) values (1, '00000000-0000-0000-0000-000000008313') $$), 6), '42501/',
  'an API role cannot reserve a number');
-- the reserved identity claims, with the admin login first (refused), then a competitor login
select t082.as_user(8201);
select set_config('t082.tok6', public.issue_seduh_claim_link(t082.u(8406)), false);
select t082.as_user(8203);
select is(t082.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t082.tok6'), 'owner-82')), 'P0001/admin_cannot_claim',
  'the owner''s ADMIN login cannot take #0001');
select t082.as_user(8207);
select is(public.claim_seduh_id(current_setting('t082.tok6'), 'owner-82', true) ->> 'founding_number', '1', 'the reserved identity''s claim receives founding number 1');
reset role;
select is((select count(*)::int from app.seduh_accounts where founding_number = 1 and identity_id = t082.u(8306) and handle = 'owner-82'), 1, 'and the account holds it');
select is((select count(*)::int from app.seduh_reserved_numbers where identity_id = t082.u(8306) and consumed_at is not null and account_id is not null), 1,
  'the reservation is consumed and names the account');
select is(coalesce(current_setting('app.seduh_owner_assignment', true), ''), '', 'the owner-assignment flag is cleared after the claim');
select is(t082.attempt($$ update app.seduh_reserved_numbers set note = 'x' $$), '23001/', 'a consumed reservation cannot be changed');
select is(t082.attempt($$ delete from app.seduh_reserved_numbers $$), '23001/', '...or removed');
select is((select detail ->> 'reserved_number' from app.seduh_claim_audit where action = 'claim.complete' and identity_id = t082.u(8306)), 'true', 'the audit row says the number was reserved');
select is(t082.attempt($$ insert into app.seduh_accounts (identity_id, user_id, handle, founding_number, claim_method, adult_attested_at)
  values ('00000000-0000-0000-0000-000000008313', '00000000-0000-0000-0000-000000008208', 'dup-one-82', 1, 'organiser_link', now()) $$), '42501/',
  'number 1 cannot be inserted by hand without the flag, even by the owner (the guard comes before the unique constraint)');

-- ============ BEGIN (the Edge Function's door) ============
select is((select public.seduh_claim_begin(t082.fake(99)) ->> 'status'), 'invalid', 'begin: an unknown token is invalid');
select is((select public.seduh_claim_begin('short') ->> 'status'), 'invalid', 'begin: a malformed token is invalid');
select is((select public.seduh_claim_begin(null) ->> 'status'), 'invalid', 'begin: NULL is invalid');
select is((select public.seduh_claim_begin(t082.fake(10)) ->> 'status'), 'expired', 'begin: an expired link');
select is((select public.seduh_claim_begin(current_setting('t082.tok1b')) ->> 'status'), 'used', 'begin: a used link');
select is((select public.seduh_claim_begin(current_setting('t082.tok1')) ->> 'status'), 'revoked', 'begin: a revoked link');
select is((select public.seduh_claim_begin(t082.fake(9)) ->> 'status'), 'unavailable', 'begin: an opted-out identity is unavailable');
select is((select public.seduh_claim_begin(current_setting('t082.tok3'))), jsonb_build_object('status', 'ok', 'display_name', 'T082 Person 3'),
  'begin: a usable link answers ok with the display name and NOTHING else (no id, phone or hash)');
select is((select code_sends from app.seduh_claim_links where identity_id = t082.u(8303) and used_at is null), 1::smallint, 'and counts one emailed code');
select public.seduh_claim_begin(current_setting('t082.tok3')) from generate_series(1, 5);
select is((select public.seduh_claim_begin(current_setting('t082.tok3')) ->> 'status'), 'too_many', 'begin: the seventh request for one link is too_many (cap of six codes)');
select is((select code_sends from app.seduh_claim_links where identity_id = t082.u(8303) and used_at is null), 6::smallint, '...and the count stops at six');

-- ============ UNDO: the owner's runbook (CONVENTIONS.md) ============
select is(t082.run($u$ with closed as (
  update app.seduh_accounts set closed_at = now(), user_id = null where handle = 'happy-82' and closed_at is null
  returning id, identity_id, founding_number)
  insert into app.seduh_claim_audit (action, identity_id, account_id, detail)
  select 'claim.undo', identity_id, id, jsonb_build_object('founding_number', founding_number, 'reason', 'test') from closed $u$), 'ok',
  'the undo runbook runs as written');
select is(public.public_seduh_profile('happy-82') ->> 'has_profile', 'false', 'an undone claim: the profile door answers the empty shape');
select is(public.seduh_handle_available('happy-82'), 'taken', '...and its handle stays retired');
select is((select count(*)::int from app.seduh_claim_audit where action = 'claim.undo'), 1, '...with its audit row');
set local role authenticated;
select t082.as_user(8201);
select set_config('t082.tok10', public.issue_seduh_claim_link(t082.u(8410)), false);
select t082.as_user(8204);
select is(public.claim_seduh_id(current_setting('t082.tok10'), 'second-82', true) ->> 'handle', 'second-82',
  'the login freed by the undo can claim a different identity');
reset role;

-- ============ the audit table ============
select is(t082.attempt($$ update app.seduh_claim_audit set action = 'claim.complete' $$), '42501/', 'the audit log cannot be updated, even by its owner');
select is(t082.attempt($$ delete from app.seduh_claim_audit $$), '42501/', '...deleted from');
select is(t082.attempt($$ truncate app.seduh_claim_audit $$), '42501/', '...or truncated');
select is(t082.attempt($$ insert into app.seduh_claim_audit (action, detail) values ('claim.complete', '{"email": "a@b.c"}') $$), '23514/', 'a secret-looking detail key is refused');
select is(t082.attempt($$ insert into app.seduh_claim_audit (action, detail) values ('made.up', '{}') $$), '23514/', 'an unknown action is refused');
select is((select count(*)::int from (values ('anon'), ('authenticated'), ('service_role'), ('public')) r(role),
            unnest(array['app.seduh_claim_audit', 'app.seduh_reserved_numbers']) t(tbl)
            where has_table_privilege(case r.role when 'public' then 'public' else r.role end, t.tbl, 'select,insert,update,delete')), 0,
  'no API role has any privilege on the audit table or the reservation table');

-- ============ ACL and catalog ============
select is((select coalesce(string_agg(p.proname || ':' || r, ', ' order by p.proname, r), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('issue_seduh_claim_link', 'revoke_seduh_claim_link', 'seduh_claim_statuses', 'claim_seduh_id', 'seduh_handle_available', 'seduh_claim_begin')
              and has_function_privilege(r, p.oid, 'execute')),
  'claim_seduh_id:authenticated, issue_seduh_claim_link:authenticated, revoke_seduh_claim_link:authenticated, seduh_claim_begin:service_role, seduh_claim_statuses:authenticated, seduh_handle_available:anon, seduh_handle_available:authenticated',
  'who may execute what: the organiser doors and the claim to signed-in callers, the handle check to anyone, begin to the service role only');
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.pronamespace = 'public'::regnamespace and a.grantee = 0
              and p.proname in ('issue_seduh_claim_link', 'revoke_seduh_claim_link', 'seduh_claim_statuses', 'claim_seduh_id', 'seduh_handle_available', 'seduh_claim_begin')), 0,
  'nothing is granted to PUBLIC');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('issue_seduh_claim_link', 'revoke_seduh_claim_link', 'seduh_claim_statuses', 'claim_seduh_id', 'seduh_handle_available', 'seduh_claim_begin')
              and p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)), 6, 'all six are SECURITY DEFINER with search_path pinned to the empty string');
select is((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.provolatile = 's'
              and p.proname in ('issue_seduh_claim_link', 'revoke_seduh_claim_link', 'seduh_claim_statuses', 'claim_seduh_id', 'seduh_handle_available', 'seduh_claim_begin')),
  'seduh_claim_statuses, seduh_handle_available', 'only the two pure reads are STABLE (the handle check is cheap and cacheable)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('seduh_claim_audit_write', 'seduh_claim_token_hash', 'forbid_seduh_claim_audit_mutation', 'seduh_reserved_numbers_guard')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'the app helpers are executable by no API role');

-- ============ the migration's rollback block ============
savepoint rollback_block;
drop function if exists public.seduh_claim_begin(text);
drop function if exists public.seduh_handle_available(text);
drop function if exists public.claim_seduh_id(text, text, boolean);
drop function if exists public.seduh_claim_statuses(uuid, uuid[]);
drop function if exists public.revoke_seduh_claim_link(uuid);
drop function if exists public.issue_seduh_claim_link(uuid);
drop function if exists app.seduh_claim_audit_write(text, uuid, uuid, uuid, uuid, jsonb);
drop function if exists app.seduh_claim_token_hash(text);
drop table if exists app.seduh_reserved_numbers;
drop function if exists app.seduh_reserved_numbers_guard();
drop table if exists app.seduh_claim_audit;
drop function if exists app.forbid_seduh_claim_audit_mutation();
alter table app.seduh_claim_links drop constraint if exists seduh_claim_links_code_sends_range;
alter table app.seduh_claim_links drop column if exists last_code_sent_at;
alter table app.seduh_claim_links drop column if exists code_sends;
select is((select count(*)::int from pg_proc where proname in ('seduh_claim_begin', 'seduh_handle_available', 'claim_seduh_id', 'seduh_claim_statuses', 'revoke_seduh_claim_link', 'issue_seduh_claim_link', 'seduh_claim_audit_write', 'seduh_claim_token_hash', 'forbid_seduh_claim_audit_mutation', 'seduh_reserved_numbers_guard'))
          + (select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname in ('seduh_claim_audit', 'seduh_reserved_numbers'))
          + (select count(*)::int from information_schema.columns where table_schema = 'app' and table_name = 'seduh_claim_links' and column_name in ('code_sends', 'last_code_sent_at')),
  0, 'the rollback block removes every function, both tables and both columns');
select is((select count(*)::int from app.seduh_accounts where handle = 'happy-82'), 1, '...and leaves the accounts and the links themselves');
rollback to savepoint rollback_block;
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('seduh_claim_begin', 'seduh_handle_available', 'claim_seduh_id', 'seduh_claim_statuses', 'revoke_seduh_claim_link', 'issue_seduh_claim_link')), 6,
  '(the test rolls the rollback block back: the six public functions are there again)');
select is((select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname in ('seduh_claim_audit', 'seduh_reserved_numbers')), 2,
  '(...and both tables)');

select * from finish();
rollback;
