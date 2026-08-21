-- T1.4 CI gate: every FOR INSERT / FOR UPDATE / FOR ALL policy in the public schema
-- must carry an explicit WITH CHECK. USING alone governs reads and the pre-image of
-- an update — it does not constrain what gets written. This test runs first
-- (numbered 000) so a missing WITH CHECK fails the suite immediately.
--
-- 'ALL' is in the cmd list deliberately, not just 'INSERT'/'UPDATE': every write
-- policy in this schema is declared FOR ALL (see 20260821230000_rls_policies.sql),
-- so pg_policies.cmd shows 'ALL', never 'INSERT'/'UPDATE' individually — a gate
-- checking only cmd IN ('INSERT','UPDATE') would match zero rows here and pass
-- vacuously without inspecting anything (security-reviewer caught this live while
-- reviewing T1.3, before this gate existed).
--
-- Run with: npm run db:test
begin;
select plan(1);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and with_check is null),
  0,
  'every INSERT/UPDATE/ALL policy in public has an explicit WITH CHECK'
);

select * from finish();
rollback;
