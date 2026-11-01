#!/usr/bin/env bash
# MANUAL concurrency check for app.archive_tick (T-ARC.1), not run by `npm run db:test` (pgTAP is single-session and
# cannot show `for update skip locked`). Run against the local stack (`npm run supabase -- start`):
#
#   bash supabase/tests/manual/archive-tick-concurrency.sh
#
# Scenario: one session holds a due archive row locked (a 6 s pg_sleep inside its transaction); a second session runs the
# tick meanwhile. The tick must NOT wait and must NOT touch that row (it skips it), and a later tick publishes it exactly
# once. Exit 0 only if that holds. Uses its own random throwaway organisation and event, flips
# results_archive_optional to enforced for the run, and puts everything back on exit even if interrupted. Touches only the
# local database; never run it against anything else.
#
# Needs the Docker container name below (supabase `project_id` = seduh-score-next).
set -u
C=supabase_db_seduh-score-next
psqlc() { docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -At "$@"; }

ORG=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || powershell -NoProfile -Command "[guid]::NewGuid().ToString()" | tr -d '\r')
EV=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || powershell -NoProfile -Command "[guid]::NewGuid().ToString()" | tr -d '\r')
SLUG="arc-race-${ORG:0:8}"
WAS=$(psqlc -c "select enforced from app.entitlement_keys where key = 'results_archive_optional'")
fail=0

[ "$WAS" = "t" ] && WAS_SQL=true || WAS_SQL=false
cleanup() {
  psqlc -c "delete from public.public_results where event_id = '$EV';
            delete from app.archive_events where event_id = '$EV';
            delete from public.events where id = '$EV';
            delete from public.orgs where id = '$ORG';
            update app.entitlement_keys set enforced = $WAS_SQL where key = 'results_archive_optional';" >/dev/null 2>&1
}

trap cleanup EXIT
psqlc -c "insert into public.orgs (id, name, slug) values ('$ORG', 'Arc race', '$SLUG');
          insert into public.events (id, org_id, format, name) values ('$EV', '$ORG', 'cup_taster', 'Arc race event');
          update public.events set ended_at = now() - interval '25 hours', ended_via = 'organiser' where id = '$EV';
          insert into app.archive_events (event_id, org_id, due_at) values ('$EV', '$ORG', now() - interval '1 hour');
          update app.entitlement_keys set enforced = true where key = 'results_archive_optional';" >/dev/null || { echo "FAIL: setup"; exit 1; }

# session A: lock the row, hold it
( psqlc -c "begin; select 1 from app.archive_events where event_id = '$EV' for update; select pg_sleep(6); commit;" >/dev/null ) &
APID=$!
# wait until A really holds it
for i in $(seq 1 20); do
  held=$(psqlc -c "select count(*) from pg_stat_activity where query like '%pg_sleep(6)%' and state = 'active' and pid <> pg_backend_pid()")
  [ "${held:-0}" -ge 1 ] && break
  sleep 0.5
done

# session B: the tick, while A holds the row
START=$(date +%s)
OUT=$(psqlc -c "select app.archive_tick(null)")
ELAPSED=$(( $(date +%s) - START ))
STATE=$(psqlc -c "select state from app.archive_events where event_id = '$EV'")
echo "tick while locked: $OUT (state=$STATE, ${ELAPSED}s)"
if [ "$STATE" = "pending" ] && [ "$ELAPSED" -lt 5 ] && echo "$OUT" | grep -q '"stubbed": 0'; then
  echo "PASS: the tick skipped the locked row without waiting"
else
  echo "FAIL: the tick should skip a locked row immediately and leave it pending"; fail=1
fi

wait $APID
OUT2=$(psqlc -c "select app.archive_tick(null)")
OUT3=$(psqlc -c "select app.archive_tick(null)")
N=$(psqlc -c "select count(*) from public.public_results where event_id = '$EV'")
echo "tick after release: $OUT2"
echo "tick again:         $OUT3"
if [ "$N" = "1" ] && echo "$OUT2" | grep -q '"stubbed": 1' && echo "$OUT3" | grep -q '"stubbed": 0'; then
  echo "PASS: published exactly once"
else
  echo "FAIL: expected one result from one tick and nothing from the next (results=$N)"; fail=1
fi
exit $fail
