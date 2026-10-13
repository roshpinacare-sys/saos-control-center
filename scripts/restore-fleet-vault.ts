/**
 * restore-fleet-vault.ts — EXEC-CD-45 · שחזור-כספת-הצי-מכספת-האם אל הדיסק
 * ═══════════════════════════════════════════════════════════════════════════
 * דבר-הבעלים (2026-10-08): "יש לך הכל בכספת — קדימה בצע הכל תפעיל הכל".
 * fleet_keys.enc נעלם-מהדיסק (EXEC-CD-22) אבל-המעטפת-המקורית-חיה-בכספת-הריפו
 * (fleet-keys-enc-a + fleet-keys-meta). הסקריפט:
 *   1. פותח-את-כספת-הריפו (AES-256-GCM, שני-שברי-חותם).
 *   2. משחזר: agent/keys/fleet_keys.enc + fleet_keys.meta.json (+ vault.json
 *      לדיסק-אם-ה-member-המוטמע-מצונן — נתיב-ה-fallback-של-fleet.ts).
 *   3. מאמת-פתיחה-חוזרת-בדיוק-כמו-fleet.ts (derived→legacy) — fail-closed.
 *   4. מדפיס: ספירות, שמות-חשבונות, שרשרות, בוליאנים. אפס-חומר-מפתח בפלט.
 * הרצה: bun scripts/restore-fleet-vault.ts [--dry]
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { openRepoVault } from "../src/lib/repo-vault";
import { decodeFleetEnc } from "../src/lib/fleet-keys-decode";

const DRY = process.argv.includes("--dry");
const OUT_DIR = path.resolve(process.cwd(), "agent", "keys");
const MAGIC = "SAOS-FLEET-VAULT-1";

function main(): void {
  const { bundle } = openRepoVault();
  const ab = bundle.absorbed ?? {};
  const encB64 = ab["fleet-keys-enc"] ?? ab["fleet-keys-enc-a"];
  const metaRaw = ab["fleet-keys-meta"];
  if (!encB64 || !metaRaw) { console.error("✖ fleet material missing in envelope"); process.exit(2); }

  let meta: { pass?: string; derived?: string; [k: string]: unknown } = {};
  try { meta = JSON.parse(metaRaw) as typeof meta; } catch { /* legacy pass path still possible via derived */ }

  // פענוח-אימות (בזיכרון) — קודם legacy meta.pass, אחר-כך derived (כמו fleet.ts) · T-64: פענוח-סובלני לשני-הפורמטים
  const payload = (() => { try { return decodeFleetEnc(String(encB64)); } catch (e) { console.error(`✖ sealed blob: ${(e as Error).message}`); process.exit(3); } })();
  const tryPass = (pass: string): string | null => {
    try {
      const key = crypto.scryptSync(pass, payload.subarray(0, 16), 32);
      const d = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
      d.setAuthTag(payload.subarray(28, 44));
      return Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8");
    } catch { return null; }
  };
  let plain: string | null = null; let via = "";
  if (meta.pass) { plain = tryPass(meta.pass); if (plain) via = "legacy-meta-pass"; }
  if (plain === null) {
    const base = process.env.DEX_OPERATOR_TOKEN ?? "";
    if (base) { plain = tryPass(crypto.createHash("sha256").update(`saos-fleet-vault-v2:${base}`).digest("hex")); if (plain) via = "derived-rot3"; }
  }
  if (plain === null) { console.error("✖ decrypt failed (legacy+derived) — לא כתבתי כלום"); process.exit(4); }

  const fleet = JSON.parse(plain) as { sealedAt?: string; count?: number; files?: Record<string, string> };
  const files = fleet.files ?? {};
  console.log(`[restore] ✓ פענוח via=${via} · sealedAt=${fleet.sealedAt ?? "?"} · members=${Object.keys(files).length}`);
  console.log(`[restore]   members: ${Object.keys(files).map(k => `${k}(${files[k].length}b)`).join(", ")}`);

  // האם-keys/vault.json המוטמע-מכיל-חומר-חתימה? (בוליאנים-בלבד)
  const embedded = files["keys/vault.json"];
  let embeddedLive = false; let embeddedNames: string[] = [];
  if (embedded) {
    try {
      const j = JSON.parse(embedded) as { accounts?: Array<Record<string, unknown>>; [k: string]: unknown };
      const accs = Array.isArray(j.accounts) ? j.accounts : [];
      embeddedNames = accs.map(a => String(a["name"] ?? a["account"] ?? a["agent"] ?? "?"));
      embeddedLive = accs.some(a => "wif" in a || "posting" in a || "postingWif" in a || "active" in a);
    } catch { /* labels below */ }
  }
  console.log(`[restore]   embedded vault.json: accounts=${embeddedNames.length} live-signing=${embeddedLive} names=${embeddedNames.join(",") || "-"}`);

  // Fallback-דיסק: vault.json החי מהמעטפת (vault-accounts)
  const diskVault = ab["vault-accounts"];
  let diskLive = false; let diskNames: string[] = [];
  if (diskVault) {
    try {
      const j = JSON.parse(String(diskVault)) as { accounts?: Array<Record<string, unknown>> };
      const accs = Array.isArray(j.accounts) ? j.accounts : [];
      diskNames = accs.map(a => String(a["name"] ?? a["account"] ?? a["agent"] ?? "?"));
      diskLive = accs.some(a => "wif" in a || "posting" in a || "postingWif" in a || "active" in a);
    } catch { /* labels below */ }
  }
  console.log(`[restore]   envelope vault-accounts: accounts=${diskNames.length} live-signing=${diskLive} names=${diskNames.join(",") || "-"}`);

  if (DRY) { console.log("[restore] --dry: לא נכתב דבר לדיסק"); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // T-64: תוכן-הקובץ-המשוחזר = הצורה-הקנונית MAGIC+hex (נגזר-מה-payload-המפוענח — זהה-ביט לשני-פורמטי-המקור)
  const rawFile = `SAOS-FLEET-VAULT-1${payload.toString("hex")}`;
  fs.writeFileSync(path.join(OUT_DIR, "fleet_keys.enc"), rawFile, { mode: 0o600 });
  fs.writeFileSync(path.join(OUT_DIR, "fleet_keys.meta.json"), JSON.stringify(meta, null, 0) + "\n", { mode: 0o600 });
  if (!embeddedLive && diskLive) {
    fs.writeFileSync(path.join(OUT_DIR, "vault.json"), String(diskVault), { mode: 0o600 });
    console.log("[restore]   נכתב vault.json-דיסק (member-מוטמן-מצונן → נתיב-ה-fallback-של-fleet.ts)");
  }
  fs.chmodSync(path.join(OUT_DIR, "fleet_keys.enc"), 0o600);
  fs.chmodSync(path.join(OUT_DIR, "fleet_keys.meta.json"), 0o600);
  console.log(`[restore] ✓ נכתב: ${OUT_DIR}/fleet_keys.enc(${rawFile.length}b) + fleet_keys.meta.json — 0600, gitignored`);
}

main();
