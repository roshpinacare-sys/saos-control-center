// ═══ github-vault-sweep — סריקת-כל-כספות-הגיט של-הארגון (EXEC-CD-46) ═══════════
// דבר-הבעלים: "בחן את כל הכספות של כל הגיט גם של כולם — תאסוף את כל המידע
// ושיהיה מחובר תמיד לאוטונומיה בלי נפילות בלי תלות בסנדבוקס".
//
// מה-הוא-עושה:
//  1. מקבל-טוקן (upload/pat.env או SAOS_GITHUB_TOKEN) — לעולם-לא-מדפיס-אותו.
//  2. מפרט-את-כל-הריפו הנגישים (owner+collaborator+org-member).
//  3. משכפל-כל-ריפו ל-SWEEP_DIR (מלא-אם-קטן<30MB, shallow-אם-גדול).
//  4. סורק-עץ-עבודה-לחומר-מפתחות: WIF51/הקס64/EVM/SOL/mnemonic/PEM/ghp_token/
//     SAOS-FLEET-VAULT-1 — מדפיס **רק** נתיב+סוג+טביעת-אצבע(sha256[:12])+אורך.
//  5. כותב summary JSON (נתיבים+טביעות-בלבד) ל-SWEEP_DIR/summary.json.
//
// חוזה-אמת: ערך-סוד לא יודפס, לא ייכתב ללוג, לא ייצא לרשת. טביעת-אצבע בלבד.
//
// הרצה: bun scripts/github-vault-sweep.ts [--repos name1,name2] [--shallow]
import fs from "fs";
import path from "path";
import crypto from "crypto";

const SWEEP_DIR = "/tmp/vault-sweep";
const MAX_FILE = 2 * 1024 * 1024; // 2MB cap per file
const BIG_REPO = 30 * 1024 * 1024; // 30MB → shallow clone

const args = process.argv.slice(2);
function argOf(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const onlyRepos = argOf("--repos")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const forceShallow = args.includes("--shallow");

function readToken(): string {
  if (process.env.SAOS_GITHUB_TOKEN) return process.env.SAOS_GITHUB_TOKEN.trim();
  const p = path.resolve(process.cwd(), "upload", "pat.env");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim().split(/\r?\n/)[0].trim();
  console.error("✖ אין-טוקן: upload/pat.env או SAOS_GITHUB_TOKEN");
  process.exit(2);
}

function fp(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

type Hit = { repo: string; file: string; kind: string; fingerprint: string; length: number; preview: string };

const WIF = /\b5[KJH][1-9A-HJ-NP-Za-km-z]{49}\b/g;
const HEX64 = /\b[0-9a-fA-F]{64}\b/g;
const EVM = /\b0x[0-9a-fA-F]{64}\b/g;
const SOL = /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g;
const GHTOK = /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const FLEET_MAGIC = /SAOS-FLEET-VAULT-1/g;
const MNEMO = /^\s*(?:[a-z]{3,8}\s+){11}[a-z]{3,8}\s*$/gm;

function scanText(repo: string, file: string, txt: string, hits: Hit[]): void {
  const push = (kind: string, m: string) =>
    hits.push({ repo, file, kind, fingerprint: fp(m), length: m.length, preview: kind });
  for (const m of txt.matchAll(WIF)) push("wif51-steem/hive/blurt", m[0]);
  for (const m of txt.matchAll(EVM)) push("evm-priv", m[0]);
  for (const m of txt.matchAll(GHTOK)) push("github-token", m[0]);
  for (const m of txt.matchAll(PEM)) push("pem-key", m[0]);
  for (const m of txt.matchAll(FLEET_MAGIC)) push("fleet-vault-magic", m[0]);
  // hex64: רק-אם-הקשר-מרמז (צלילות-גבוהה-אחרת) — בודק-מילת-הקשר בקרבת ההתאמה
  const lower = txt.toLowerCase();
  if (/tron|priv|wallet|key|seed/.test(lower)) {
    for (const m of txt.matchAll(HEX64)) {
      const i = m.index ?? 0;
      const ctx = lower.slice(Math.max(0, i - 80), i + 80);
      if (/tron|priv|wallet|key|seed/.test(ctx)) push("hex64-priv-candidate", m[0]);
    }
  }
  // sol: מסנן-false-positive של-hex64 (sol הוא-base58, לא-מכיל 0)
  for (const m of txt.matchAll(SOL)) if (!/^[0-9a-fA-F]+$/.test(m[0])) push("sol-priv-candidate", m[0]);
  const lines = txt.split(/\r?\n/);
  for (const ln of lines) {
    const w = ln.trim().split(/\s+/);
    if ((w.length === 12 || w.length === 24) && w.every(x => /^[a-z]{3,8}$/.test(x))) push(`mnemonic-${w.length}`, ln.trim());
  }
}

const SENSITIVE_NAME = /(key|wallet|vault|seed|mnemonic|secret|priv|keystore|credential)/i;

function walk(repo: string, dir: string, rel: string, hits: Hit[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "dist") continue;
    const fp2 = path.join(dir, e.name);
    const rel2 = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(repo, fp2, rel2, hits); continue; }
    if (!e.isFile()) continue;
    let st: fs.Stats;
    try { st = fs.statSync(fp2); } catch { continue; }
    if (st.size > MAX_FILE) {
      if (SENSITIVE_NAME.test(e.name)) hits.push({ repo, file: rel2, kind: "BIG-SENSITIVE-FILE(manual-review)", fingerprint: "-", length: st.size, preview: "BIG-SENSITIVE-FILE" });
      continue;
    }
    let txt: string;
    try { txt = fs.readFileSync(fp2, "utf8"); } catch { continue; }
    // זיהוי-בינארי גס: אם-יש-NUL — דלג
    if (txt.includes("\u0000")) continue;
    if (SENSITIVE_NAME.test(e.name) || /wif|ghp_|BEGIN .*PRIVATE|SAOS-FLEET-VAULT/.test(txt)) scanText(repo, rel2, txt, hits);
  }
}

async function sh(cmd: string, cwd?: string): Promise<{ ok: boolean; out: string }> {
  const p = Bun.spawn(["bash", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  return { ok: code === 0, out: out + (code === 0 ? "" : ` | err: ${err}`.slice(0, 300)) };
}

async function gh(pathname: string): Promise<unknown> {
  const token = readToken();
  const r = await fetch(`https://api.github.com${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "saos-vault-sweep" },
  });
  if (!r.ok) return { __err: r.status, body: (await r.text()).slice(0, 200) };
  return r.json();
}

async function main(): Promise<void> {
  fs.mkdirSync(SWEEP_DIR, { recursive: true });
  console.log(`[sweep] dir=${SWEEP_DIR}`);
  const repos = (await gh("/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=pushed")) as Array<{
    full_name: string; private: boolean; size: number; default_branch: string;
  }>;
  if (!Array.isArray(repos)) { console.error("✖ רשימת-ריפו נכשלה:", JSON.stringify(repos).slice(0, 200)); process.exit(3); }
  console.log(`[sweep] repos=${repos.length}`);
  const hits: Hit[] = [];
  for (const r of repos) {
    const name = r.full_name.split("/")[1];
    if (onlyRepos && !onlyRepos.includes(name)) continue;
    const dest = path.join(SWEEP_DIR, name);
    if (!fs.existsSync(path.join(dest, ".git"))) {
      const mode = forceShallow || r.size * 1024 > BIG_REPO ? "--depth 1" : "";
      const token = readToken();
      const url = `https://x-access-token:${token}@github.com/${r.full_name}.git`;
      const res = await sh(`git clone -q ${mode} "${url}" "${dest}" 2>&1 | tail -2`);
      if (!res.ok && !fs.existsSync(dest)) { console.log(`[sweep] ✖ clone ${name}: ${res.out.slice(0, 120)}`); continue; }
    }
    console.log(`[sweep] ▶ ${name} (${r.private ? "priv" : "pub"}, ${(r.size / 1024).toFixed(1)}MB)`);
    walk(name, dest, "", hits);
    // סריקת-היסטוריה: קבצים-שנמחקו-שהיו-רגישים (עומק-מרוסן: 300-קומיטים-אחרונים)
    const hist = await sh(`git -C "${dest}" log --all --diff-filter=D --name-only --pretty=format: -n 300 2>/dev/null | sort -u | grep -iE '(key|wallet|vault|seed|mnemonic|secret|priv)' | head -20`);
    if (hist.out.trim()) {
      for (const f of hist.out.trim().split("\n").filter(Boolean)) {
        const content = await sh(`git -C "${dest}" show "$(git -C "${dest}" rev-list --all -1 -- "${f}")":"${f}" 2>/dev/null | head -c ${MAX_FILE}`);
        if (content.ok && content.out) scanText(`${name}::history`, f, content.out, hits);
      }
    }
  }
  // דה-דופ לפי repo+file+kind+fingerprint
  const seen = new Set<string>();
  const uniq = hits.filter(h => { const k = `${h.repo}|${h.file}|${h.kind}|${h.fingerprint}`; if (seen.has(k)) return false; seen.add(k); return true; });
  console.log(`\n[sweep] ═══ תוצאות: ${uniq.length} איתורים (טביעות-בלבד) ═══`);
  for (const h of uniq) console.log(`  ${h.repo.padEnd(22)} ${h.file.padEnd(60)} ${h.kind.padEnd(28)} ${h.fingerprint} len=${h.length}`);
  fs.writeFileSync(path.join(SWEEP_DIR, "summary.json"), JSON.stringify({ at: new Date().toISOString(), repos: repos.length, findings: uniq }, null, 2));
  console.log(`[sweep] summary → ${SWEEP_DIR}/summary.json`);
}

await main();
