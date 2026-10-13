#!/usr/bin/env bash
# ═══ liquidity-cadence.sh — T-15 · הקדנס-המאוחד של משמר-הנזילות ═════════════
# החלטות-המפעיל (2026-10-08 — שתי-השאלות-הפתוחות נענו-בקוד):
#   · קדנס-שידור: תביעה+חבילות-מימוש כל-6ש' · משמר-סמכויות+זמינות כל-2ש' ·
#     דגימת-זיכרון כל-5דק' · קופץ-צמתים פר-קריאה (429/שהיה → צומת-הבא).
#   · זיכרון→receipts: כן — WARN 2.0GiB · CRITICAL 2.3GiB (שוליים-מתחת-תקרת-2.5)
#     עם טריגר-דחיסה אוטומטי (mem-sentinel).
# עצירה: touch /tmp/saos-liquidity.stop
set -uo pipefail
cd "$(dirname "$0")/.."

LOCK=/tmp/saos-liquidity.lock
STOP=/tmp/saos-liquidity.stop
LOG=liquidity.log
CYCLE=0

if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "[liquidity] alive (pid $(cat "$LOCK")) — exiting"; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "[liquidity $(date -u +%FT%TZ)] cadence started (pid $$ · 5min tick · 2h guard · 6h revenue · stop: $STOP)"
while true; do
  CYCLE=$((CYCLE+1))
  # ── כל-5דק': משמר-זיכרון (WARN 2.0 / CRITICAL 2.3 + דחיסה) ──
  bun scripts/mem-sentinel.ts >> "$LOG" 2>&1 || true

  # ── כל-2ש' (מחזור 24): דירוג-צמתים + משמר-סמכויות + מעקב-עדים (D4 — סדר-הקפצה-חי) ──
  if [ $((CYCLE % 24)) -eq 1 ]; then
    echo "[liquidity $(date -u +%FT%TZ)] 2h-track: rpc-mesh + authority-guard + witness-tracker"
    bun scripts/rpc-mesh.ts >> "$LOG" 2>&1 || true
    bun scripts/witness-tracker.ts >> "$LOG" 2>&1 || true   # T-35: צורך-את-דירוג-ה-mesh-הטרי
    bun scripts/bandwidth-degradation.ts >> "$LOG" 2>&1 || true   # T-36: מקדמי-הידרדרות → חיזוי-קריסות-צמתים (שאלה-1)
    if bun scripts/authority-guard.ts >> "$LOG" 2>&1; then
      echo "[liquidity $(date -u +%FT%TZ)] authority-guard GREEN" >> "$LOG"
    else
      RC=$?
      if [ "$RC" -eq 2 ]; then
        echo "[liquidity $(date -u +%FT%TZ)] authority-guard RED — drift marker + recovery staged (offline, zero broadcast)" >> "$LOG"
      else
        echo "[liquidity $(date -u +%FT%TZ)] authority-guard internal error rc=$RC — honest" >> "$LOG"
      fi
    fi
  fi

  # ── כל-6ש' (מחזור 72, היסט-36 מול-קדנס-הדלק): נתב-ההכנסות + פס-הפרסום ──
  if [ $((CYCLE % 72)) -eq 37 ]; then
    echo "[liquidity $(date -u +%FT%TZ)] 6h-track: revenue-router + post-batcher"
    (cd saos-dex && timeout 180 bun scripts/revenue-router.ts) >> "$LOG" 2>&1 || true
    (cd saos-dex && timeout 120 bun scripts/post-batcher.ts) >> "$LOG" 2>&1 || true   # T-36: כולל-חציית-שושלת-מול-origin/main (fail-closed)
    bun scripts/rail-compiler.ts >> "$LOG" 2>&1 || true   # T-38: מסילות-התוכן ← מדידות-בלבד · STAGED (owner-gate)
  fi

  # ── דחיפת-קבלות (רק-קבצים-שהשתנו — אפס-סודות) ──
  if [ -n "$(git status --porcelain receipts/ 2>/dev/null)" ]; then
    git add receipts/authority-guard-latest.json receipts/authority-drift-latest.json \
            receipts/mem-sentinel-latest.json receipts/mem-sentinel-history.jsonl \
            receipts/revenue-router-latest.json receipts/rpc-mesh-latest.json \
            receipts/rpc-mesh-history.jsonl receipts/recovery-staged-latest.json \
            receipts/recovery-shard-selftest-latest.json \
            receipts/witness-tracker-latest.json receipts/witness-latency-history.jsonl \
            receipts/bandwidth-degradation-latest.json receipts/bandwidth-degradation-history.jsonl \
            receipts/post-batcher-latest.json receipts/post-batcher-lineage-held.json \
            receipts/lineage-guard.jsonl receipts/books-lineage.json \
            receipts/rail-compiler-latest.json 2>/dev/null || true
    git add content/rails/ 2>/dev/null || true   # T-38: פריטי-מסילות STAGED (מדודים-בלבד · סרוקי-דליפות)
    # T-34-QA: state/recovery/ + seal-shards/ לעולם לא בגיט (מפת-מיקוד-שיקום) — קבלות-מטא-בלבד
    git commit -m "[agent:autonomy] T-15 liquidity-guard: authority-matrix + mem-sentinel receipts (cadence 5min/2h)" >/dev/null 2>&1 || true
    bash scripts/sovereign-push.sh main >> "$LOG" 2>&1 || true
  fi

  if [ -f "$STOP" ]; then echo "[liquidity] stop-file — exiting"; rm -f "$LOCK"; exit 0; fi
  sleep 300
done
