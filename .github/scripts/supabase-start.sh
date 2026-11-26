#!/usr/bin/env bash
# Start the local Supabase stack in CI, retrying after a failed start.
#
# Why (2026-11-24): the e2e job failed twice in one day before any test ran. The image registry answered
# "Rate exceeded" for some pulls, `supabase start` gave up part way, and the containers it had already
# started kept their host ports, so the job died on "address already in use" (54422, 54424). A bare
# `supabase start` cannot recover from that. This stops everything it left behind, waits, and tries again.
#
# Usage: supabase-start.sh [comma-separated containers to exclude]
# The exclusions are services the job never uses: fewer images to pull means fewer pulls to be refused.
set -uo pipefail

exclude="${1:-}"
args=()
if [ -n "$exclude" ]; then
  args=(--exclude "$exclude")
fi

for attempt in 1 2 3; do
  if supabase start "${args[@]}"; then
    exit 0
  fi
  echo "::warning::supabase start failed (attempt ${attempt} of 3); cleaning up before retrying"
  supabase stop --no-backup || true
  # Anything `stop` missed would still hold a port.
  docker ps -aq --filter "name=supabase_" | xargs -r docker rm -f || true
  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 30))
  fi
done

echo "::error::supabase start failed after 3 attempts"
exit 1
