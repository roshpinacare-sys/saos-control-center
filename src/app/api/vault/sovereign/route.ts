// ═══ כספת-הריפו הריבונית — API (EXEC-CD-24) ══════════════════════════════════
// GET — דו-שכבתי (תקדים Roast-65-b · M4):
//   · אנונימי → קיום-הכספת + מטא + כתובות-מוסתרות + ספירת-העברות. אפס-מלאי-מלא.
//   · מפעיל (requireOwner) → כתובות-מלאות + נתיבים + טביעות-אצבע + רישום-ההעברה-המלא.
// POST — מפעיל-בלבד: { action:'verify' } → פתיחה-מלאה + נגזרה-מחדש-ביט-מול-ביט +
//        בדיקות-חי-מול-RPC-ציבורי. לעולם לא מחזיר חומר-סוד — רק פסק-דין + תצוגת-ציבור.
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import {
  vaultExists, openRepoVault, verifyRepoVault, readEscalations, probeChains,
  publicView, vaultFile, MANIFEST,
} from '@/lib/repo-vault';
import fs from 'fs';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!vaultExists()) {
    return NextResponse.json({
      ok: true, exists: false,
      recovery: 'repo-vault/ חסר — clone את הריפו או הרץ bun scripts/repo-vault-mint.ts',
      escalations: owner ? readEscalations() : { updatedAt: '', note: '', items: [] },
    });
  }
  try {
    const { bundle, manifest } = openRepoVault();
    const view = publicView(bundle);
    const esc = readEscalations();
    if (!owner) {
      // אנונימי — כתובות מוסתרות בלבד (כתובות-הן-ציבוריות-מטבען, אך דיסציפלינה-שמרנית)
      return NextResponse.json({
        ok: true,
        exists: true,
        me: null,
        label: bundle.label,
        createdAt: bundle.createdAt,
        algo: manifest?.algo ?? null,
        networks: view.map(v => ({
          network: v.network, label: v.label, path: v.path,
          addressMasked: v.address.slice(0, 6) + '…' + v.address.slice(-4),
          probe: manifest?.networks.find(n => n.network === v.network)?.probe ?? null,
        })),
        escalationsCount: esc.items.length,
        // EXEC-CD-24: רישום-ההעברה-למפעיל פתוח-לכולם — אפס-סודות בו, וזה-בדיוק-המשטח
        // "להעביר-אליי" — חייב-להיות-גלוי גם-למפעיל-הלא-מחובר. הדו-שכבתי נשמר על מלאי-המפתחות.
        escalations: esc,
        fingerprint: manifest?.fingerprints?.mnemonic ?? null,
      });
    }
    return NextResponse.json({
      ok: true,
      exists: true,
      me: 'owner',
      label: bundle.label,
      createdAt: bundle.createdAt,
      algo: manifest?.algo ?? null,
      fingerprints: manifest?.fingerprints ?? null,
      networks: view.map(v => ({
        ...v,
        probe: manifest?.networks.find(n => n.network === v.network)?.probe ?? null,
      })),
      manifestOnDisk: fs.existsSync(vaultFile(MANIFEST)),
      manifestConsistent: manifest
        ? JSON.stringify(manifest.networks.map(n => `${n.network}:${n.address}`).sort())
        === JSON.stringify(view.map(v => `${v.network}:${v.address}`).sort())
        : false,
      escalations: esc,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false, exists: true,
      error: e instanceof Error ? e.message.slice(0, 200) : 'vault open failed',
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* ברירת-מחדל */ }
  if (body.action !== 'verify') {
    return NextResponse.json({ ok: false, error: 'unknown action (verify only)' }, { status: 400 });
  }
  if (!vaultExists()) return NextResponse.json({ ok: false, error: 'no vault in repo' }, { status: 404 });
  try {
    const t0 = Date.now();
    const v = verifyRepoVault(); // פתיחה-GCM + נגזרה-מחדש ביט-מול-ביט
    const { bundle } = openRepoVault();
    const probes = await probeChains(bundle.derivations);
    return NextResponse.json({
      ok: true,
      verdict: {
        opened: v.opened,
        addressesMatch: v.addressesMatch,
        mismatches: v.mismatches,
        label: v.label,
        latencyMs: Date.now() - t0,
      },
      networks: v.view.map(d => ({ ...d, probe: probes.find(p => p.network === d.network) ?? null })),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 300) : 'verify failed',
    }, { status: 500 });
  }
}
