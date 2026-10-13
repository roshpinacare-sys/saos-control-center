#!/usr/bin/env bash
# ═══ fuel-telemetry-cadence.sh — Task 3-c/3-d · הקדנס-המאוחד של הדלק ═════════
# כל-15דק': מפיק-ה-fuel-state (15-חשבונות × שרשראות → receipts) + דחיפת-קבלות.
# כל-24-מחזורים (≈6ש'): לולאת-הדלק (claim-Steem) + רענון-חבילות-broadcast-pending.
# עצירה: touch /tmp/saos-fuel-telemetry.stop
set -uo pipefail
cd "$(dirname "$0")/.."

LOCK=/tmp/saos-fuel-telemetry.lock
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "[fuel-telemetry] alive (pid $(cat "$LOCK")) — exiting"; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

CYCLE=0
echo "[fuel-telemetry $(date -u +%FT%TZ)] cadence started (pid $$ · 15min · stop-file: /tmp/saos-fuel-telemetry.stop)"
while true; do
  CYCLE=$((CYCLE+1))
  echo "[fuel-telemetry $(date -u +%FT%TZ)] cycle #$CYCLE"
  bun scripts/fuel-state.ts >> fuel-state.log 2>&1
  if [ $((CYCLE % 24)) -eq 1 ]; then
    echo "[fuel-telemetry $(date -u +%FT%TZ)] 6h-track: fuel-loop + broadcast-pending refresh"
    (cd saos-dex && DATABASE_URL=file:/home/z/my-project/saos-dex/db/dex.db timeout 120 bun scripts/steem-fuel-loop.ts) >> fuel-state.log 2>&1
    (cd saos-dex && timeout 120 bun scripts/broadcast-pending.ts) >> fuel-state.log 2>&1
  fi
  if [ -n "$(git status --porcelain receipts/ 2>/dev/null)" ]; then
    git add receipts/fuel-state-latest.json receipts/fuel-ledger-latest.json receipts/broadcast-pending-latest.json 2>/dev/null || true
    git commit -m "[agent:autonomy] fuel-telemetry: live fuel-state + fuel-ledger + broadcast-pending receipts (cadence 15min · fuel-only blockers · rotation engine live)" >/dev/null 2>&1 || true
  fi
  bash scripts/sovereign-push.sh main >> fuel-state.log 2>&1 || true
  if [ -f /tmp/saos-fuel-telemetry.stop ]; then echo "[fuel-telemetry] stop-file — exiting"; rm -f /tmp/saos-fuel-telemetry.stop; exit 0; fi
  sleep 900
done
