-- Seduh Score Next · T-TEN.B3: my_orgs() — "which orgs am I in, and as what?"
--
-- Why: the console is about to let one account belong to several orgs (T-TEN phase C needs an org
-- switcher). It needs the caller's own memberships: org id, name, slug and role. The obvious way,
-- reading org_members, does not work: org_members_read lets a member read EVERY member row of
-- their org (that is how the Team screen lists the team), and the client must not derive "my orgs"
-- from a policy that exposes other people's memberships. So this is a function that returns only
-- the rows where user_id is the caller.
--
-- Behaviour:
--   * my_orgs() returns (org_id, name, slug, role), one row per org the caller belongs to, ordered
--     by name then slug. A caller in no org gets zero rows (not an error): a Guess the Bean
--     account shares auth.users and signs in with no organisation.
--   * It answers only for auth.uid(); there is no parameter to ask about someone else.
--   * Executable by `authenticated` only (revoked from public, anon and service_role; the service
--     role also has no caller identity, so there would be nothing for it to answer anyway).
--   * SECURITY DEFINER so it can read org_members and orgs on the caller's behalf, with the
--     search_path pinned; the WHERE clause on auth.uid() is what scopes it.
-- Also: an index on org_members(user_id). The primary key is (org_id, user_id), so a lookup by
-- user_id alone (this function, and the "which orgs is this account in" check the console runs on
-- every sign-in) had no index to lead with. The (org_id, user_id) lookups every policy does are
-- already served by the primary key and are unaffected.
--
-- rollback:
--   drop function if exists my_orgs();
--   drop index if exists org_members_user_id_idx;

create index if not exists org_members_user_id_idx on org_members (user_id);

create or replace function my_orgs()
returns table (org_id uuid, name text, slug text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug, m.role
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name, o.slug;
$$;

revoke all on function my_orgs() from public, anon, authenticated, service_role;
grant execute on function my_orgs() to authenticated;
