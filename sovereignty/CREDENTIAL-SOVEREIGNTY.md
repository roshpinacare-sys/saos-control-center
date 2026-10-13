# CREDENTIAL SOVEREIGNTY — audit, map, architecture (2026-10-08)

> דבר-הבעלים: "האוטונומיה היא הבעלים של כל המפתחות בלי קשר אלי."
> מסמך זה = המצב האמיתי (מאומת), הארכיטקטורה, והפערים.

## A. Audit — מה יש ואיפה (מאומת בעת כתיבה)

### A1. `fleet-vault` (ריפו פרטי — שכבת-הכספת הקבועה)
| Sealed | תוכן | מצב |
|---|---|---|
| `keys.env.enc` (AES-256-CBC/PBKDF2-200k) | GITHUB_PAT, OPENROUTER×3 + mgmt, xAI, Cloudflare token+account, R2 endpoint/keys/bucket, רשימות מודלים (18 slots) | **UNSEAL PROVEN** ע"י ה-PAT הנוכחי (wrap registry) |
| `ssh-keys.tar.enc` | `deploy_fleet-vault` — deploy key Tier-1 שלא-פג + ssh shim tool (424 members) | OPEN PROVEN |
| `rails.env.enc` **(חדש, 1e3eb8e)** | HIVE_POSTING_WIF, STEEM_POSTING_WIF, BLURT_ACTIVE_WIF, HIVE_ANCHOR_ACCOUNT, SAOS_RELAY_AGENT_ACCOUNT, SAOS_RELAY_SIGNING_SESSION_UNLOCKED | SEAL+ROUNDTRIP PROVEN (sha 6f09a985698c == דיסק) |
| `vault-chain/recovery-meta.json` | סיסמאות-ארכיון, digests, רוטציות (R245-ROT2), GEN-2 status | נקרא, ללא-חשיפה |
| wraps ×2 | sha256(C)-keyed P transport | נפתחו בהצלחה |

### A2. `agent/keys/fleet_keys.enc` (על-הדיסק, SAOS-FLEET-VAULT-1)
- **13 מפתחות-צי** — UNSEAL PROVEN: `vault.json` (15 חשבונות: cashmachine, haran,
  israelnews, lsa, macrame, siq, tov, wic, wog, woq, ynet, headcorner, hcsoldier4-6
  — steem/hive authorities מלאות), tron mnemonics ×2, wallets-registry (12),
  wallets-seed, key-broker.token, vault.enc (מעטפת-עצמאית, 09-08).
- **GEN-2 verdict (recovery-meta):** headcorner keys dead; army GEN-2 intact.

### A3. מה שלא-נמצא (כנות)
- `KEYS-SEED-2026-10-04.zip.enc` + `KEYS-ZIP-2026-10-08.zip.enc` — מוזכרים
  ב-recovery-meta עם sha256 אך הקבצים הפיזיים לא-אותרו על-הדיסק עדיין (חסר-מיקום).
- מפתחות ETH/SOL ל-anchor rails — לא-נמצאו כרשומות מפתח פעילות (רק soldiers SOL).
- DB `custom.db.VaultKey` ריקה (0 rows); `dex.db` אינה מחזיקה vaultKey.

## B. הארכיטקטורה (מיושמת)

```
sandbox dies → new sandbox → boot agent:
  1. upload/pat.env (או כל credential רשום) → clone fleet-vault
  2. vault_unwrap (wraps → P)                    [proven]
  3. keys.env.enc → .env.local + agent-hq/.env   [proven]
  4. rails.env.enc → saos-dex/.env (600)         [proven]
  5. deploy_fleet-vault (ssh tar) → Tier-1 pull   [proven]
  6. credential-drill → receipt → worklog         [script below]
```
- **Zero-friction onboarding**: סוכן חדש בכל ריפו מקבל גישה דרך credential
  רשום אחד; הרשמה-עצמית מרחיבה את ה-wraps. אין העברות-יד ידניות.
- **GitHub App (צעד-בעלים אחד, חד-פעמי)**: manifest-flow → אוטונומיה מקבלת
  PEM לכספת → installation tokens (1h, renewable) → PAT הופך fallback.
  זה המזהה-המכונתי הלגיטימי המלא (ToS-compliant) ל-7×24.

## C. פערים פתוחים (כנים)
1. אישור-בעלים חד-פעמי ל-GitHub App (קליק אחד) — אופציונלי, מעלה ל-Tier-0.
2. איתור פיזי של KEYS-SEED/KEYS-ZIP (או סימונן כאבודות-רשמית).
3. Hive authorities 0/4 מול live (whale verdict) — מפתחות ביד אך stale בשרשרת;
   נדרש rotation on-chain או הכרזה על חשבונות-חלופיים.
4. הפעלת-מסילות (enable) — חסימת-ערך: תוקף המפתחות מול השרשראות, לא קסטודיה.
