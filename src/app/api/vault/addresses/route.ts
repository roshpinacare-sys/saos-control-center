// ═══ כתובות-הקבלה-הריבוניות — משטח-מכונה (EXEC-CD-25) ═══════════════════════
// GET → הכתובות-הציבוריות-של-כספת-הריפו (EVM/TRON/BTC/SOL) מתוך-המניפסט-הציבורי.
//
// למה-זה-קיים: חוק-המשפך (AUTONOMY-DOCTRINE §6) — כל-זרימת-ערך-נכנסת של-הריבונות
// חייבת-להגיע-לכתובות-שחיות-בכספת-שחייה-בגיט (אחרת-היא-הולכת-לאיבוד-במחיקת-סנדבוקס).
// ההחלפה-האוניברסלית (החלפת-הכל) וכל-סוכן-אוטונומי שולפים-מכאן-את-יעד-הקבלה.
//
// אפס-סודות: כתובות-קבלה-הן-ציבוריות-מטבען (מוטמנות-כבר-ב-manifest.json שבגיט).
// המעטפת-המוצפנת-אינה-נפתחת-כאן-ולא-נוגעים-בה. קריאה-מ-manifest בלבד — זול-ומבודד.
import { NextResponse } from 'next/server';
import fs from 'fs';
import { vaultFile, MANIFEST, vaultExists, openRepoVault, publicView } from '@/lib/repo-vault';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    interface ManifestShape {
      label?: string;
      networks?: Array<{ network: string; address: string; path: string; label: string }>;
    }
    if (fs.existsSync(vaultFile(MANIFEST))) {
      const m = JSON.parse(fs.readFileSync(vaultFile(MANIFEST), 'utf8')) as ManifestShape;
      const addresses: Record<string, string> = {};
      for (const n of m.networks ?? []) addresses[n.network] = n.address;
      return NextResponse.json({
        ok: true,
        exists: true,
        label: m.label ?? null,
        addresses,
        // שמות-הרשתות-הקנוניים: evm · tron · bitcoin · solana
        // evm תקף-לכל-רשתות-EVM (אותה-כתובת); bitcoin רק-ל-BTC עצמו (LTC/DOGE/BCH/DASH בפורמט-אחר!)
        coverage: {
          evm: 'כל-רשתות-EVM (ETH/BSC/BASE/ARB/OP/POLY/AVAX…)',
          solana: 'Solana (SOL/SPL)',
          tron: 'TRON (TRX/USDT-TRC20)',
          bitcoin: 'Bitcoin בלבד (P2WPKH bc1q…)',
          notCovered: 'LTC/DOGE/BCH/DASH/XMR — אין-כתובת-כספת (פורמטים-שונים; אל-תמלא-בכוח)',
        },
        source: 'manifest',
      });
    }
    // manifest חסר (ריפו-חלקי?) — פתיחה-מלאה-אך-החזרת-תצוגת-ציבור-בלבד
    if (!vaultExists()) {
      return NextResponse.json({
        ok: true, exists: false,
        recovery: 'repo-vault/ חסר — clone את הריפו או הרץ bun scripts/repo-vault-mint.ts',
      });
    }
    const { bundle } = openRepoVault();
    const addresses: Record<string, string> = {};
    for (const v of publicView(bundle)) addresses[v.network] = v.address;
    return NextResponse.json({ ok: true, exists: true, label: bundle.label, addresses, source: 'envelope-public-view' });
  } catch (e) {
    return NextResponse.json({
      ok: false, exists: true,
      error: e instanceof Error ? e.message.slice(0, 200) : 'vault addresses read failed',
    }, { status: 500 });
  }
}
