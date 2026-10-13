import { NextRequest, NextResponse } from "next/server";
import { safeErr } from "@/lib/safe-error"; // FIX(R16-b·m5)
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { canonicalDigest } from "@/lib/saos/canonical-json";
import { receiptPreimage } from "@/lib/saos/evidence";

export const dynamic = "force-dynamic";

// FIX(R16-b·M2): הנתיב הציבורי סרק את כל שרשרת-הקבלות (צומחת-ללא-תקרה — 1-לכל-פעימת-חותם)
// ואימת כל-עלה — עומס-CPU/DB לא-מאומת פרופורציונלי-להיסטוריה על-כל-GET. עתה: חלון-סריקה
// מקוררר (החדשים-ביותר) + מטמון-קצר לפי-טביעת-אצבע-של-המצב — והכל-מדווח-כנה (חלקי ≠ מלא).
const RECEIPT_SCAN_CAP = 500;
const LEAF_PROOF_CAP = 1000;
const CACHE_TTL_MS = 20_000;
let packCache: { key: string; at: number; body: Record<string, unknown> } | null = null;

/**
 * verify-pack — the public proof surface: latest seal → merkle tree →
 * inclusion proof for every leaf → independent verification.
 * Anyone can verify without trusting us. (steem-main verify-pack discipline)
 *
 * FIX(Roast-64-a · F2): ההוכחה עודכנה לסכמה-המופרדת-דומיינים (RFC-6962-style):
 * leaf = sha256(0x00‖leaf) · node = sha256(0x01‖L‖R) · root = sha256(0x02‖u32le(count)‖top).
 * הוכחות-שורשים-ישנות-שנחתמו-בסכמה-הקודמת לא יאומתו עוד (rootMatches=false כנה)
 * — פעימת-עגינה חדשה מייצרת root-מאומת-תחת-הסכמה-החדשה.
 */
export async function GET(req: NextRequest) {
  try {
    // FIX(R16-b·M2): מטמון-תוצאה-לפי-מצב-השרשרת — סריקה-מלאה פעם-ב-20ש׳ לכל-הציבור
    const latestMarker = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" }, select: { digest: true, createdAt: true } });
    const sealMarker = await db.sealRecord.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
    const cacheKey = `${sealMarker?.id ?? "none"}:${latestMarker?.digest ?? "none"}:${latestMarker?.createdAt.toISOString() ?? ""}`;
    if (packCache && packCache.key === cacheKey && Date.now() - packCache.at < CACHE_TTL_MS) {
      return NextResponse.json(packCache.body);
    }

    const seal = await db.sealRecord.findFirst({
      orderBy: { createdAt: "desc" },
      include: { leaves: true }
    });

    if (!seal || seal.leaves.length === 0) {
      return NextResponse.json({
        ok: true,
        empty: true,
        message: "אין חותם עדיין — צור חותם ראשון דרך POST /api/saos/seal"
      });
    }

    const leaves = [...seal.leaves].sort((a, b) => a.index - b.index).map((l) => l.digest);
    const tree = await buildMerkleTree(leaves);
    const rootMatches = tree.root === seal.root;

    // prove + verify EVERY leaf — full independent verification
    // FIX(R16-b·M2): תקרת-עלים (גנרוסית — לא-מוגעת-בפועל; הגנת-עומק לפני-צמיחה-בלתי-מוגבלת)
    interface ProofResult { index: number; leaf: string; verified: boolean; }
    const proofs: ProofResult[] = [];
    const leafScan = Math.min(tree.leaves.length, LEAF_PROOF_CAP);
    for (let i = 0; i < leafScan; i++) {
      const p = await merkleProof(tree, i);
      const verified = await verifyMerkleProof(p);
      proofs.push({ index: i, leaf: p.leaf.slice(0, 20) + "…", verified });
    }
    const allVerified = proofs.every((p) => p.verified);
    // FIX(3-b · F9): כנות-חלון — כשמספר-העלים חורג-מהתקרה, ההוכחות מכסות-חלון-בלבד;
    // בלי-הדיווח allVerified=true נראה כאימות-מלא (חלקי ≠ מלא).
    const leafScanWindow = tree.leaves.length > LEAF_PROOF_CAP ? leafScan : null;

    // FIX(Roast-63 · H2): אין-עוד-כתיבה-ב-GET (היה-רישום-קבלה-בכל-סריקה = הצפת-שרשרת).
    // FIX(Roast-63 · M12): במקום-זאת — **מאמתים-את-שרשרת-העדויות-עצמה** כאן.
    // FIX(Roast-64-a · F4): ה-preimage כולל את גבול-האמת (truth) — דרך receiptPreimage,
    // מקור-האמת-היחיד של forge/verify. truth לא נשמר-ב-DB — האימות-מה-DB מניח את
    // ברירת-המחדל-הכנה (NONE/0); קבלה-שנוצרה-עם-truth-אחר לא תעבור אימות (fail-closed).
    // ה-"at" לא-נשמר-בפני-עצמו, רק-createdAt (אותו-שעון-תהליך; ms-גבולי-עלול-
    // להחליק) → שני-candidates-כנים.
    // FIX(R16-b·M2): חלון-סריקה-מקוררר — ה-500 האחרונים + ספירה-מלאה בנפרד;
    // סריקה-חלקית מדווחת-ככזו (חלקי ≠ שלם ≠ שבור).
    const receiptsTotal = await db.evidenceReceipt.count();
    const receiptRows = await db.evidenceReceipt.findMany({ orderBy: { createdAt: "desc" }, take: RECEIPT_SCAN_CAP });
    const receipts = receiptRows.slice().reverse(); // סדר-כרונולוגי-בתוך-החלון
    const partialScan = receiptsTotal > receipts.length;
    // FIX(R15-b · M1 rewrite — forensic honesty over false binary): נמדד-חי — כל-ה-prevDigest
    // ב-DB הן null (ארטיפקט-שחזור/dedup של-R12-a) → "שרשרת" כ-לינקאז' לא-קיימת-באחסון,
    // והדוח קיבל brokenAt:0 קבוע (שלילי-שקר-מוסדי). עתה: שתי-בדיקות-נפרדות-וכנות —
    // (a) תקינות-תוכן-פר-קבלה: digest משתווה ל-preimage-הנוכחי (kind+at+payload+prevDigest-כפי-שנשמר)
    // (b) שלמות-הלינקאז' השמורה: prevDigest-רציף — אם-אבד-באחסון מדווח-כך-מפורשות.
    let verifiedCount = 0;
    let firstDigestFail: number | null = null;
    let linkageLost = false;
    let prevDigest: string | null = null;
    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i]!;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(r.payload) as Record<string, unknown>; } catch { payload = {}; }
      const cands = [
        r.createdAt.toISOString(),
        new Date(Math.floor(r.createdAt.getTime() / 1000) * 1000).toISOString(),
      ];
      let matched = false;
      for (const at of cands) {
        const d = await canonicalDigest(receiptPreimage({ kind: r.kind, at, payload, prevDigest: r.prevDigest }));
        if (d === r.digest) { matched = true; break; }
      }
      if (matched) verifiedCount++; else if (firstDigestFail === null) firstDigestFail = i;
      if (i > 0 && r.prevDigest === null) linkageLost = true;
      prevDigest = r.prevDigest;
    }
    void prevDigest;
    const chainOk = !partialScan && verifiedCount === receipts.length && !linkageLost;
    const chainCheck = {
      ok: chainOk,
      receiptsTotal,
      receiptsVerified: verifiedCount,
      firstDigestFail,
      linkageLost,
      ...(partialScan ? { scannedWindow: receipts.length } : {}),
      note: partialScan
        ? `סריקה-חלקית כנה: ${receipts.length}/${receiptsTotal} קבלות אחרונות נסרקו (חלון-${RECEIPT_SCAN_CAP}; המצאות הפוכה = מטען-יתר) — ${verifiedCount}/${receipts.length} מאומתות בתוך-החלון${linkageLost ? ' · מטא-לינקאז אבד-באחסון' : ''}`
        : linkageLost || verifiedCount < receipts.length
        ? `פורנזי: ${verifiedCount}/${receipts.length} קבלות מאומתות-תוכן מול-ה-preimage-הנוכחי${linkageLost ? ' · מטא-הלינקאז (prevDigest) אבד-באחסון (ארטיפקט-שחזור R12-a) — סדר-הקבלות אינו-ניתן-לאימות-קריפטוגרפי' : ''} — מדווח-כנה במקום brokenAt-קבוע`
        : null,
    };

    const body: Record<string, unknown> = {
      ok: true,
      seal: {
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        createdAt: seal.createdAt
      },
      tree: { leaves: leaves.length, levels: tree.levels.length, root: tree.root },
      rootMatches,
      allVerified,
      proofs,
      sampleProof: await merkleProof(tree, 0),
      evidenceChain: { receipts: receipts.length, ...chainCheck }, // FIX(R15-b · M1): הפרטים-המלאים (legacy/partition/note) — היה-נחתך-ל-3-שדות
      // FIX(Roast-64-a · F2): כנות-לשורשים-ישנים — root-שנחתם-בסכמה-הקודמת לא יאומת
      ...(rootMatches ? {} : { legacyRootNote: "root-זה נחתם בסכמה-הקודמת (ללא הפרדת-דומיינים ואיגוד-מספר-עלים) — הרץ פעימת-עגינה חדשה לשורש-מאומת-תחת-הסכמה-הנוכחית" }),
      // FIX(3-b · F9): חריגה-מתקרת-העלים מדווחת-כנה (ההוכחות מכסות-חלון-בלבד)
      ...(leafScanWindow !== null ? { leafScanWindow, leafNote: `עלים=${leaves.length} מעל תקרת-ההוכחה=${LEAF_PROOF_CAP} — allVerified מכסה את החלון-הראשון (${leafScan}) בלבד (חלקי ≠ מלא)` } : {}),
      // FIX(R17-a·F3): חוזה-ממשק — השרת שלח string[] וה-UI ציפה-string (React מרנדר
      // מערך-ילדים בלי-הפרדות → 4-השלבים-התמזגו-לשורה-מקוללת אחת). עתה: מחרוזת-מצורפת.
      howToVerify: [
        "קח את sampleProof.path",
        "hash = sha256(0x00 || leafBytes) — עלה מגובש בהפרדת-דומיין",
        "לכל צעד: dir==='R' ? sha256(0x01 || hash || sibling) : sha256(0x01 || sibling || hash)",
        "בסוף: root = sha256(0x02 || uint32le(leafCount) || hash) — מספר-העלים אגוד-בשורש (anti-CVE-2012-2459)",
        "השווה ל-root — שוויון = העלה כלול בחותם, בלי לסמוך עלינו"
      ].join("\n")
    };
    packCache = { key: cacheKey, at: Date.now(), body }; // FIX(R16-b·M2)
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      // FIX(R16-b·m5): פירוט-גולמי רק-לבעלים; אנונימי מקבל פסק כנה גנרי
      await safeErr(req, e, "verify-pack failed"),
      { status: 200 }
    );
  }
}
