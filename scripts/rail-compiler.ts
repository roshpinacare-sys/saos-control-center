/**
 * rail-compiler.ts — T-38 · מהדר-מסילות-התוכן · "הספרים-כותבים-מהנדדים-בלבד" ═════
 * מקור: מנדט-הזרקה החוזר ("high-velocity compilation of content tracks") — מימוש
 *     **נטיבי-TS** (content_rail.ts מהזרקה = בדוי-בדיסק). זהו-הפער-האמיתי:
 *     המסילות scaffolded-וריקות מאז-T-37 — מהדר-זה ממלא-אותן **מדידות-בלבד**.
 *
 * מה: קריאת-הקבלות-החיות (rpc-mesh · bandwidth-degradation · revenue-router ·
 *     post-batcher/books-lineage) → טיוטת-digest-אחת-ליום-לכל-מסילה (technical /
 *     financial / architectural) — מספרים-מדודים-בלבד, ללא-פרוזה-מפוברקת.
 * איך: front-matter-מלא לפי docs/payload-canon.md §4 (booksRoot = ראש-השרשרת)
 *     · סריקת-דליפות **fail-closed** על-כל-פריט (נתיב+base58) לפני-כתיבה ·
 *     כתיבה-מזהה-ליום (אותו-קובץ נדרס — אפס-ספאם) · status=STAGED (פרסום=owner-gate).
 * גבולות: **סטאג'ינג-בלבד — אפס-פרסום/שידור** · אפס-סודות · אפס-תוכן-מפוברק —
 *     אין-קבלה-מקור→פריט-לא-נכתב.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const BOOKS_LINEAGE = path.join(ROOT, "receipts", "books-lineage.json");
const OUT_RECEIPT = path.join(ROOT, "receipts", "rail-compiler-latest.json");
const RAILS = ["technical", "financial", "architectural"] as const;
type Rail = (typeof RAILS)[number];

const readJson = <T>(p: string): T | null => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return null; }
};

/* ── סריקת-דליפות fail-closed: אף-פריט-מזוהם לא-נכתב ── */
function leakScan(s: string): boolean {
  return /\/home\/z/.test(s) || /[5KJHL][1-9A-HJ-NP-Za-km-z]{50,51}/.test(s);
}

interface MeshReceipt { at?: string; ranked?: Record<string, Array<{ node: string; ok: boolean; latencyMs: number; successRate: number | null }>> }
interface DegReceipt { at?: string; systemicRisk?: { flagged?: boolean; degradedChains?: string[] }; nodes?: Array<{ chain: string; node: string; medianMs: number | null; verdict: string; samples: number }> }
interface RevReceipt { at?: string; spread?: { steemUsd?: number | null; sbdUsd?: number | null; tronUsd?: number | null; liquidSteem?: number | null; liquidSbd?: number | null; treasuryUsd?: number | null } | null; yield?: { at?: string; state?: string } | null }
interface BatchReceipt { at?: string; lineageRoot?: string; bookCount?: number; compaction?: { savedBytes?: number }; lineageVerify?: { verdict?: string } }

function today(): string { return new Date().toISOString().slice(0, 10); }
function fmtAt(): string { return new Date().toISOString(); }

function buildItem(rail: Rail, booksRoot: string | null): { md: string; sources: string[] } | null {
  const at = fmtAt();
  const src = (f: string, j: unknown) => j != null ? f : null;
  if (rail === "technical") {
    const mesh = readJson<MeshReceipt>(path.join(ROOT, "receipts", "rpc-mesh-latest.json"));
    const deg = readJson<DegReceipt>(path.join(ROOT, "receipts", "bandwidth-degradation-latest.json"));
    if (!mesh && !deg) return null;
    const rankLine = (c: string) => (mesh?.ranked?.[c] ?? []).map((n) => `${n.node.replace("https://", "")}${n.ok ? "" : "!(dead)"}:${n.latencyMs}ms${n.successRate != null ? `@${Math.round(n.successRate * 100)}%` : ""}`).join(" > ") || "n/a";
    const degLine = (deg?.nodes ?? []).filter((n) => n.verdict !== "insufficient-data-honest").map((n) => `${n.node}(${n.verdict},${n.samples})`).join(" · ") || "all-nodes-thin-window-honest";
    const md = `---\nrail: technical\nslug: ${today()}-digest\ncompiledFrom: books\nbooksRoot: ${booksRoot ?? "null"}\nat: ${at}\nstatus: STAGED\n---\n\n# Technical rail digest — ${today()} (measured · zero fabrication)\n\n- **mesh-at:** ${mesh?.at ?? "n/a"}\n- **node rankings (ok-desc):**\n  - steem: ${rankLine("steem")}\n  - hive: ${rankLine("hive")}\n  - blurt: ${rankLine("blurt")}\n- **degradation verdicts (>=30min windows only):** ${degLine}\n- **systemicRisk flagged:** ${deg?.systemicRisk?.flagged === true ? "YES" : "none"}\n- measured-by: scripts/rpc-mesh.ts (2h) · scripts/bandwidth-degradation.ts (2h)\n`;
    return { md, sources: [src("receipts/rpc-mesh-latest.json", mesh), src("receipts/bandwidth-degradation-latest.json", deg)].filter(Boolean) as string[] };
  }
  if (rail === "financial") {
    const rev = readJson<RevReceipt>(path.join(ROOT, "receipts", "revenue-router-latest.json"));
    if (!rev) return null;
    const s = rev.spread ?? {};
    const md = `---\nrail: financial\nslug: ${today()}-digest\ncompiledFrom: books\nbooksRoot: ${booksRoot ?? "null"}\nat: ${at}\nstatus: STAGED\n---\n\n# Financial rail digest — ${today()} (measured · read-only oracle · venue-pending)\n\n- **spread-oracle-at:** ${rev.at ?? "n/a"}\n- **prices (CoinGecko, read-only):** STEEM=$${s.steemUsd ?? "n/a"} · SBD=$${s.sbdUsd ?? "n/a"} · TRON=$${s.tronUsd ?? "n/a"}\n- **liquid balances:** ${s.liquidSteem ?? "n/a"} STEEM · ${s.liquidSbd ?? "n/a"} SBD\n- **treasury valuation:** $${s.treasuryUsd ?? "n/a"}\n- **venue policy:** liquidation route/sequence = OWNER-GATED (charter) — zero market actions from this digest\n- measured-by: saos-dex/scripts/revenue-router.ts (6h, read-only)\n`;
    return { md, sources: ["receipts/revenue-router-latest.json"] };
  }
  const batch = readJson<BatchReceipt>(path.join(ROOT, "receipts", "post-batcher-latest.json"));
  const lineage = readJson<{ head?: string; chain?: Array<{ at: string; root: string; verdict: string }> }>(BOOKS_LINEAGE);
  if (!batch && !lineage) return null;
  const chain = (lineage?.chain ?? []).slice(-3).map((c) => `${c.root.slice(0, 12)}…(${c.verdict})`).join(" → ") || "n/a";
  const md = `---\nrail: architectural\nslug: ${today()}-digest\ncompiledFrom: books\nbooksRoot: ${booksRoot ?? "null"}\nat: ${at}\nstatus: STAGED\n---\n\n# Architectural rail digest — ${today()} (measured · zero fabrication)\n\n- **post-batch-at:** ${batch?.at ?? "n/a"}\n- **books compiled:** ${batch?.bookCount ?? "n/a"} (honest disk count)\n- **lineageRoot:** ${batch?.lineageRoot?.slice(0, 16) ?? lineage?.head?.slice(0, 16) ?? "n/a"}…\n- **lineage verdict:** ${batch?.lineageVerify?.verdict ?? "n/a"}\n- **compaction saved:** ${batch?.compaction?.savedBytes ?? "n/a"}B\n- **lineage chain (tail-3):** ${chain}\n- measured-by: saos-dex/scripts/post-batcher.ts (6h, lineage fail-closed)\n`;
  return { md, sources: [src("receipts/post-batcher-latest.json", batch), src("receipts/books-lineage.json", lineage)].filter(Boolean) as string[] };
}

async function main(): Promise<void> {
  const at = fmtAt();
  const booksRoot = readJson<{ head?: string }>(BOOKS_LINEAGE)?.head ?? null;
  const items: Array<{ rail: string; file: string; bytes: number; booksRoot: string | null; leakScan: string }> = [];
  const skipped: Array<{ rail: string; reason: string }> = [];
  for (const rail of RAILS) {
    const built = buildItem(rail, booksRoot);
    if (!built) { skipped.push({ rail, reason: "no-source-receipts-honest" }); continue; }
    if (leakScan(built.md)) { skipped.push({ rail, reason: "LEAK-SCAN-REFUSED (fail-closed)" }); continue; }
    const dir = path.join(ROOT, "content", "rails", rail, "items");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${today()}-digest.md`);
    fs.writeFileSync(file, built.md);
    items.push({ rail, file: path.relative(ROOT, file), bytes: Buffer.byteLength(built.md), booksRoot, leakScan: "clean" });
  }
  fs.mkdirSync(path.dirname(OUT_RECEIPT), { recursive: true });
  fs.writeFileSync(OUT_RECEIPT, JSON.stringify({
    schema: "saos.rail-compile/1", at,
    booksRoot: booksRoot ?? null,
    items, skipped,
    status: "STAGED-OWNER-GATED (zero publish · zero broadcast)",
    doctrine: "measured-metrics-only · leak-scan fail-closed · deterministic same-day overwrite",
    keysLeaked: false,
  }, null, 1) + "\n");
  console.log(`rail-compiler: items=${items.length} skipped=${skipped.length} · booksRoot=${(booksRoot ?? "null").slice(0, 12)}… · STAGED (owner-gated, zero publish)`);
}

main().catch((e) => { console.error(`[rail-compiler] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
