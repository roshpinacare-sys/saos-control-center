#!/usr/bin/env bash
# witness-push (EXEC-CD-40) — העדות-הציבורית של מנוע-הסנדבוקס אל TruthRail (ריפו-ציבורי).
#
# עיקרון: למפעיל אין-שום-דבר-שהוא-יכול-לבדוק-בעיניים-שלו בלי-לסמוך-על-סוכן.
# הזה-משנה-את-זה: כל-20-דק' המנוע-החי-בסנדבוקס חותם-קובץ-עדות קטן (גובה+שורש+זמן,
# אפס-סודות — stateRoot כבר-ציבורי-בעיגונים) אל TruthRail. כשהסנדבוקס-מת — העדות
# מפסיקה-להתחדש וה-"age" גדל-לבד: המפעיל-רואה-מוות-בעיניים-בלי-שאף-סוכן-יגיד-כלום.
#
# הרצה: bash scripts/witness-push.sh --once   (בדיקה-חד-פעמית)
#        setsid nohup bash scripts/witness-push.sh &   (לופ-20-דק', קנוני)
# כיבוי: touch /tmp/saos-witness-push.stop
# אנטי-כפילות: /tmp/saos-witness-push.lock (pid-חי).
set -u
MOTHER="/home/z/my-project"
PAT_FILE="$MOTHER/upload/pat.env"
REPO="roshpinacare-sys/TruthRail"
WITNESS_PATH="receipts/sandbox-dex-witness.json"
LOCK="/tmp/saos-witness-push.lock"
INTERVAL=1200

log() { echo "[witness-push $(date -u +%H:%M:%S)] $*"; }

if [ "${1:-}" = "--once" ]; then
  :
else
  if [ -f "$LOCK" ]; then
    OLD=$(cat "$LOCK" 2>/dev/null || echo 0)
    if kill -0 "$OLD" 2>/dev/null; then log "copy-alive (pid $OLD) — exiting"; exit 0; fi
    log "stale lock (pid $OLD dead) — taking over"
  fi
  echo $$ > "$LOCK"
fi

cleanup() { [ "${1:-}" != "--once" ] && rm -f "$LOCK"; return 0; }
trap 'cleanup $*' EXIT

while true; do
  [ -f /tmp/saos-witness-push.stop ] && { log "stop-file — exiting"; exit 0; }

  # 1) גובה-המנוע — מה-snapshot-הקנוני (אותו-מצב-ש-state-push דוחף-לגיט; savedAt = מיידיות-האמת)
  H=""
  SAVED=""
  SNAP="$MOTHER/saos-dex/db/state-snapshot.json"
  if [ -s "$SNAP" ]; then
    read -r H SAVED <<< "$(python3 -c "
import json
try:
    d=json.load(open('$SNAP')); st=d.get('state',{})
    print(st.get('height') or '', d.get('savedAt') or '')
except Exception: print('', '')
" 2>/dev/null)"
  fi
  # נפילה-כנה: אין-snapshot-רענן = עדות-על-היעדר (כן, גם-זו-אמת)
  if [ -z "$H" ]; then
    (echo > /dev/tcp/127.0.0.1/3010) 2>/dev/null && STATE="engine-port-up-state-unread" || STATE="engine-down"
  else
    (echo > /dev/tcp/127.0.0.1/3010) 2>/dev/null && STATE="engine-live" || STATE="state-live-port-down"
  fi

  # 3) דחיפה-טוקנית-חד-פעמית (set-url → push → scrub → אימות-נקי)
  if [ ! -s "$PAT_FILE" ]; then log "no PAT — skip cycle"; rm -f "${TMP:-}"; else
    TOKEN=$(tr -d '\r\n' < "$PAT_FILE")
    WRK=$(mktemp -d)
    git clone -q --depth 1 "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$WRK/r" 2>/dev/null
    if [ ! -d "$WRK/r/.git" ]; then log "clone failed — skip cycle"; rm -rf "$WRK" "${TMP:-}"; TOKEN=''; else
      mkdir -p "$WRK/r/receipts"
      # 2) קובץ-העדות — שרשרת-אמת (EXEC-CD-44): seq מתקדם · prevHash=sha256(העדות-הקודמת-כפי-שהיא-מקומטת) · stateRoot מהמנוע-החי
      PREV_HASH="null"; SEQ=1
      if [ -s "$WRK/r/$WITNESS_PATH" ]; then
        PREV_HASH=$(sha256sum "$WRK/r/$WITNESS_PATH" | cut -d' ' -f1)
        SEQ=$(python3 -c "
import json
try: print(int(json.load(open('$WRK/r/$WITNESS_PATH')).get('seq', 0)) + 1)
except Exception: print(1)
" 2>/dev/null || echo 1)
      fi
      SR=$(curl -s --max-time 4 "http://127.0.0.1:3010/saos-dex/api/dex/state" 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin); print(d.get('stateRoot') or (d.get('state') or {}).get('stateRoot') or '')
except Exception: print('')
" 2>/dev/null || echo '')
      TMP=$(mktemp)
      cat > "$TMP" <<EOF
{
  "source": "sandbox-dex",
  "state": "$STATE",
  "height": ${H:-null},
  "stateRoot": "${SR:-null}",
  "seq": ${SEQ},
  "prevHash": "${PREV_HASH}",
  "stateSavedAt": "${SAVED:-null}",
  "witnessedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "sandbox engine live witness — age of witnessedAt IS the health signal; hash-chain: each witness commits sha256 of the previous committed witness file (verify: scripts/verify-witness-chain.sh) — any deletion/tamper of history breaks the chain visibly"
}
EOF
      cp "$TMP" "$WRK/r/$WITNESS_PATH"
      git -C "$WRK/r" add "$WITNESS_PATH"
      if git -C "$WRK/r" diff --cached --quiet; then
        log "no change — skip push"
      else
        git -C "$WRK/r" -c user.name="roshpinacare-sys" -c user.email="326012154+roshpinacare-sys@users.noreply.github.com" \
          commit -q -m "sandbox-dex witness: height=${H:-down} at $(date -u +%Y-%m-%dT%H:%M:%SZ) [skip ci]"
        if git -C "$WRK/r" push -q origin HEAD 2>/dev/null; then
          log "WITNESS LANDED: height=${H:-down} state=$STATE"
        else
          log "push failed (non-fast-forward or auth) — skip cycle"
        fi
      fi
      rm -rf "$WRK"  # עותק-אפמרלי — כל-שארית-טוקן-מושמדת-כאן
      TOKEN=''
    fi
  fi
  rm -f "${TMP:-}"

  [ "${1:-}" = "--once" ] && exit 0
  sleep "$INTERVAL"
done
