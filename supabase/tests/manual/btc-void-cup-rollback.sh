#!/usr/bin/env bash
# Runs migration 20261125100000_btc_void_cup.sql's rollback block (steps 2 to 7) against the LOCAL database, inside a
# transaction that is rolled back at the end, and prints what it finds. Run it after `npm run db:reset`.
# Step 2/3 bodies are cut verbatim from the migrations the rollback block names; steps 4 to 7 from supabase/tests/088.
# Expected output: log_has_voided=false, confirm_has_voided=false, column_gone=true, grants=authenticated,postgres,service_role
set -euo pipefail
cd "$(dirname "$0")/../../.."
M=supabase/migrations
{
  echo "begin;"
  sed -n '/^create or replace function app.log_score_change()/,/^revoke execute on function app.log_score_change/p' "$M/20261108200000_btc_prelim_round.sql"
  sed -n '/^CREATE OR REPLACE FUNCTION public.confirm_btc_match/,/^CREATE OR REPLACE FUNCTION public.confirm_heat/p' "$M/20261011140000_tenancy_rpc_null_org_guard.sql" | sed '$d'
  sed -n '/^create or replace view btc_standings/,/^alter table public.btc_cup_votes drop constraint/p' supabase/tests/088_btc_void_cup.sql
  cat <<'SQL'
select 'log_has_voided=' || (pg_get_functiondef('app.log_score_change()'::regprocedure) like '%voided%');
select 'confirm_has_voided=' || (pg_get_functiondef('public.confirm_btc_match(uuid,uuid,uuid,timestamptz,jsonb,uuid,boolean,boolean,text,text)'::regprocedure) like '%voided%');
select 'column_gone=' || not exists (select 1 from information_schema.columns where table_name='btc_cup_votes' and column_name='voided');
select 'grants=' || (select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_name='confirm_btc_match' and privilege_type='EXECUTE');
rollback;
SQL
} | docker exec -i supabase_db_seduh-score-next psql -U postgres -v ON_ERROR_STOP=1 -At | grep -E "=|ERROR"
