// ═══ בחירת-זהות-עוגן (Anchor-Identity Picker · EXEC-CD-35) ═══════════════════
// השער-הכלכלי האחרון: מסילת-העיגון חמושה (F-7) אך @headcorner RC-אזול (נמדד-חי).
// הכספת מחזיקה 15 זהויות-מפעיל. הסקריפט: לכל-זהות → האם WIF-הכספת הוא רשות-חיה
// על Hive (posting/active) → מה-ה-RC-החי שלה → בחירת-המארח-העיגון-הטוב-ביותר.
//
// אפס-חומר-מפתח בפלט: רק-פאבים-פומביים (נתוני-שרשרת), שמות-חשבונות, ומספרי-RC.
//
// הרצה: bun scripts/pick-anchor-identity.ts [--apply]
import { openRepoVault } from '../src/lib/repo-vault';
import { pubOfWif } from '../saos-dex/src/lib/dex/signer';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const ENV_FILE = path.resolve(process.cwd(), 'saos-dex/.env');
const HIVE_NODES = ['https://api.hive.blog', 'https://anyx.io'];
const STEEM_NODES = ['https://api.steemit.com'];

async function rpc(node: string, method: string, params: unknown[]): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(node, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: Record<string, unknown> };
    return j.result ?? null;
  } catch { return null; }
}

async function rpcAny(nodes: string[], method: string, params: unknown[]): Promise<Record<string, unknown> | null> {
  for (const n of nodes) {
    const r = await rpc(n, method, params);
    if (r !== null) return r;
  }
  return null;
}

interface VaultAccount { username?: string; keys?: Record<string, { wif?: string; pub?: string }>; }

async function main(): Promise<void> {
  const { bundle } = openRepoVault();
  const parsed = JSON.parse(bundle.absorbed?.['vault-accounts'] ?? '{}') as { accounts?: VaultAccount[] };
  const accounts = parsed.accounts ?? [];
  const usernames = [...new Set(accounts.map(a => a.username).filter((u): u is string => !!u))];
  console.log(`[pick] ${accounts.length} זהויות-כספת · מועמדות: ${usernames.join(', ')}`);

  // רשויות-חיות פר-חשבון (Hive + Steem) — נתוני-שרשרת-פומביים
  const auths = new Map<string, { hive?: { posting: string[]; active: string[] }; steem?: { posting: string[]; active: string[] }; hiveRc?: { max: number; current: number }; steemRc?: { max: number; current: number } }>();
  for (const u of usernames) {
    const ha = (await rpcAny(HIVE_NODES, 'condenser_api.get_accounts', [[u]])) as Array<{ posting?: { key_auths?: [string, number][] }; active?: { key_auths?: [string, number][] } }> | null;
    const sa = (await rpcAny(STEEM_NODES, 'condenser_api.get_accounts', [[u]])) as Array<{ posting?: { key_auths?: [string, number][] }; active?: { key_auths?: [string, number][] } }> | null;
    const hrc = (await rpcAny(HIVE_NODES, 'condenser_api.find_rc_accounts', [[u]])) as { rc_accounts?: Array<{ rc_manabar?: { current_mana: number | string; max_mana: number | string } }> } | null;
    const src = (await rpcAny(STEEM_NODES, 'condenser_api.find_rc_accounts', [[u]])) as { rc_accounts?: Array<{ rc_manabar?: { current_mana: number | string; max_mana: number | string } }> } | null;
    const pct = (cur: number | string | undefined, max: number | string | undefined) =>
      max && Number(max) > 0 ? Number(cur ?? 0) / Number(max) : 0;
    auths.set(u, {
      hive: ha?.[0] ? { posting: (ha[0].posting?.key_auths ?? []).map(k => k[0]), active: (ha[0].active?.key_auths ?? []).map(k => k[0]) } : undefined,
      steem: sa?.[0] ? { posting: (sa[0].posting?.key_auths ?? []).map(k => k[0]), active: (sa[0].active?.key_auths ?? []).map(k => k[0]) } : undefined,
      hiveRc: hrc?.rc_accounts?.[0]?.rc_manabar ? { max: Number(hrc.rc_accounts[0].rc_manabar.max_mana), current: Number(hrc.rc_accounts[0].rc_manabar.current_mana) } : undefined,
      steemRc: src?.rc_accounts?.[0]?.rc_manabar ? { max: Number(src.rc_accounts[0].rc_manabar.max_mana), current: Number(src.rc_accounts[0].rc_manabar.current_mana) } : undefined,
    });
  }

  // התאמת-מפתחות-הכספת מול-הרשויות-החיות (בזיכרון; פלט-פאבים-בלבד)
  const findings: Array<{ user: string; chain: 'hive' | 'steem'; role: 'posting' | 'active'; pub: string; rcPct: number; rcMax: number }> = [];
  for (const a of accounts) {
    if (!a.username || !a.keys) continue;
    const A = auths.get(a.username);
    if (!A) continue;
    for (const role of ['posting', 'active'] as const) {
      const wif = a.keys[role]?.wif;
      if (!wif) continue;
      const pub = pubOfWif(wif);
      if (!pub) continue;
      if (A.hive && (A.hive[role].includes(pub) || A.hive[role === 'posting' ? 'active' : 'posting'].includes(pub))) {
        const liveRole = A.hive[role].includes(pub) ? role : (role === 'posting' ? 'active' : 'posting');
        const rc = A.hiveRc ? A.hiveRc.current / Math.max(1, A.hiveRc.max) : 0;
        findings.push({ user: a.username, chain: 'hive', role: liveRole, pub, rcPct: rc, rcMax: A.hiveRc?.max ?? 0 });
      }
      if (A.steem && (A.steem[role].includes(pub) || A.steem[role === 'posting' ? 'active' : 'posting'].includes(pub))) {
        const liveRole = A.steem[role].includes(pub) ? role : (role === 'posting' ? 'active' : 'posting');
        const rc = A.steemRc ? A.steemRc.current / Math.max(1, A.steemRc.max) : 0;
        findings.push({ user: a.username, chain: 'steem', role: liveRole, pub, rcPct: rc, rcMax: A.steemRc?.max ?? 0 });
      }
    }
  }

  console.log('\n[pick] ── התאמות-רשות-חיות (פאב=נתון-פומבי) ──');
  for (const f of findings) {
    console.log(`  ${f.chain}/${f.user}/${f.role}: pub=${f.pub.slice(0, 14)}… · RC=${(f.rcPct * 100).toFixed(1)}% (max=${f.rcMax})`);
  }
  if (findings.length === 0) { console.log('\n[pick] אף-זהות-כספת אינה רשות-חיה על השרשראות — כנה ומתועד'); return; }

  const hiveBest = findings.filter(f => f.chain === 'hive' && f.rcPct >= 0.3).sort((a, b) => b.rcPct - a.rcPct)[0];
  if (!hiveBest) {
    const anyHive = findings.filter(f => f.chain === 'hive').sort((a, b) => b.rcPct - a.rcPct)[0];
    console.log(`\n[pick] אף-זהות-Hive עם RC≥30% — הטובה-ביותר: ${anyHive ? `${anyHive.user} RC=${(anyHive.rcPct * 100).toFixed(1)}%` : 'אין'} · RC מתחדש ~20%/יום — המסילה תנסה-שוב (economic-wait)`);
    return;
  }
  console.log(`\n[pick] הזהות-הנבחרת: ${hiveBest.user}/${hiveBest.role} RC=${(hiveBest.rcPct * 100).toFixed(1)}%`);

  if (!APPLY) { console.log('[pick] --apply לא-נמסר — לא נכתב דבר'); return; }

  // חילוץ-ה-WIF-המנצח (מזוהה-מחדש לפי-הפאב — בזיכרון-בלבד)
  const acc = accounts.find(a => a.username === hiveBest.user)!;
  const wif = (acc.keys?.[hiveBest.role]?.wif || acc.keys?.posting?.wif || acc.keys?.active?.wif) as string;
  let envTxt = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const lines = envTxt.split('\n').filter(l => !/^HIVE_ANCHOR_ACCOUNT=/.test(l));
  if (!lines.some(l => /^HIVE_POSTING_WIF=/.test(l))) lines.push(`HIVE_POSTING_WIF=${wif}`);
  else lines.forEach((l, i) => { if (/^HIVE_POSTING_WIF=/.test(l) && l.length < 60) lines[i] = l; });
  lines.push(`HIVE_ANCHOR_ACCOUNT=${hiveBest.user}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n').endsWith('\n') ? lines.join('\n') : lines.join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
  console.log(`[pick] ✓ .env: HIVE_ANCHOR_ACCOUNT=${hiveBest.user} (+ posting WIF אם-היה-חסר) — מוכן-להפעלה-מחדש`);
}

main().catch(e => { console.error('✖', e instanceof Error ? e.message : e); process.exit(9); });
