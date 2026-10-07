#!/usr/bin/env bash
# MANUAL concurrency checks — not run by `npm run db:test` (pgTAP is single-session and
# cannot prove any of this). Run against the local stack (`npm run supabase -- start`):
#
#   bash supabase/tests/manual/correction-vs-confirm-race.sh
#
# Exit 0 only if every scenario behaves; each prints PASS/FAIL. Each run uses its own random
# ids for a throwaway is_test org (so two runs, or a reviewer's probe, cannot collide) and
# removes it on exit even if interrupted. Written after scoring-auditor reproduced the first
# scenario on 2026-10-06.
#
# Each scenario holds one session's transaction open (a 4s pg_sleep AFTER its write), waits until
# that session is actually sleeping, then starts the second — and fails the scenario if the second
# did not really have to wait (otherwise a slow `docker exec` could let it pass by not racing at all).
#
# 1. CORRECTION vs CONFIRM. The scorer's screen reads the heat, someone corrects a time from the
#    manual timekeeper, the scorer taps Confirm. confirm_heat locks the heat row first (migration
#    20261006110000), so the confirm waits, then raises "CONFLICT: heat ... has been modified since it
#    was read". Before that migration the confirm succeeded and silently restored the old time:
#      confirmed | elapsed=200 | source=tapped | note=Missed the stop
# 2. correct_heat_time RETRY behind its own first delivery (same operation id from two sessions): the
#    second waits on the lock, then returns as a no-op (one ledger row).
# 3. confirm_heat RETRY behind its own first delivery: same, heat confirmed once, one result.
# 4. record_heat_time 'reject' RETRY (a real tap delivered twice): no self-inflicted CONFLICT.
# 5. record_heat_time 'overwrite' RETRY (a manual entry delivered twice): no ledger primary-key error.
# 6. TWO DIFFERENT corrections racing on the same shown time (compare-and-set under concurrency): the
#    first wins; the second waits, then is refused (P0002), and the first value stands.
#
# Needs the Docker container name below (supabase `project_id` = seduh-score-next).
set -u
C=supabase_db_seduh-score-next
P="docker exec -i $C psql -U postgres -tA"
newid() { $P -c "select gen_random_uuid()"; }
ORG=$(newid); EVENT=$(newid); PERSON=$(newid); STAGE=$(newid); SET=$(newid); HEAT=$(newid); HE=$(newid)
FAILED=0

cleanup() {
  $P -c "delete from orgs where id = '$ORG'" >/dev/null 2>&1
  left=$($P -c "select count(*) from orgs where id = '$ORG'" 2>/dev/null)
  if [ "$left" != "0" ]; then
    echo "WARNING: throwaway org $ORG was NOT removed (count=$left)"
    exit 1
  fi
}
trap cleanup EXIT

# setup <heat status> <entry elapsed or null> <entry time_source>
setup() {
  local status=${1:-scoring} elapsed=${2:-200} source=${3:-tapped}
  $P -v ON_ERROR_STOP=1 >/dev/null <<EOF
delete from orgs where id = '$ORG';
insert into orgs (id, name, slug) values ('$ORG', 'Race Org', 'race-org-' || substr('$ORG', 1, 8));
insert into events (id, org_id, format, name, is_test) values ('$EVENT', '$ORG', 'cup_taster', 'Race', true);
insert into event_entries (id, event_id, display_name) values ('$PERSON', '$EVENT', 'Racer');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values ('$STAGE', '$EVENT', 'prelims', 1, 1, 480);
insert into ct_sets (id, stage_id, position) values ('$SET', '$STAGE', 1);
insert into ct_heats (id, stage_id, heat_number, timing_mode, status, duration_secs) values ('$HEAT', '$STAGE', 1, 'app', '$status', 480);
insert into ct_heat_entries (id, heat_id, entry_id, station, elapsed_secs, elapsed_secs_raw, time_source) values ('$HE', '$HEAT', '$PERSON', 'A', $elapsed, $elapsed, '$source');
EOF
  if [ $? -ne 0 ]; then echo "FAIL: could not set up fixtures (is the local stack up and migrated?)"; exit 1; fi
}

row() {
  $P -c "select h.status || '|' || coalesce(e.elapsed_secs::text, 'null') || '|' || e.time_source || '|' || coalesce(e.time_note,'-') from ct_heat_entries e join ct_heats h on h.id = e.heat_id where e.id = '$HE'"
}

verdict() { # name, ok(0/1), detail
  if [ "$2" = "0" ]; then echo "PASS  $1"; else echo "FAIL  $1 — $3"; FAILED=1; fi
}

# Blocks until some session is inside its `select pg_sleep(4)` (so its write is made and its
# transaction is open); gives up after ~10s.
wait_for_sleeper() {
  local i
  for i in $(seq 1 50); do
    n=$($P -c "select count(*) from pg_stat_activity where state = 'active' and query like 'select pg_sleep(4)%' and pid <> pg_backend_pid()")
    [ "$n" != "0" ] && return 0
    sleep 0.2
  done
  return 1
}

# race <first-session sql> <second-session sql> — sets OUT (second session's output) and WAITED (0 if it had to wait)
race() {
  ( $P >/dev/null <<EOF
begin;
$1
select pg_sleep(4);
commit;
EOF
  ) &
  if ! wait_for_sleeper; then OUT="(the first session never reached its sleep)"; WAITED=1; wait; return; fi
  local started=$SECONDS
  OUT=$($P -v ON_ERROR_STOP=1 2>&1 <<EOF
$2
EOF
  )
  [ $((SECONDS - started)) -ge 1 ] && WAITED=0 || WAITED=1
  wait
}

CORRECT_SQL() { echo "select correct_heat_time('$1', '$ORG', '$HE', 200, 150, 150, false, 'Missed the stop', now());"; }
CONFIRM_SQL() { # operation id, updated_at
  echo "select confirm_heat('$1', '$ORG', '$HEAT', '$2'::timestamptz, '[{\"entry_id\":\"$HE\",\"elapsed_secs\":200,\"elapsed_secs_raw\":200,\"maxed\":false,\"time_source\":\"tapped\",\"results\":[{\"set_id\":\"$SET\",\"correct\":true}]}]'::jsonb);"
}
has_error() { case "$1" in *ERROR*) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------- 1
setup scoring 200 tapped
U0=$($P -c "select updated_at from ct_heats where id = '$HEAT'")
race "$(CORRECT_SQL "$(newid)")" "$(CONFIRM_SQL "$(newid)" "$U0")"
FINAL=$(row)
case "$OUT" in *"CONFLICT: heat"*"has been modified since it was read"*) conflict=0 ;; *) conflict=1 ;; esac
[ "$FINAL" = "scoring|150|manual|Missed the stop" ] && kept=0 || kept=1
verdict "1 correction vs confirm: the stale confirm waited, then conflicted" $((conflict + WAITED)) "waited=$WAITED output: $OUT"
verdict "1 correction vs confirm: the corrected time survives" $kept "final row was: $FINAL"

# ---------------------------------------------------------------- 2
setup scoring 200 tapped
OP=$(newid)
race "$(CORRECT_SQL "$OP")" "$(CORRECT_SQL "$OP")"
FINAL=$(row)
LEDGER=$($P -c "select count(*) from processed_operations where id = '$OP'")
has_error "$OUT" && noerr=1 || noerr=0
[ "$FINAL" = "scoring|150|manual|Missed the stop" ] && [ "$LEDGER" = "1" ] && same=0 || same=1
verdict "2 correct_heat_time retry behind its own first delivery is a no-op" $((noerr + same + WAITED)) "waited=$WAITED output: $OUT / row: $FINAL / ledger rows: $LEDGER"

# ---------------------------------------------------------------- 3
setup scoring 200 tapped
OP=$(newid)
U0=$($P -c "select updated_at from ct_heats where id = '$HEAT'")
race "$(CONFIRM_SQL "$OP" "$U0")" "$(CONFIRM_SQL "$OP" "$U0")"
STATUS=$($P -c "select status from ct_heats where id = '$HEAT'")
RESULTS=$($P -c "select count(*) from ct_results where heat_entry_id = '$HE'")
has_error "$OUT" && noerr=1 || noerr=0
[ "$STATUS" = "confirmed" ] && [ "$RESULTS" = "1" ] && once=0 || once=1
verdict "3 confirm_heat retry behind its own first delivery is a no-op" $((noerr + once + WAITED)) "waited=$WAITED output: $OUT / status: $STATUS / results: $RESULTS"

# ---------------------------------------------------------------- 4
setup timing null tapped
OP=$(newid)
TAP="select record_heat_time('$OP', '$ORG', '$HE', 'timing', 100, 100, false, 'tapped', now(), 'reject');"
race "$TAP" "$TAP"
FINAL=$(row)
LEDGER=$($P -c "select count(*) from processed_operations where id = '$OP'")
has_error "$OUT" && noerr=1 || noerr=0
[ "$FINAL" = "scoring|100|tapped|-" ] && [ "$LEDGER" = "1" ] && same=0 || same=1
verdict "4 record_heat_time 'reject' retry behind its own first delivery is a no-op" $((noerr + same + WAITED)) "waited=$WAITED output: $OUT / row: $FINAL / ledger rows: $LEDGER"

# ---------------------------------------------------------------- 5
setup timing 90 manual
OP=$(newid)
MANUAL="select record_heat_time('$OP', '$ORG', '$HE', 'timing', 100, 100, false, 'manual', now(), 'overwrite');"
race "$MANUAL" "$MANUAL"
FINAL=$(row)
LEDGER=$($P -c "select count(*) from processed_operations where id = '$OP'")
has_error "$OUT" && noerr=1 || noerr=0
[ "$FINAL" = "scoring|100|manual|-" ] && [ "$LEDGER" = "1" ] && same=0 || same=1
verdict "5 record_heat_time 'overwrite' retry behind its own first delivery is a no-op" $((noerr + same + WAITED)) "waited=$WAITED output: $OUT / row: $FINAL / ledger rows: $LEDGER"

# ---------------------------------------------------------------- 6
setup scoring 200 tapped
OP1=$(newid); OP2=$(newid)
FIRST="select correct_heat_time('$OP1', '$ORG', '$HE', 200, 150, 150, false, 'Missed the stop', now());"
SECOND="select correct_heat_time('$OP2', '$ORG', '$HE', 200, 140, 140, false, 'Wrong cupper', now());"
race "$FIRST" "$SECOND"
FINAL=$(row)
case "$OUT" in *"CONFLICT: heat entry"*"time is now 150 seconds, expected 200 seconds"*) refused=0 ;; *) refused=1 ;; esac
[ "$FINAL" = "scoring|150|manual|Missed the stop" ] && first_stands=0 || first_stands=1
verdict "6 two corrections from the same shown time: the second is refused" $((refused + WAITED)) "waited=$WAITED output: $OUT"
verdict "6 two corrections from the same shown time: the first stands" $first_stands "final row was: $FINAL"

[ "$FAILED" = "0" ] && echo "ALL PASS" || echo "SOMETHING FAILED"
exit $FAILED
