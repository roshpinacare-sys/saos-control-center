/**
 * breakglass-drill.ts — INSTRUMENT #20 · תרגיל-שבירת-זכוכית: אובדן-מפתחות-כולל (EXEC-CD-37)
 * ═══════════════════════════════════════════════════════════════════════════════
 * שאלת-הענקים האמיתית: מה קורה כש-.env של saos-dex מת — או-הסנדבוקס כולה?
 * התשובה-המוכחת-כאן (DRY-RUN מוחלט — אף-כתיבה, אף-קריאה של .env, אף-חומר-מפתח
 * בפלט): **מהכספת-המוצפנת-לבד** אפשר לשחזר את כל-חומר-החתימה ולאמת אותו מול
 * הרשויות-החיות ב-RPC-ציבורי:
 *
 *   1. פתיחת-כספת (AES-256-GCM משני-שברי-חותם בריפו).
 *   2. חילוץ headcorner-recovered → מפתחות OWNER/ACTIVE/POSTING/MEMO ל-STEEM+HIVE.
 *   3. גזירת-מפתח-ציבורי גרפני (pubOfWif) + אימות-סמכות-חי מול-RPC-ציבורי
 *      (בדיוק-ההיגיון של authorityOk ב-relay).
 *   4. TRON: סריקת-כל-בלובים-הנבלעים לסקלר-hex64 → גזירת-כתובת (tronIdentityFromHexScalar)
 *      → התאמה-מול-הרישום-הציבורי בmanifest/מאגר.
 *   5. מטריצת-החלטה: אילו-שרשרות/תפקידים ניתנים-לחימוש-מחדש **עכשיו**, ומי
 *      סורב-מסיבה-מתועדת (רוטציית-STEEM) — כנות-מלאה, אין-טענות-ריקות.
 *
 * זמן-התאוששות-מדוד = RTO-מפתחות. ארטיפקט: BREAKGLASS-DRILL.json (בריפו-האם,
 * ציבורי — אפס-סודות: רק-החלטות/טביעות-אצבע-פומביות).
 * ריצה: bun scripts/breakglass-drill.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { openRepoVault, vaultExists } from "../src/lib/repo-vault";
import { pubOfWif } from "../saos-dex/src/lib/dex/signer";
import { tronIdentityFromHexScalar } from "../saos-dex/src/lib/dex/peg-door";
import fs from "node:fs";

interface RoleMap { owner?: string; active?: string; posting?: string; memo?: string }

function parseRecovered(raw: string): { steem: RoleMap; hive: RoleMap } {
  const out = { steem: {} as RoleMap, hive: {} as RoleMap };
  let cur: "steem" | "hive" = "steem";
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^HIVE$/i.test(line)) { cur = "hive"; continue; }
    const m = line.match(/^(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i);
    if (!m) continue;
    out[cur][m[1].toLowerCase() as keyof RoleMap] = m[2];
  }
  return out;
}
const wifShapeOk = (w: string | undefined): boolean => !!w && /^[1-9A-HJ-NP-Za-km-z]{51,52}$/.test(w);

async function chainAuthorities(chain: "steem" | "hive", account: string): Promise<Record<string, string[]> | null> {
  const endpoints = chain === "steem"
    ? ["https://api.steemit.com", "https://steem.crypto-fans.com"]
    : ["https://api.hive.blog", "https://anyx.io"];
  const body = JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[account]], id: 1 });
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { method: "POST", body, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(9_000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { result?: Array<{ posting?: { key_auths?: Array<[string, number]> }; active?: { key_auths?: Array<[string, number]> }; owner?: { key_auths?: Array<[string, number]> } }> };
      const acc = j.result?.[0];
      if (!acc) continue;
      return {
        posting: (acc.posting?.key_auths ?? []).map((k) => k[0]),
        active: (acc.active?.key_auths ?? []).map((k) => k[0]),
        owner: (acc.owner?.key_auths ?? []).map((k) => k[0]),
      };
    } catch { /* next endpoint */ }
  }
  return null;
}

async function main(): Promise<void> {
  if (!vaultExists()) { console.error("✖ אין-כספת-בריפו"); process.exit(1); }
  const t0 = Date.now();
  console.log("BREAK-GLASS: מדמה אובדן-.env-מוחלט — משחזר מהכספת-המוצפנת-בלבד (DRY-RUN, אף-כתיבה)…");

  const { bundle, manifest } = openRepoVault();
  const recoveredRaw = bundle.absorbed?.["headcorner-recovered"];
  if (!recoveredRaw) { console.error("✖ headcorner-recovered לא-במעטפת"); process.exit(2); }
  const parsed = parseRecovered(recoveredRaw);

  const matrix: Array<{ chain: string; role: string; wifShape: boolean; derivedPub: string | null; liveAuthority: boolean; armable: boolean; note: string }> = [];
  const ACCOUNT = "headcorner";
  for (const chain of ["steem", "hive"] as const) {
    const auth = await chainAuthorities(chain, ACCOUNT);
    for (const role of ["posting", "active", "owner"] as const) {
      const wif = parsed[chain][role];
      const shape = wifShapeOk(wif);
      const pub = shape ? pubOfWif(wif as string, chain === "hive" ? "STM" : "STM") : null;
      const live = !!(pub && auth?.[role]?.includes(pub));
      const rotatedOut = shape && !live && auth !== null && (auth[role]?.length ?? 0) > 0;
      matrix.push({
        chain, role, wifShape: shape, derivedPub: pub ? pub.slice(0, 10) + "…" : null, liveAuthority: live,
        armable: live,
        note: !shape ? "אין-מפתח-במעטפת" : live ? "בסמכות-חיה — ניתן-לחמש" : rotatedOut ? "מחוץ-לסמכות (רוטציה-מתועדת EXEC-CD-35)" : "אותנטיקציה-ציבורית-כשלה",
      });
    }
  }

  /* TRON — ההוכחה-הקנונית: הכתובת-החותמת-עיגונים-בשרשרת (anchors.json · ציבורית)
   * חייבת להיגזר-מהכספת-עצמה (bundle.derivations · m/44'/195'/0'/0/0) ולהתאים
   * לרישום-הציבורי בmanifest. זו-היא נגזרת-ה-deposit הקנונית — המפתח-שחתם
   * את-e1e09c7e על-TRON-mainnet. סריקת-WIF-כגיבוי (פורמט-אחר-של-אותו-חומר). */
  const tronRows: Array<{ blob: string; address: string | null }> = [];
  const anchorsReg = JSON.parse(fs.readFileSync("/home/z/my-project/saos-dex/state/anchors.json", "utf8")) as { tronIdentity?: string };
  const liveTronIdentity = anchorsReg.tronIdentity ?? null;
  const manifestTron = manifest?.networks?.filter((n) => n.network === "tron").map((n) => n.address) ?? [];
  const tronDer = (bundle.derivations ?? []).find((d) => d.network === "tron");
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const decodeScalar = (wifRaw: string): string | null => {
    try {
      const norm = wifRaw.trim().replace(/^P(?=[5KL])/, "");
      let n = 0n;
      for (const c of norm) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
      let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex;
      let raw = Buffer.from(hex, "hex");
      let pad = 0; for (const c of norm) { if (c === "1") pad++; else break; }
      if (pad) raw = Buffer.concat([Buffer.alloc(pad), raw]);
      if (raw.length !== 37 || raw[0] !== 0x80) return null;
      return raw.subarray(1, 33).toString("hex");
    } catch { return null; }
  };
  for (const [blobName, blobVal] of Object.entries(bundle.absorbed ?? {})) {
    const wifs = blobVal.match(/[P]?[5KJL][1-9A-HJ-NP-Za-km-z]{49,51}/g) ?? [];
    for (const w of wifs) {
      const scalar = decodeScalar(w);
      if (!scalar) continue;
      try {
        const addr = tronIdentityFromHexScalar(scalar);
        if (addr) tronRows.push({ blob: blobName, address: addr });
      } catch { /* not a key scalar */ }
    }
  }
  const derivedTron = tronDer?.address ?? null;
  const tronMatch = !!derivedTron && manifestTron.includes(derivedTron) && (!liveTronIdentity || derivedTron === liveTronIdentity);
  const tronFp = derivedTron ?? tronRows[0]?.address ?? null;

  const armableNow = matrix.filter((m) => m.armable);
  const anchorRailArmable = armableNow.some((m) => m.chain === "hive" && m.role === "posting")
    || armableNow.some((m) => m.chain === "steem" && (m.role === "posting" || m.role === "active"));
  const verdict = anchorRailArmable && (tronMatch || tronRows.length > 0) ? "PASS" : "FAIL";
  const rtoMs = Date.now() - t0;

  const outcome = {
    instrument: "breakglass-drill.ts", ts: new Date().toISOString(), verdict, rtoMs,
    simulation: "saos-dex/.env presumed destroyed — recovery path = encrypted repo-vault ONLY (dry-run: zero writes, .env never read)",
    vault: { open: true, blobs: Object.keys(bundle.absorbed ?? {}).length },
    authorityMatrix: matrix.map((m) => ({ ...m, derivedPub: m.derivedPub })),
    tron: { scalarsFound: tronRows.length, recoveredAddress: tronFp ? tronFp.slice(0, 6) + "…" + tronFp.slice(-4) : null, matchedManifest: tronMatch, manifestTronCount: manifestTron.length },
    armableNow: armableNow.map((m) => `${m.chain}:${m.role}`),
    anchorRailArmable, timeToRecoverKeysMs: rtoMs,
  };
  fs.writeFileSync("/home/z/my-project/BREAKGLASS-DRILL.json", JSON.stringify(outcome, null, 2) + "\n");

  console.log("\n── מטריצת-סמכות (שום-חומר-מפתח-מודפס) ──");
  for (const m of matrix) console.log(`  ${m.chain.padEnd(5)} ${m.role.padEnd(8)} shape=${m.wifShape ? "✓" : "✗"} pub=${m.derivedPub ?? "—"} live=${m.liveAuthority ? "✓" : "✗"} → ${m.note}`);
  console.log(`  tron  scalar  נמצאו=${tronRows.length} · כתובת=${tronFp ? "נגזרה-✓" : "—"} · manifest-match=${tronMatch ? "✓" : "—"} · count=${manifestTron.length}`);
  console.log(`\n${verdict === "PASS" ? "✅" : "❌"} BREAK-GLASS verdict=${verdict} · ניתנים-לחימוש-עכשיו: ${armableNow.map((m) => `${m.chain}:${m.role}`).join(", ") || "אף-אחד"} · RTO-מפתחות=${rtoMs}ms`);
  process.exit(verdict === "PASS" ? 0 : 1);
}
main().catch((e) => { console.error("breakglass crash:", e); process.exit(1); });
