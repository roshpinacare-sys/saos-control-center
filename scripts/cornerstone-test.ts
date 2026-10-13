/**
 * cornerstone-test.ts — the decisive test: are the soldiers' live keys derived
 * from the sovereign/headcorner seeds found in the estate bundle?
 * Scheme: steem-js getPrivateKeys = WIF(sha256(acct + role + password)).
 * Candidates: hc.phrase, hc.sovereign12, hc.words, wallets-seed(96), sovereign-mnemonic phrase/words, tron mnemonics.
 * Targets: all 11 ROT1 accounts + ynet, on hive+steem, current live authorities.
 */
import crypto from 'crypto';
import fs from 'fs';
const ROT1_ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];

const MAGIC = 'SAOS-FLEET-VAULT-1';
// Task 13-c: env override for the fleet-envelope dir; the repo-local gitignored
// agent/keys stays the default convention (created by reseal-fleet-vault.ts).
const KEYS_DIR = process.env.CC_KEYS_DIR || 'agent/keys';
function openBundle() {
  const raw = fs.readFileSync(`${KEYS_DIR}/fleet_keys.enc`, 'utf8');
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ''), 'hex');
  const meta = JSON.parse(fs.readFileSync(`${KEYS_DIR}/fleet_keys.meta.json`, 'utf8'));
  const key = crypto.scryptSync(meta.pass, payload.subarray(0, 16), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  return JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString('utf8'));
}
async function getAuths(net: string, acct: string): Promise<Record<string, string[]>> {
  const url = net === 'steem' ? 'https://api.steemit.com' : 'https://api.hive.blog';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [[acct]] }) });
  const j = (await res.json()) as { result: Array<Record<string, unknown>> };
  const a = j.result?.[0];
  if (!a) throw new Error('missing');
  const out: Record<string, string[]> = {};
  for (const role of ['owner', 'active', 'posting'] as const) out[role] = ((a[role] as { key_auths: [string, number][] }).key_auths).map(([k]) => k);
  out.memo = [a.memo_key as string];
  return out;
}
const ROLES = ['owner', 'active', 'posting', 'memo'];

async function main(): Promise<void> {
  const bundle = openBundle();
  const hc = JSON.parse(bundle.files['keys/headcorner-seed.json'] ?? '{}');
  const sm = JSON.parse(bundle.files['keys/sovereign-mnemonic.json'] ?? '{}');
  const ws = JSON.parse(bundle.files['keys/wallets-seed.json'] ?? '{}');
  const fe = JSON.parse(bundle.files['keys/fleet-evm-head-seed.json'] ?? '{}');
  const cands: Array<[string, string]> = [
    ['hc.phrase', String(hc.phrase ?? '')],
    ['hc.sovereign12', String(hc.sovereign12 ?? '')],
    ['hc.words-joined', Array.isArray(hc.words) ? hc.words.join(' ') : String(hc.words ?? '')],
    ['sm.phrase', String(sm.phrase ?? '')],
    ['sm.words-joined', Array.isArray(sm.words) ? sm.words.join(' ') : String(sm.words ?? '')],
    ['ws.seed96', String(ws.seed ?? '')],
    ['fe.seed', String(fe.seed ?? '')],
  ].filter(([_, v]) => v && v.length >= 8) as Array<[string, string]>;
  console.log('candidates: ' + cands.map(([n, v]) => n + '(len ' + v.length + ')').join(', '));

  const accounts = [...ROT1_ACCOUNTS, 'ynet'];
  const authCache = new Map<string, Record<string, string[]>>();
  for (const acct of accounts) {
    for (const chain of ['hive', 'steem'] as const) {
      try { authCache.set(acct + ':' + chain, await getAuths(chain, acct)); } catch { /* skip */ }
    }
  }
  let hits = 0;
  for (const [cName, P] of cands) {
    for (const acct of accounts) {
      for (const chain of ['hive', 'steem'] as const) {
        const A = authCache.get(acct + ':' + chain);
        if (!A) continue;
        for (const role of ROLES) {
          const seedStr = acct + role + P;
          try {
            if ((A[role] ?? []).includes(derived)) {
              console.log(`*** HIT *** ${cName} -> ${acct}/${chain}/${role} pub=${derived.slice(0, 22)}...`);
              hits++;
            }
          } catch { /* no */ }
        }
      }
    }
  }
  console.log(`\nCORNERSTONE hits: ${hits}`);
  process.exit(0);
}

// steem-js getPrivateKeys core: WIF(0x80 || sha256(seed)) — uncompressed 51ch
function wifFromSha256Seed(seed: string): string {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const priv = crypto.createHash('sha256').update(seed, 'utf8').digest();
  const payload = Buffer.concat([Buffer.from([0x80]), priv]);
  const check = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  const buf = Buffer.concat([payload, check]);
  let num = BigInt('0x' + buf.toString('hex'));
  let out = '';
  const ZERO = BigInt(0), B58N = BigInt(58);
  while (num > ZERO) { out = B58[Number(num % B58N)] + out; num /= B58N; }
  let pad = 0; while (buf[pad] === 0) { out = '1' + out; pad++; }
  return out;
}
main().catch(e => { console.error('FAILED: ' + String(e).slice(0, 200)); process.exit(1); });
