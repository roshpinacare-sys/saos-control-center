// ═══ ציד-הפוסטים-הוותיקים v3 (EXEC-CD-27) ═════════════════════════════════════
// get_blog(entry_id-עולה) + fallback get_discussions_by_blog(start_permlink) ·
// מסנן: matic/polygon/mint/airdrop/token/0x · שמירה: research/matic-hunt.json
const RPC = 'https://api.steemit.com';
const ACCOUNTS = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 120)}`);
  return j.result;
}

const HEXADDR = /0x[a-fA-F0-9]{40}/g;
const seen = new Set<string>();

function classify(c: any): { why: string[]; addrs: string[] } | null {
  const body: string = c.body || '';
  const permlink: string = c.permlink || '';
  const addrs = [...new Set(body.match(HEXADDR) ?? [])];
  const why: string[] = [];
  if (/matic|polygon/i.test(body + ' ' + permlink + ' ' + (c.title || ''))) why.push('matic');
  if (/mint|מינט/i.test(body)) why.push('mint');
  if (/airdrop|איירדרופ/i.test(body)) why.push('airdrop');
  if (/token|טוקן/i.test(body)) why.push('token');
  if (addrs.length) why.push(`0x×${addrs.length}`);
  if (!why.length) return null;
  return { why, addrs };
}

function keepHit(c: any, why: string[]): boolean {
  const created: string = c.created || '';
  return created < '2023-01-01' || why.some(w => w === 'matic' || w.startsWith('0x'));
}

function pushHit(all: any[], account: string, c: any, why: string[], addrs: string[]) {
  const k = `${account}/${c.permlink}`;
  if (seen.has(k)) return;
  seen.add(k);
  all.push({ account, permlink: c.permlink, created: c.created, title: (c.title || '').slice(0, 80), why: why.join('+'), addrs: addrs.slice(0, 8) });
}

async function scanGetBlog(account: string, all: any[]): Promise<number> {
  let start = 0, total = 0, guard = 0;
  while (guard++ < 60) {
    let entries: any[];
    try { entries = await rpc('condenser_api.get_blog', [account, start, 100]); }
    catch (e) { return -1; } // fall back
    if (!entries || !entries.length) break;
    for (const e of entries) {
      const c = e.comment;
      if (!c || c.parent_author) continue;
      total++;
      const r = classify(c);
      if (r && keepHit(c, r.why)) pushHit(all, account, c, r.why, r.addrs);
    }
    const maxId = Math.max(...entries.map((x: any) => x.entry_id ?? 0));
    start = maxId + 1;
    if (entries.length < 100) break;
  }
  return total;
}

async function scanDiscByBlog(account: string, all: any[]): Promise<number> {
  let startPermlink = '', total = 0, guard = 0;
  while (guard++ < 120) {
    const q: any = { tag: account, limit: 100 };
    if (startPermlink) q.start_permlink = startPermlink;
    let posts: any[];
    try { posts = await rpc('condenser_api.get_discussions_by_blog', [q]); }
    catch (e) { console.log(`  [${account}] disc-fail: ${(e as Error).message.slice(0, 90)}`); break; }
    if (!posts || !posts.length) break;
    for (const c of posts) {
      if (c.author !== account || c.parent_author) continue;
      total++;
      const r = classify(c);
      if (r && keepHit(c, r.why)) pushHit(all, account, c, r.why, r.addrs);
    }
    const oldest = posts[posts.length - 1];
    if (!oldest?.created || oldest.created < '2017-01-01') break;
    startPermlink = oldest.permlink;
    if (posts.length < 100) break;
  }
  return total;
}

const all: any[] = [];
for (const a of ACCOUNTS) {
  let n = await scanGetBlog(a, all);
  if (n < 0) { n = await scanDiscByBlog(a, all); console.log(`[${a}] (disc-by-blog) scanned=${n}`); }
  else console.log(`[${a}] (get_blog) scanned=${n}`);
}
await Bun.write('/home/z/my-project/research/matic-hunt.json', JSON.stringify(all, null, 2));
console.log(`\nsaved ${all.length} unique hits → research/matic-hunt.json`);
for (const h of all.filter(x => x.created < '2023-01-01').slice(0, 40)) {
  console.log(`★ ${h.created} [${h.account}] [${h.why}] ${h.title}`);
  if (h.addrs.length) console.log(`   ${h.addrs.join(', ')}`);
}
