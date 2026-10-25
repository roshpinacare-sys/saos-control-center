/**
 * blurt-army.ts — BLURT ARMY · "הסיסמאות של Steemit 2018 הן המפתחות של Blurt"
 * ═══════════════════════════════════════════════════════════════════════════════
 * דבר-הבעלים (2026-10-08): Blurt הוא fork-גרפני של Steem — גזירת-המפתחות מסיסמת-
 * אב זהה (sha256d(account+role+password)) והחשבונות ירשו-סמכויות-בזמן-הfork.
 * כל-מה-שחתום-בכספת כ"מפתח-סטימיט" הוא-בהכרח גם-מועמד-Blurt — **מאמתים מול-השרשרת
 * ולא מנחשים**. אפס-תלונות "אין-מפתח": המטריצה היא הוכחה-חיה, והחותמות-המאומתות
 * נאטמות לכספת-הצי (keys/blurt.json) + מוספגות למעטפת-המאם (repo-vault, בגיט).
 *
 * חוזה-סודות: אף-WIF/סיסמה לא יוצאים מהמודול. פלט-ציבורי = שמות-חשבון + תוויות-
 * פאב-קיומיות + תוצאות-התאמה. fail-closed: מפתח-שלא-מאמת-עצמי (WIF→pub) לא
 * נאטם; מפתח-שלא-מאומת-מול-השרשרת נאטם עם verified=false רק-אם נדרש — ברירת-
 * מחדל: נאטמים רק-מאומתים (המנוע לא אמור לנסות מפתחות-מתים).
 *
 * קנוניה-גרפנית: label = prefix ‖ base58check(compressed33) כאשר
 * checksum = ripemd160(sha256(data))[0:4]; WIF = base58check(0x80 ‖ scalar).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1";

export const MAGIC = "SAOS-FLEET-VAULT-1";
export const FLEET_DIR = process.env.SAOS_FLEET_VAULT_DIR || path.resolve(process.cwd(), "agent", "keys");

/* ── מתמטיקה-קנונית ─────────────────────────────────────────────────────────── */
export function wifToScalar(wif: string): Buffer | null {
  try {
    const raw = bs58.decode(wif.trim());
    const data = raw.subarray(0, raw.length - 4);
    const cs = raw.subarray(raw.length - 4);
    // WIF-ביטקויני-קנוני: checksum = sha256(sha256(data))[0:4] (אומת-חי-מול-הכספת)
    const s1 = crypto.createHash("sha256").update(data).digest();
    const s2 = crypto.createHash("sha256").update(s1).digest();
    if (!s2.subarray(0, 4).equals(cs)) return null;
    if (data[0] !== 0x80) return null;
    return Buffer.from(data.subarray(1, 33));
  } catch { return null; }
}

export function scalarToCompressed(scalar: Buffer): Buffer {
  return Buffer.from(secp256k1.getPublicKey(new Uint8Array(scalar), true));
}

function grapheneChecksum(data: Buffer): Buffer {
  // קנוניה-גרפנית (אומת-מול-steem-js חי): checksum = ripemd160(גוף-המפתח)[0:4]
  return crypto.createHash("ripemd160").update(data).digest().subarray(0, 4);
}

/** תווית-פאב-גרפנית קנונית (STM ל-Steem/Hive · BLT ל-Blurt) */
export function grapheneLabel(scalar: Buffer, prefix: "STM" | "BLT"): string {
  const body = scalarToCompressed(scalar);
  const full = Buffer.concat([body, grapheneChecksum(body)]);
  return prefix + bs58.encode(new Uint8Array(full));
}

/** מפתח-פאב-המצוי-בכספת (STM/BLT) → 33 בייטים — להשוואת-ביט-מול-ביט */
function labelToCompressed(label: string): Buffer | null {
  try {
    const body = label.replace(/^(STM|BLT|BTM|TST)/, "");
    const raw = Buffer.from(bs58.decode(body));
    const data = raw.subarray(0, raw.length - 4);
    if (!grapheneChecksum(data).equals(raw.subarray(raw.length - 4))) return null;
    return Buffer.from(data.subarray(data.length - 33));
  } catch { return null; }
}

/** self-verify: ה-WIF בכספת גוזר-בדיוק את ה-pub שלצידו (ללא-שרשרת) */
export function selfVerify(wif: string, pub: string): boolean {
  const scalar = wifToScalar(wif);
  if (!scalar) return false;
  const stored = labelToCompressed(pub);
  if (!stored) return false;
  return scalarToCompressed(scalar).equals(stored);
}

/* ── פתיחת-כספת-הצי ─────────────────────────────────────────────────────────── */
export interface RoleKey { wif: string; pub: string }
export interface FleetAccount { username: string; keys: Record<string, unknown>; tier?: string; chains?: string[] }
export interface FleetFiles { files: Record<string, string>; sealedAt: string }

export function openFleetFiles(): FleetFiles {
  const raw = fs.readFileSync(path.join(FLEET_DIR, "fleet_keys.enc"), "utf8");
  const meta = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, "fleet_keys.meta.json"), "utf8")) as { pass?: string };
  if (!raw.startsWith(MAGIC)) throw new Error("fleet vault: unknown seal format");
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  // FIX(fleet-open-dual-pass): scripts/restore-fleet-vault.ts פותח את אותו-מאגר
  // בשתי-דרכים (legacy meta.pass · derived sha256("saos-fleet-vault-v2:"+DEX_OPERATOR_TOKEN))
  // אך הקורא-הראשי-הזה ידע רק-את-הראשונה — מטא-שנשמר-בלי pass (דרך-derived בלבד) היה
  // נזרק "meta pass missing (fail-closed)" למרות-שהחומר-פתיח, וכל-צרכני-הכספת
  // (blurt-army/connect-all/authority-guard) היו קורסים על-אותו-קובץ שהמשחזר דווקא
  // פתח. עתה: בדיוק-שתי-הדרכים של-המשחזר, באותו-סדר (legacy קודם), fail-closed
  // כששתיהן-נכשלות. אפס-חומר-סוד בפלט/בשגיאה.
  const tryPass = (pass: string): string | null => {
    try {
      const key = crypto.scryptSync(pass, payload.subarray(0, 16), 32);
      const d = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
      d.setAuthTag(payload.subarray(28, 44));
      return Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8");
    } catch { return null; }
  };
  let plain: string | null = null;
  if (meta.pass) plain = tryPass(meta.pass);
  if (plain === null) {
    const base = process.env.DEX_OPERATOR_TOKEN ?? "";
    if (base) plain = tryPass(crypto.createHash("sha256").update(`saos-fleet-vault-v2:${base}`).digest("hex"));
  }
  if (plain === null) throw new Error("fleet vault: decrypt failed (legacy meta.pass + derived DEX_OPERATOR_TOKEN both rejected) — fail-closed");
  const bundle = JSON.parse(plain) as { sealedAt?: string; files: Record<string, string> };
  return { files: bundle.files, sealedAt: bundle.sealedAt ?? "" };
}

/** חותמות-המועמדות לחשבון: מה-הסט-הרלוונטי לשרשרת (steem/hive/blurt/fallback-מאוחד) */
/** זיהוי-צורה: {wif,pub} ישיר = RoleKey · {role:{wif,pub}} = סט-תפקידים */
function isRoleKey(v: unknown): v is RoleKey {
  return !!v && typeof v === "object" && typeof (v as any).wif === "string" && typeof (v as any).pub === "string";
}
function isRoleSet(v: unknown): v is Record<string, RoleKey> {
  return !!v && typeof v === "object" && Object.values(v as object).every(isRoleKey);
}

/**
 * החותמות-המועמדות לשרשרת נתונה — מנרמל שתי-צורות-כספת:
 *  · צורה-ישירה (14 חשבונות): keys={posting:{wif,pub},active:…,owner:…,memo:…} → סט-אחד-מאוחד
 *  · צורה-קינונה (headcorner): keys={steem:{owner:…},hive:{owner:…}} → סט-לשרשרת
 */
export function candidateSets(acc: FleetAccount, chain: GrapheneChain): Array<[string, Record<string, RoleKey>]> {
  const keys = acc.keys ?? {};
  const named: Record<string, Record<string, RoleKey>> = {};
  const direct: Record<string, RoleKey> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (isRoleSet(v)) named[k] = v;
    else if (isRoleKey(v)) direct[k] = v;
  }
  const out: Array<[string, Record<string, RoleKey>]> = [];
  if (named[chain]) out.push([chain, named[chain]]);
  if (acc.username === "headcorner") {
    // headcorner מחזיק סטים-נפרדים לשרשראות — ל-BLURT בודקים שניהם (הרישום-קובע)
    for (const [k, v] of Object.entries(named)) if (k !== chain && (k === "steem" || k === "hive")) out.push([k, v]);
  } else if (Object.keys(direct).length > 0) {
    out.push(["unified", direct]);
  }
  return out;
}

/* ── שרשראות-גרפנה (קריאה-ציבורית בלבד) ─────────────────────────────────────── */
export type GrapheneChain = "steem" | "hive" | "blurt";
export const CHAIN_NODES: Record<GrapheneChain, string> = {
  steem: "https://api.steemit.com",
  hive: "https://api.hive.blog",
  blurt: "https://rpc.blurt.blog", // Roast-74: blurt.world אבד (NXDOMAIN) — הצומת-החי
};
export const CHAIN_PREFIX: Record<GrapheneChain, "STM" | "BLT"> = { steem: "STM", hive: "STM", blurt: "BLT" };

export interface ChainAuths { owner: string | null; active: string | null; posting: string | null; memo: string | null }

async function rpc<T>(url: string, method: string, params: unknown, timeoutMs = 15000): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: ctl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } finally { clearTimeout(t); }
  } catch { return null; }
}

export async function fetchAuthorities(chain: GrapheneChain, names: string[]): Promise<Record<string, ChainAuths>> {
  const r = await rpc<{ result?: any[] }>(CHAIN_NODES[chain], "condenser_api.get_accounts", [names]);
  const out: Record<string, ChainAuths> = {};
  for (const a of r?.result ?? []) {
    out[String(a.name)] = {
      owner: a.owner?.key_auths?.[0]?.[0] ?? null,
      active: a.active?.key_auths?.[0]?.[0] ?? null,
      posting: a.posting?.key_auths?.[0]?.[0] ?? null,
      memo: a.memo_key ?? null,
    };
  }
  return out;
}

/* ── המטריצה: 15 חשבונות × כל-השרשראות × כל-התפקידים ───────────────────────── */
export type Role = "owner" | "active" | "posting" | "memo";
export const ROLES: Role[] = ["owner", "active", "posting", "memo"];

export interface RoleResult { selfOk: boolean; onChain: boolean }
export interface AccountChainResult {
  sourceSet: string;                 // איזה סט-מפתחות-בכספת שימש (posting=הסט-המאוחד, steem/hive)
  roles: Partial<Record<Role, RoleResult>>;
  pubLabels: Partial<Record<Role, string>>; // תוויות-פאב-ציבוריות (מהכספת, קיום-ראיה)
  verifiedCount: number;
}
export interface AccountResult {
  username: string;
  chains: Partial<Record<GrapheneChain, AccountChainResult | "no-keys" | "not-on-chain">>;
  totalVerified: number;
}

export async function buildMatrix(files: Record<string, string>): Promise<{ matrix: AccountResult[]; chainPresent: Record<GrapheneChain, number> }> {
  const v = JSON.parse(files["keys/vault.json"]) as { accounts: FleetAccount[] };
  const names = v.accounts.map((a) => a.username);
  const chains: GrapheneChain[] = ["steem", "hive", "blurt"];
  const auths: Record<GrapheneChain, Record<string, ChainAuths>> = { steem: {}, hive: {}, blurt: {} };
  for (const c of chains) auths[c] = await fetchAuthorities(c, names);

  const matrix: AccountResult[] = [];
  const chainPresent: Record<GrapheneChain, number> = { steem: 0, hive: 0, blurt: 0 };
  for (const acc of v.accounts) {
    const res: AccountResult = { username: acc.username, chains: {}, totalVerified: 0 };
    for (const chain of chains) {
      const auth = auths[chain][acc.username];
      if (!auth) { res.chains[chain] = "not-on-chain"; continue; }
      chainPresent[chain] += 1;
      const sets = candidateSets(acc, chain);
      if (sets.length === 0) { res.chains[chain] = "no-keys"; continue; }
      // סט-שזוכה: הסט-עם-התאמות-הרבות-ביותר (כנה — רושם-מה-נוסה)
      let best: { name: string; r: AccountChainResult } | null = null;
      for (const [setName, set] of sets) {
        const r: AccountChainResult = { sourceSet: setName, roles: {}, pubLabels: {}, verifiedCount: 0 };
        for (const role of ROLES) {
          const rk = set[role];
          if (!rk?.wif) continue;
          const scalar = wifToScalar(rk.wif);
          const selfOk = !!scalar && selfVerify(rk.wif, rk.pub);
          const label = scalar ? grapheneLabel(scalar, CHAIN_PREFIX[chain]) : "";
          const onChain = selfOk && !!auth[role] && auth[role] === label;
          r.roles[role] = { selfOk, onChain };
          if (label) r.pubLabels[role] = label;
          if (onChain) r.verifiedCount += 1;
        }
        if (!best || r.verifiedCount > best.r.verifiedCount) best = { name: setName, r };
      }
      if (best) {
        res.chains[chain] = best.r;
        res.totalVerified += best.r.verifiedCount;
      } else res.chains[chain] = "no-keys";
    }
    matrix.push(res);
  }
  return { matrix, chainPresent };
}

/**
 * איטום-מחדש באותו-פורמט-אנבלופ (layout קנוני: [0:16]=salt · [16:28]=iv · [28:44]=tag · [44:]=ct;
 * key = scrypt(pass, salt16, 32) — בדיוק-כמו-הקורא). pass ללא-שינוי — אפס-רגרסיית-זמינות.
 */
export function resealFleetFiles(files: Record<string, string>, sealedAt: string): void {
  const meta = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, "fleet_keys.meta.json"), "utf8")) as { pass: string };
  const bundle = JSON.stringify({ sealedAt, files });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(meta.pass, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(bundle, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, tag, ct]);
  const sealed = MAGIC + payload.toString("hex");
  const tmp1 = path.join(FLEET_DIR, ".fleet_keys.enc.tmp");
  fs.writeFileSync(tmp1, sealed, { mode: 0o600 });
  fs.renameSync(tmp1, path.join(FLEET_DIR, "fleet_keys.enc"));
  fs.chmodSync(path.join(FLEET_DIR, "fleet_keys.enc"), 0o600);
}

/**
 * בניית keys/blurt.json מהמטריצה — **עם חותמות אמת** (WIF-המקור מהסט-הזוכה):
 * נאטמים רק-תפקידים שעברו self-verify והתאמה-מול-השרשרת (onChain=true).
 * כושל-עצמי = לא-נאטם-כלל (fail-closed — המנוע לעולם לא ינסה מפתח-מת).
 */
export function sealBlurtArmy(files: Record<string, string>, matrix: AccountResult[]): { member: string; accounts: number; roles: number } {
  const v = JSON.parse(files["keys/vault.json"]) as { accounts: FleetAccount[] };
  const byName = new Map(v.accounts.map((a) => [a.username, a]));
  const army: Array<{ username: string; sourceSet: string; verifiedAt: string; keys: Record<string, RoleKey> }> = [];
  let roles = 0;
  for (const res of matrix) {
    const c = res.chains.blurt;
    if (!c || c === "no-keys" || c === "not-on-chain") continue;
    const acc = byName.get(res.username);
    if (!acc) continue;
    const sets = candidateSets(acc, "blurt");
    const set = sets.find(([k]) => k === c.sourceSet);
    if (!set) continue;
    const keys: Record<string, RoleKey> = {};
    for (const role of ROLES) {
      const rr = c.roles[role];
      if (rr?.selfOk && rr.onChain && set[1][role]?.wif) {
        keys[role] = set[1][role];
        roles += 1;
      }
    }
    if (Object.keys(keys).length > 0) {
      army.push({ username: res.username, sourceSet: c.sourceSet, verifiedAt: new Date().toISOString(), keys });
    }
  }
  files["keys/blurt.json"] = JSON.stringify({ note: "BLURT ARMY — verified-against-chain (rpc.blurt.blog) · derived from the same 2018 steemit key material (graphene fork) · fail-closed: self-verified+chain-matched roles only", sealedAt: new Date().toISOString(), accounts: army });
  return { member: "keys/blurt.json", accounts: army.length, roles };
}
