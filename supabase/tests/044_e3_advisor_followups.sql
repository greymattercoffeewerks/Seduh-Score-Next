-- T-TEN.E3: the advisor follow-ups. Proves: the event-trigger helper rls_auto_enable() (where the database has it:
-- Supabase installs it in the cloud project) is executable by nobody who calls the API; Guess the Bean's sessions
-- policies evaluate auth.uid() once per query (wrapped in a SELECT) and still mean the same thing; and the three
-- foreign keys that matter have a covering index.
begin;
select plan(10);

-- ============ rls_auto_enable ============
select case when to_regprocedure('public.rls_auto_enable()') is null
  then skip(1, 'this database has no rls_auto_enable() (Supabase installs it in the cloud project)')
  else is(
    (select coalesce(string_agg(r.rolname, ', ' order by r.rolname), 'none')
       from pg_roles r
      where r.rolname in ('anon', 'authenticated')
        and has_function_privilege(r.rolname, 'public.rls_auto_enable()', 'execute')),
    'none',
    'rls_auto_enable() cannot be executed by anon or signed-in callers (an event trigger needs no EXECUTE)')
  end;
select case when to_regprocedure('public.rls_auto_enable()') is null
  then skip(1, 'this database has no rls_auto_enable()')
  else ok(
    not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = to_regprocedure('public.rls_auto_enable()')::oid and a.grantee = 0),
    'and it is not granted to PUBLIC either')
  end;

-- ============ sessions policies: the same rule, evaluated once per query ============
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'sessions' and policyname in ('sessions_delete', 'sessions_insert', 'sessions_select_own', 'sessions_update')),
  4,
  'the four creator-scoped sessions policies are all there');
select is(
  (select coalesce(string_agg(policyname, ', ' order by policyname), 'none')
     from pg_policies
    where schemaname = 'public' and tablename = 'sessions'
      and policyname in ('sessions_delete', 'sessions_insert', 'sessions_select_own', 'sessions_update')
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ '\( ?SELECT auth\.uid\(\)'),
  'none',
  'each of them calls auth.uid() inside a SELECT (once per query, not once per row)');
select is(
  (select coalesce(string_agg(policyname, ', ' order by policyname), 'none')
     from pg_policies
    where schemaname = 'public' and tablename = 'sessions'
      and policyname in ('sessions_delete', 'sessions_insert', 'sessions_select_own', 'sessions_update')
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'creator_id = '),
  'none',
  'and each still compares the session''s creator with the caller');

-- behaviour, as two people: a creator keeps their own sessions, the other person sees and changes none of them
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'creator@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'other@test.seduh-next');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ insert into sessions (id, creator_id, name, bean_count) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Mine', 10) $$,
  'a creator can still create a session as themselves');
select throws_ok(
  $$ insert into sessions (id, creator_id, name, bean_count) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', 'Not mine', 10) $$,
  '42501', null,
  'but not as someone else');
select is((select count(*)::int from sessions where id = '00000000-0000-0000-0000-0000000000a1'), 1, 'and sees their own');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from sessions where id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'another signed-in person does not see it (the creator-scoped read)');
reset role;

-- ============ the three foreign keys that matter have a covering index ============
select is(
  (select coalesce(string_agg(w.idx, ', ' order by w.idx), 'none')
     from (values ('ct_stage_entries_entry_id_idx'), ('event_entries_person_id_idx'), ('btc_seeding_tiebreaks_team_event_idx')) w(idx)
    where not exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = w.idx)),
  'none',
  'the covering indexes for ct_stage_entries.entry_id, event_entries.person_id and btc_seeding_tiebreaks (team_id, event_id) exist');

select * from finish();
rollback;
