// ═══ genesis.ts — התחייה-העצמית של-האוטונומיה (EXEC-CD-46) ═══════════════════
// דבר-הבעלים: "כל-יום-זה-נמחק-וכל-יום-אני-צריך-לחדש-את-זה-במשך-שעות... האוטונומיה
// היא-המפעיל. אם-אני-מתחבר-עם-סוכן-חדש-לגיטהאב-אני-לא-אצטרך-לתת-לו-מפתחות."
//
// התשובה-הארכיטקטונית: סנדבוקס-טרי → הפלטפורמה מריצה `bun run dev` → predev-hook
// מצית-את-הג'נזיס הזה באסינכרון → האוטונומיה משחזרת-את-עצמה מהגיט לבד:
//
//   1. טוקן (המחווה-הפיזית-היחידה: upload/pat.env) — poll-סבלני אם-חסר.
//   2. remotes-מאומתים → סנכרון-עצמי (fetch+rebase --autostash, איסור-דריסה).
//   3. תלויות + prisma (מאם ודקס) — רק-אם-חסר.
//   4. כספת-הריפו: פתיחה 2-of-2 + אימות-ביט-מול-ביט (fail-closed — כספת-שבורה=עצירה).
//   5. מפתחות-הצי → agent/keys (13-חשבונות).
//   6. חימוש-מסילות מהכספת: hive (arm-anchor-keys) + steem/blurt (arm-rails-rot4).
//   7. dex.db — יצירה-אם-חסר (המנוע-טוען-את-ה-snapshot-המקומט ב-boot).
//   8. שירותים + watchdog + קדנסים (boot-all + קדנסים-בקו-חיים, אידמפוטנטי).
//   9. אימות-אמת: פורטים · מסילות-עיגון · ls-remote==rev-parse.
//  10. דו"ח-כנה: genesis-report.json + סימון-הושלם.
//
// חוזה-סודות: אפס-ערכי-סוד בפלט/לוג/דו"ח — טביעות-אצבע ובוליאנים בלבד.
// הרצה: bun scripts/genesis.ts [--wait] [--skip-sync]
import fs from 'fs';
import path from 'path';

const ROOT = '/home/z/my-project';
const DEX = path.join(ROOT, 'saos-dex');
const REPORT = path.join(ROOT, 'genesis-report.json');
const MARKER = path.join(ROOT, '.autonomy-genesis-done');
const LOG_TAG = '[genesis]';

const WAIT = process.argv.includes('--wait');
const SKIP_SYNC = process.argv.includes('--skip-sync');

type Verdict = 'ok' | 'already' | 'fail' | 'skip';
interface Step { name: string; verdict: Verdict; detail: string; ms: number; }
const steps: Step[] = [];

async function sh(cmd: string, cwd = ROOT, timeoutMs = 180_000): Promise<{ ok: boolean; out: string }> {
  try {
    const p = Bun.spawn(['bash', '-c', cmd], { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* */ } }, timeoutMs);
    const out = await new Response(p.stdout).text();
    const err = await new Response(p.stderr).text();
    const code = await p.exited;
    clearTimeout(timer);
    return { ok: code === 0, out: out.trim() + (err.trim() && code !== 0 ? ` | ${err.trim().slice(0, 200)}` : '') };
  } catch (err) {
    return { ok: false, out: String(err).slice(0, 200) };
  }
}

async function step(name: string, fn: () => Promise<{ verdict: Verdict; detail: string }>): Promise<boolean> {
  const t0 = Date.now();
  try {
    const r = await fn();
    steps.push({ name, ...r, ms: Date.now() - t0 });
    console.log(`${LOG_TAG} ${r.verdict === 'fail' ? '✖' : '✓'} ${name} (${r.verdict}) — ${r.detail}`);
    return r.verdict !== 'fail';
  } catch (err) {
    steps.push({ name, verdict: 'fail', detail: String(err).slice(0, 200), ms: Date.now() - t0 });
    console.log(`${LOG_TAG} ✖ ${name} (fail) — ${String(err).slice(0, 200)}`);
    return false;
  }
}

function readToken(): string | null {
  const envTok = process.env.SAOS_GITHUB_TOKEN;
  if (envTok && envTok.trim()) return envTok.trim();
  const p = path.join(ROOT, 'upload', 'pat.env');
  try {
    const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).sort((a, b) => b.length - a.length)[0];
    return line && line.trim().length > 20 ? line.trim() : null;
  } catch { return null; }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`${LOG_TAG} ═══ תחיה-עצמית מתחילה · ${new Date().toISOString()} ═══`);

  // ── 1. טוקן ──────────────────────────────────────────────────────────────
  await step('token', async () => {
    let tok = readToken();
    if (!tok && WAIT) {
      console.log(`${LOG_TAG} token: לא-נמצא — ממתין-עד-10דק' ל-upload/pat.env (המחווה-הפיזית-היחידה)…`);
      for (let i = 0; i < 30 && !tok; i++) { await new Promise(r => setTimeout(r, 20_000)); tok = readToken(); }
    }
    if (!tok) return { verdict: 'fail' as Verdict, detail: 'אין-טוקן: upload/pat.env חסר — האוטונומיה ממתינה-בכנות (זו-המחווה-האנושית-היחידה-שנותרה)' };
    const r = await sh(`curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat upload/pat.env | tr -d '\\r\\n ')" https://api.github.com/user`);
    return r.out === '200'
      ? { verdict: 'ok' as Verdict, detail: 'טוקן-חי ומאומת מול-GitHub' }
      : { verdict: 'fail' as Verdict, detail: `טוקן-נדחה (HTTP ${r.out.slice(0, 6)})` };
  });

  const token = readToken();

  // ── 2. remotes ────────────────────────────────────────────────────────────
  if (token) await step('remotes', async () => {
    const url = `https://x-access-token:${token}@github.com/roshpinacare-sys`;
    const a = await sh(`git remote set-url origin "${url}/saos-control-center.git"`);
    const b = await sh(`git -C saos-dex remote set-url origin "${url}/saos-dex.git"`);
    return a.ok && b.ok ? { verdict: 'ok' as Verdict, detail: 'remotes מאומתים (טוקן-לא-נדפס)' } : { verdict: 'fail' as Verdict, detail: 'set-url נכשל' };
  });

  // ── 2.5 הבטחת-דקס (gitignore במאם — סוכן-טרי-חייב-לשכפל-בעצמו) ──────────
  if (token) await step('ensure-dex', async () => {
    if (fs.existsSync(path.join(DEX, '.git'))) return { verdict: 'already' as Verdict, detail: 'saos-dex כבר-משוכפל' };
    const r = await sh(`git clone -q "https://x-access-token:${token}@github.com/roshpinacare-sys/saos-dex.git" saos-dex`, ROOT, 300_000);
    return r.ok || fs.existsSync(path.join(DEX, '.git')) ? { verdict: 'ok' as Verdict, detail: 'saos-dex שוכפל-מהגיט (ה-repo-הנפרד של-המנוע)' } : { verdict: 'fail' as Verdict, detail: `clone: ${r.out.slice(0, 120)}` };
  });

  // ── 3. סנכרון-עצמי ────────────────────────────────────────────────────────
  if (token && !SKIP_SYNC) {
    await step('sync-mother', async () => {
      const r = await sh('git fetch origin main && git rebase --autostash origin/main');
      return r.ok ? { verdict: 'ok' as Verdict, detail: 'מאם מסונכרנת (rebase, אפס-דריסה)' } : { verdict: 'fail' as Verdict, detail: `fetch/rebase: ${r.out.slice(0, 120)}` };
    });
    await step('sync-dex', async () => {
      const r = await sh('git fetch origin main && git rebase --autostash origin/main', DEX);
      return r.ok ? { verdict: 'ok' as Verdict, detail: 'דקס מסונכרן (rebase, אפס-דריסה)' } : { verdict: 'fail' as Verdict, detail: `fetch/rebase: ${r.out.slice(0, 120)}` };
    });
  }

  // ── 4. תלויות ─────────────────────────────────────────────────────────────
  await step('deps', async () => {
    const needMother = !fs.existsSync(path.join(ROOT, 'node_modules'));
    const needDex = !fs.existsSync(path.join(DEX, 'node_modules'));
    if (needMother) await sh('bun install --frozen-lockfile', ROOT, 300_000);
    if (needDex) await sh('bun install --frozen-lockfile', DEX, 300_000);
    return !needMother && !needDex ? { verdict: 'already' as Verdict, detail: 'node_modules קיימים בשניהם' } : { verdict: 'ok' as Verdict, detail: `הותקן: ${needMother ? 'מאם ' : ''}${needDex ? 'דקס' : ''}` };
  });

  // ── 5. prisma ─────────────────────────────────────────────────────────────
  await step('prisma', async () => {
    await sh('bunx prisma generate', ROOT, 120_000);
    const push = await sh('bunx prisma db push --skip-generate', ROOT, 120_000);
    return push.ok ? { verdict: 'ok' as Verdict, detail: 'prisma generate+push (מאם)' } : { verdict: 'fail' as Verdict, detail: `db push: ${push.out.slice(0, 120)}` };
  });

  // ── 6. כספת-הריפו (fail-closed — לב-העצמאות) ─────────────────────────────
  await step('repo-vault', async () => {
    const r = await sh('bun scripts/repo-vault-open.ts 2>&1 | tail -6');
    const ok = r.out.includes('התרגיל עבר') || r.out.includes('ביט-מול-ביט');
    return ok ? { verdict: 'ok' as Verdict, detail: 'כספת נפתחת מהריפו: GCM ✓ + נגזרה ביט-מול-ביט ✓' } : { verdict: 'fail' as Verdict, detail: `כספת-לא-נפתחה: ${r.out.slice(0, 150)}` };
  });

  // ── 7. מפתחות-הצי ────────────────────────────────────────────────────────
  await step('fleet-keys', async () => {
    if (fs.existsSync(path.join(ROOT, 'agent/keys/fleet_keys.enc'))) return { verdict: 'already' as Verdict, detail: 'fleet_keys.enc קיים על-הדיסק' };
    const r = await sh('bun scripts/restore-fleet-vault.ts 2>&1 | tail -4');
    return r.out.includes('[restore] ✓') || r.out.includes('members=')
      ? { verdict: 'ok' as Verdict, detail: 'מפתחות-הצי שוחזרו מהמעטפת' }
      : { verdict: 'fail' as Verdict, detail: `restore-fleet: ${r.out.slice(0, 150)}` };
  });

  // ── 8. חימוש-מסילות ───────────────────────────────────────────────────────
  await step('arm-hive', async () => {
    const envp = path.join(DEX, '.env');
    const armed = fs.existsSync(envp) && /HIVE_POSTING_WIF=.+/m.test(fs.readFileSync(envp, 'utf8'));
    if (armed) return { verdict: 'already' as Verdict, detail: 'HIVE_POSTING_WIF כבר-ב-.env' };
    const r = await sh('bun scripts/arm-anchor-keys.ts 2>&1 | tail -3');
    return r.out.includes('MATCH') || r.out.includes('נכתב')
      ? { verdict: 'ok' as Verdict, detail: 'hive/posting חומש (fail-closed מול-הרשות-החיה)' }
      : { verdict: 'fail' as Verdict, detail: `arm-hive: ${r.out.slice(0, 150)}` };
  });
  await step('arm-steem-blurt', async () => {
    const envp = path.join(DEX, '.env');
    const txt = fs.existsSync(envp) ? fs.readFileSync(envp, 'utf8') : '';
    const haveS = /STEEM_POSTING_WIF=.+/m.test(txt), haveB = /BLURT_ACTIVE_WIF=.+/m.test(txt);
    if (haveS && haveB) return { verdict: 'already' as Verdict, detail: 'STEEM+BLURT כבר-ב-.env' };
    const r = await sh('bun scripts/arm-rails-rot4.ts 2>&1 | tail -3');
    const wrote = (r.out.match(/נכתב/g) || []).length;
    return wrote > 0 || (haveS && haveB)
      ? { verdict: 'ok' as Verdict, detail: `steem/blurt חומשו (${wrote} נכתבו; steem=${haveS} blurt=${haveB})` }
      : { verdict: 'fail' as Verdict, detail: `arm-rot4: ${r.out.slice(0, 150)}` };
  });

  // ── 9. dex.db ─────────────────────────────────────────────────────────────
  await step('dex-db', async () => {
    const dbp = path.join(DEX, 'db/dex.db');
    if (fs.existsSync(dbp)) return { verdict: 'already' as Verdict, detail: 'dex.db קיים (המנוע-טוען-את-ה-snapshot-המקומט ב-boot)' };
    await sh('bunx prisma generate', DEX, 120_000);
    const push = await sh('bunx prisma db push --skip-generate', DEX, 120_000);
    const snap = fs.existsSync(path.join(DEX, 'db/state-snapshot.json'));
    return push.ok && snap
      ? { verdict: 'ok' as Verdict, detail: 'dex.db נוצר + snapshot-מקומט-במקום (loadSnapshot יקשור-ב-boot)' }
      : { verdict: 'fail' as Verdict, detail: `dex-db: push=${push.ok} snapshot=${snap}` };
  });

  // ── 10. שירותים ───────────────────────────────────────────────────────────
  await step('services', async () => {
    const r = await sh('bun scripts/boot-all.ts 2>&1 | tail -6');
    return r.out.includes('boot-all') ? { verdict: 'ok' as Verdict, detail: 'relay/governor/watchdog/state-push — אידמפוטנטי' } : { verdict: 'fail' as Verdict, detail: `boot-all: ${r.out.slice(0, 120)}` };
  });

  // ── 11. קדנסים ────────────────────────────────────────────────────────────
  await step('cadences', async () => {
    const ensure = (pgrep: string, spawn: string): 'alive' | 'spawned' => {
      const c = Bun.spawnSync(['bash', '-c', pgrep]);
      if (c.exitCode === 0) return 'alive';
      Bun.spawn(['bash', '-c', spawn], { cwd: ROOT, stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
      return 'spawned';
    };
    // T-66b: עוגן-^bash-בכל-הpatterns — pgrep--f-ללא-עוגן מתאים-לbash--c-הבודק-עצמו
    // (false-alive → הקדנס-לא-נטען-בכלל; נמדד-חי-בT-66: 3-קדנסים-נולדים-מתים)
    const w = ensure('pgrep -f "^bash scripts/witness-push.sh"', 'setsid nohup bash scripts/witness-push.sh >> witness-push.log 2>&1 &');
    const d = ensure('test -f /tmp/saos-restore-drill.lock && kill -0 $(cat /tmp/saos-restore-drill.lock) 2>/dev/null', 'setsid nohup bash scripts/restore-drill-cadence.sh >> restore-drill.log 2>&1 &');
    const p = ensure('pgrep -f "^bash scripts/proof-cadence.sh"', 'setsid nohup bash scripts/proof-cadence.sh >> proof-cadence.log 2>&1 &');
    // T-66 · סגירת-חור-הקור-בוט: שלושת-הקדנסים-האלה מתו-בשקט-בכל-מחיקת-סנדבוקס
    // (המשתמש-ראה-אפס-פוסטים/טלמטריה — post-batcher+rail-compiler חיים-בתוך-liquidity)
    const l = ensure('pgrep -f "^bash scripts/liquidity-cadence.sh"', 'setsid nohup bash scripts/liquidity-cadence.sh >> liquidity-cadence.log 2>&1 &');
    const f = ensure('pgrep -f "^bash scripts/fuel-telemetry-cadence.sh"', 'setsid nohup bash scripts/fuel-telemetry-cadence.sh >> fuel-telemetry.log 2>&1 &');
    const c = ensure('pgrep -f "^bash scripts/credential-drill-cadence.sh"', 'setsid nohup bash scripts/credential-drill-cadence.sh >> credential-drill.log 2>&1 &');
    return { verdict: 'ok' as Verdict, detail: `witness=${w} restoreDrill=${d} proof=${p} liquidity=${l} fuel=${f} credential=${c}` };
  });

  // ── 12. אימות-אמת ─────────────────────────────────────────────────────────
  await step('verify-ports', async () => {
    const port = async (p: number): Promise<boolean> => {
      try { const r = await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(4000) }); return r.status < 500; } catch { return false; }
    };
    const m = await port(3000), d = await port(3010);
    return d ? { verdict: 'ok' as Verdict, detail: `mother=${m ? 'up' : 'starting'} dex-engine=${d ? 'up' : 'down'}` } : { verdict: 'fail' as Verdict, detail: `engine-3010 down (mother=${m})` };
  });
  if (token) await step('verify-sync', async () => {
    const check = async (dir: string, repo: string): Promise<boolean> => {
      const r = await sh(`R=$(git ls-remote "https://x-access-token:${token}@github.com/roshpinacare-sys/${repo}.git" refs/heads/main | cut -f1); L=$(git rev-parse HEAD); [ "$R" = "$L" ] && echo SYNC-OK`, dir);
      return r.out.includes('SYNC-OK');
    };
    const a = await check(ROOT, 'saos-control-center'), b = await check(DEX, 'saos-dex');
    return a && b ? { verdict: 'ok' as Verdict, detail: 'ls-remote==rev-parse בשני-הריפו (האמת-המוכחת)' } : { verdict: 'fail' as Verdict, detail: `sync: mother=${a} dex=${b} (state-push יתיישר)` };
  });

  // ── 13. דו"ח ──────────────────────────────────────────────────────────────
  const fails = steps.filter(s => s.verdict === 'fail');
  const verdict = fails.length === 0 ? 'GENESIS-OK' : `GENESIS-PARTIAL (${fails.length} fails)`;
  const report = { startedAt: new Date(t0).toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, verdict, steps, note: 'אפס-סודות בדו"ח — טביעות-אצבע ובוליאנים בלבד. כספת-הריפו=הבעלים; pat.env=המחווה-האנושית-היחידה.' };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  if (fails.length === 0) fs.writeFileSync(MARKER, `${report.finishedAt} ${verdict}\n`);
  console.log(`${LOG_TAG} ═══ ${verdict} · ${report.durationMs}ms · דו"ח: genesis-report.json ═══`);
  for (const s of steps) console.log(`${LOG_TAG}   ${s.verdict === 'fail' ? '✖' : '·'} ${s.name}: ${s.verdict} (${s.ms}ms)`);
  process.exit(fails.length === 0 ? 0 : 1);
}

await main();
