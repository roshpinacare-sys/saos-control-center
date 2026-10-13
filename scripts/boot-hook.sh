#!/usr/bin/env bash
# ═══ boot-hook.sh — הצתה-עצמית (EXEC-CD-46) ═════════════════════════════════
# נרץ אוטומטית לפני כל `bun run dev` (predev). בסנדבוקס-טרי (אין-סימון-ג'נזיס)
# הוא מצית-את scripts/genesis.ts באסינכרון — האוטונומיה משחזרת-את-עצמה מהגיט
# בלי-שום-פעולה-אנושית-מעבר-להנחת-הטוקן (upload/pat.env).
#
# עקרונות: אפס-חסימה (ה-dev-ממשיך-מיד) · אפס-סודות-בלוג · ריצה-יחידה (flock).
cd /home/z/my-project 2>/dev/null || exit 0

# ריצה-יחידה: אם-ג'נזיס-חי-כבר — צא-בשקט
if ! mkdir /tmp/saos-genesis-hook.lock 2>/dev/null; then
  exit 0
fi

need_genesis=0
if [ ! -f .autonomy-genesis-done ]; then
  need_genesis=1
elif [ -n "$GENESIS_FORCE" ]; then
  need_genesis=1
fi

if [ "$need_genesis" = "1" ]; then
  nohup bun scripts/genesis.ts --wait >> genesis.log 2>&1 &
  echo "[boot-hook] genesis מוצת באסינכרון (pid $!) — genesis.log"
fi

rmdir /tmp/saos-genesis-hook.lock 2>/dev/null
exit 0
