#!/usr/bin/env bash
# credential-drill.sh — תרגיל-ריבונות-מפתחות יומי (honest, fail-loud)
# מוכיח: PAT/wrap → P → keys.env.enc → rails.env.enc. אפס-חומר-סוד בפלט.
# פלט: receipts/credential-drill-latest.json (verdict PASS/FAIL + checks)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECEIPTS="$ROOT/receipts"; mkdir -p "$RECEIPTS"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
T0="$(date +%s%3N)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TOKEN="${GITHUB_TOKEN:-}"
[ -z "$TOKEN" ] && [ -f "$ROOT/upload/pat.env" ] && TOKEN="$(tr -d '\r\n ' < "$ROOT/upload/pat.env" | awk '{ if (length($0) > m) { m=length($0); l=$0 } } END { print l }')"
J="$TMP/receipt.json"
chk_unwrap=FAIL; chk_keys=FAIL; chk_rails=FAIL; chk_digest=FAIL

if [ -n "$TOKEN" ]; then
  git clone -q --depth 1 "https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/fleet-vault.git" "$TMP/fv" 2>/dev/null
  if [ -d "$TMP/fv" ]; then
    C="$TOKEN"
    P=""
    for W in "$TMP/fv"/wraps/*.enc; do
      [ -f "$W" ] || continue
      KP="$(printf '%s' "$C" | sha256sum | cut -d' ' -f1)"
      if VAULT_TMP_P="$KP" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$W" -out "$TMP/p" -pass env:VAULT_TMP_P 2>/dev/null; then P="$(cat "$TMP/p")"; break; fi
    done
    # legacy fallback: pass == credential
    if [ -z "$P" ]; then
      if VAULT_TMP_P="$C" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$TMP/fv/keys.env.enc" -out "$TMP/p" -pass env:VAULT_TMP_P 2>/dev/null; then P="$C"; fi
    fi
    [ -n "$P" ] && chk_unwrap=PASS
    if [ -n "$P" ]; then
      if VAULT_TMP_P="$P" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$TMP/fv/keys.env.enc" -out "$TMP/k.env" -pass env:VAULT_TMP_P 2>/dev/null; then
        N="$(grep -cE '^[A-Z_][A-Z0-9_]*=.+' "$TMP/k.env" || true)"
        [ "${N:-0}" -ge 10 ] && chk_keys=PASS
      fi
      if VAULT_TMP_P="$P" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$TMP/fv/rails.env.enc" -out "$TMP/r.env" -pass env:VAULT_TMP_P 2>/dev/null; then
        ok=1
        for V in HIVE_POSTING_WIF STEEM_POSTING_WIF BLURT_ACTIVE_WIF HIVE_ANCHOR_ACCOUNT SAOS_RELAY_AGENT_ACCOUNT; do
          grep -qE "^${V}=.+" "$TMP/r.env" || ok=0
        done
        [ "$ok" = "1" ] && chk_rails=PASS
        # digest-vs-disk (האם הקסטודיה ב-גיט == מה שרץ על הדיסק)
        if [ -f "$ROOT/saos-dex/.env" ]; then
          H1="$(sha256sum "$TMP/r.env" | cut -d' ' -f1)"; H2="$(sha256sum "$ROOT/saos-dex/.env" | cut -d' ' -f1)"
          [ "$H1" = "$H2" ] && chk_digest=PASS
        fi
      fi
      rm -f "$TMP/k.env" "$TMP/r.env" "$TMP/p"
    fi
  fi
fi

T1="$(date +%s%3N)"; MS=$((T1 - T0))
# check #6 — connect-all (הראשי-מחבר-הכל: מטריצת-15-חשבונות×steem/hive/blurt מול-השרשראות החיות)
chk_army=FAIL
if command -v bun >/dev/null 2>&1 && [ -f "$ROOT/scripts/connect-all.ts" ]; then
  if (cd "$ROOT" && bun run scripts/connect-all.ts --quiet >/dev/null 2>&1); then chk_army=PASS; fi
fi
if [ "$chk_unwrap" = "PASS" ] && [ "$chk_keys" = "PASS" ] && [ "$chk_rails" = "PASS" ] && [ "$chk_army" = "PASS" ]; then VERDICT=PASS; else VERDICT=FAIL; fi
cat > "$J" <<EOF
{
 "drill": "credential",
 "at": "$TS",
 "verdict": "$VERDICT",
 "durationMs": $MS,
 "checks": { "vaultClone": "$([ -d "$TMP/fv" ] && echo PASS || echo FAIL)", "unwrapP": "$chk_unwrap", "keysEnvEnc": "$chk_keys", "railsEnvEnc": "$chk_rails", "railsDigestVsDisk": "$chk_digest", "connectAllArmy": "$chk_army" },
 "notes": "no secret material in output; plaintext wiped in tmp; fail publishes honestly"
}
EOF
mkdir -p "$TMP/fv_out" 2>/dev/null
cp "$J" "$RECEIPTS/credential-drill-latest.json"
echo "[credential-drill $TS] verdict=$VERDICT unwrap=$chk_unwrap keys=$chk_keys rails=$chk_rails digest=$chk_digest army=$chk_army ms=$MS"
[ "$VERDICT" = "PASS" ]
