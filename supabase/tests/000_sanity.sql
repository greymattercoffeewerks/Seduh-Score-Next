-- Phase 0 placeholder: proves the pgTAP runner and CI wiring work before any
-- real schema exists (handoff §14 T0.3). Phase 1 (T1.1+) adds the actual
-- schema/RLS test suite alongside this file; this one can stay as a basic
-- "pgTAP is wired up" sanity check or be renumbered once real coverage lands.
begin;
select plan(1);

select ok(true, 'pgTAP is wired up and running against the local database');

select * from finish();
rollback;
