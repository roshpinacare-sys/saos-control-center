#!/usr/bin/env bash
# rails-deploy.sh — שחזור-מסילות על-מכונה חדשה: כספת → saos-dex/.env
# דורש: upload/pat.env (או GITHUB_TOKEN). אפס-חומר-סוד בפלט. atomic swap.
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN="${GITHUB_TOKEN:-}"
[ -z "$TOKEN" ] && TOKEN="$(tr -d '\r\n ' < "$ROOT/upload/pat.env" | awk '{ if (length($0) > m) { m=length($0); l=$0 } } END { print l }')"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 "https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/fleet-vault.git" "$TMP/fv"
C="$TOKEN"; P=""
for W in "$TMP/fv"/wraps/*.enc; do
  [ -f "$W" ] || continue
  KP="$(printf '%s' "$C" | sha256sum | cut -d' ' -f1)"
  if VAULT_TMP_P="$KP" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$W" -out "$TMP/p" -pass env:VAULT_TMP_P 2>/dev/null; then P="$(cat "$TMP/p")"; break; fi
done
[ -n "$P" ] || { echo "UNWRAP-FAIL"; exit 1; }
VAULT_TMP_P="$P" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$TMP/fv/rails.env.enc" -out "$TMP/rails.env" -pass env:VAULT_TMP_P
grep -qE '^BLURT_ACTIVE_WIF=.+' "$TMP/rails.env" || { echo "RAILS-INCOMPLETE — refuse"; exit 1; }
install -m 600 "$TMP/rails.env" "$ROOT/saos-dex/.env.new"
mv "$ROOT/saos-dex/.env.new" "$ROOT/saos-dex/.env"
echo "RAILS-DEPLOYED → saos-dex/.env (600) sha=$(sha256sum "$ROOT/saos-dex/.env" | cut -d' ' -f1 | cut -c1-12)"
