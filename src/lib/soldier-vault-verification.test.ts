// ═══ soldier-vault-verification · task 3-b, wave #82 ════════════════════════
// Owner MASTER DIRECTIVE (trace 1a178c614313ad05, §1) verification suite:
//   (a) the vault module exists and its authority surface is deny-by-default
//       (missing-token / missing-credential paths throw or deny, fail-closed);
//   (b) the AES-256-GCM encryption path round-trips using a THROWAWAY key
//       generated in-test (never a real vault key) — including GCM tamper
//       detection;
//   (c) the soldier roster/registry carries zero plaintext key fields, and the
//       saos-0004 presence state is measured honestly (absent → recorded absent).
//
// SECRETS LAW: no real WIF, no real vault key, no vault-file content is ever
// read or printed here. Every secret used below is generated at test time and
// lives only inside this process / a throwaway subprocess env.
/// <reference types="bun-types" />
import { describe, it, expect } from 'bun:test';
import crypto from 'crypto';
import { pathToFileURL } from 'node:url';
import path from 'path';

const REPO = path.resolve(import.meta.dir, '..', '..');

/** Run a throwaway bun subprocess (clean module graph) and return stdout. */
function bunEval(script: string, env?: Record<string, string | undefined>): { stdout: string; exitCode: number } {
  const e: Record<string, string | undefined> = env ?? { ...process.env };
  const p = Bun.spawnSync([process.execPath, '-e', script], {
    cwd: REPO,
    env: e as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { stdout: p.stdout.toString().trim(), exitCode: p.exitCode ?? 1 };
}

const VAULT_IMPORT = `const { pathToFileURL } = await import('node:url');
const vault = await import(pathToFileURL(process.cwd() + '/src/lib/vault.ts').href);`;

describe('§1 deny-by-default — the gate core refuses every credential-less vault/soldier path', () => {
  // pure module import — no env captured by these modules
  const { gateDecision } = require('./security-gate') as typeof import('./security-gate');
  const H = (h: Record<string, string> = {}) => new Headers(h);

  it('denies anonymous reads of the vault surface (status/estate/sovereign/addresses/treasury)', () => {
    for (const p of ['/api/vault/status', '/api/vault/estate', '/api/vault/sovereign', '/api/vault/addresses', '/api/vault/treasury']) {
      const d = gateDecision('GET', p, H(), null);
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('deny-by-default');
    }
  });

  it('denies anonymous mutations incl. vault verify + the all-soldier surface', () => {
    for (const [m, p] of [['POST', '/api/vault/verify'], ['POST', '/api/vault/login-impersonation'], ['GET', '/api/soldiers'], ['POST', '/api/soldiers'], ['DELETE', '/api/vault/status']] as const) {
      const d = gateDecision(m, p, H(), null);
      expect(d.allowed).toBe(false);
    }
  });

  it('a BARE Bearer carrier is not a credential (denied, not passed)', () => {
    expect(gateDecision('POST', '/api/vault/verify', H({ authorization: 'Bearer ' }), null).allowed).toBe(false);
    expect(gateDecision('GET', '/api/soldiers', H({ authorization: 'Bearer   ' }), null).allowed).toBe(false);
  });

  it('measured public reads stay open (health) — the allowlist is the ONLY anonymous surface', () => {
    const d = gateDecision('GET', '/api/health', H(), null);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('public-read');
  });
});

describe('(a) vault crypto module — fail-closed when the vault secret is missing/short', () => {
  it('encryptSecret THROWS in a clean process without SOVEREIGN_VAULT_SECRET (no silent empty-key crypto)', () => {
    const noSecretEnv: Record<string, string | undefined> = { ...process.env };
    delete noSecretEnv.SOVEREIGN_VAULT_SECRET;
    const r = bunEval(`${VAULT_IMPORT}
try { vault.encryptSecret('probe'); console.log('NO-THROW'); }
catch (e) { console.log('THREW:' + String(e.message).slice(0, 30)); }`, noSecretEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.startsWith('THREW:')).toBe(true);
    expect(r.stdout).not.toBe('NO-THROW');
  });

  it('a 31-char secret is still refused (32+ chars required by law)', () => {
    const shortEnv = { ...process.env, SOVEREIGN_VAULT_SECRET: 'x'.repeat(31) };
    const r = bunEval(`${VAULT_IMPORT}
try { vault.encryptSecret('probe'); console.log('NO-THROW'); }
catch (e) { console.log('THREW'); }`, shortEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('THREW');
  });
});

describe('(b) AES-256-GCM round-trip with a THROWAWAY in-test key (never a real vault key)', () => {
  it('encryptSecret → decryptSecret round-trips exactly under a fresh in-test vault secret', () => {
    const throwaway = crypto.randomBytes(48).toString('hex'); // generated NOW, dies with the process
    const env = { ...process.env, SOVEREIGN_VAULT_SECRET: throwaway };
    const probe = JSON.stringify({ soldier: 'roundtrip-probe', wifLike: '5' + 'J'.repeat(50), n: 7 });
    const r = bunEval(`${VAULT_IMPORT}
const probe = ${JSON.stringify(probe)};
const sealed = vault.encryptSecret(probe);
const parts = sealed.split(':');
console.log(JSON.stringify({ parts: parts.length, ivLen: parts[0].length, tagLen: parts[1].length, back: vault.decryptSecret(sealed) === probe, printed: false }));`, env);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { parts: number; ivLen: number; tagLen: number; back: boolean };
    expect(out.parts).toBe(3);          // iv:tag:ct envelope
    expect(out.ivLen).toBe(24);         // 12-byte IV hex
    expect(out.tagLen).toBe(32);        // 16-byte GCM tag hex
    expect(out.back).toBe(true);
  });

  it('GCM auth-tag integrity: one flipped ciphertext bit makes decryptSecret THROW', () => {
    const throwaway = crypto.randomBytes(48).toString('hex');
    const env = { ...process.env, SOVEREIGN_VAULT_SECRET: throwaway };
    const r = bunEval(`${VAULT_IMPORT}
const sealed = vault.encryptSecret('tamper-probe');
const [iv, tag, ct] = sealed.split(':');
const flipped = (parseInt(ct[0], 16) ^ 1).toString(16) + ct.slice(1);
try { vault.decryptSecret(iv + ':' + tag + ':' + flipped); console.log('NO-THROW'); }
catch { console.log('THREW'); }`, env);
    expect(r.stdout).toBe('THREW');
  });

  it('repo-vault envelope crypto (seal-shard AES-256-GCM) round-trips and detects tamper with a throwaway key', async () => {
    const rv = await import(pathToFileURL(path.join(REPO, 'src/lib/repo-vault.ts')).href);
    const key = crypto.randomBytes(32); // throwaway — sha256(seal.a ⊕ seal.b) is what prod uses
    const env1 = rv.encryptWithKey('wallet-roundtrip-probe', key);
    expect(rv.decryptWithKey(env1, key)).toBe('wallet-roundtrip-probe');
    const tampered = { ...env1, ct: env1.ct.slice(0, -2) + (env1.ct.endsWith('00') ? '11' : '00') };
    expect(() => rv.decryptWithKey(tampered, key)).toThrow();
    // seal shards: 2-of-2 XOR — the rebuilt key must equal the minted key (shard math self-consistent)
    const seal = rv.generateSeal();
    const reopened = rv.sealKeyFromShards(seal.a, seal.b);
    expect(Buffer.compare(reopened, seal.key)).toBe(0);
  });
});

describe('(c) soldier roster/registry — zero plaintext key fields; saos-0004 presence measured honestly', () => {
  const activation = require('./soldier-activation') as typeof import('./soldier-activation');
  const keysMod = require('./keys') as typeof import('./keys');

  it('every roster entry is a bare account name — no object, no WIF/seed/pubkey material anywhere', () => {
    for (const s of activation.SOLDIER_ROSTER) {
      expect(typeof s).toBe('string');
      expect(/^[a-z0-9-]+$/.test(s)).toBe(true); // account-shape only
      expect(/^[5KLP][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s)).toBe(false); // never a WIF
      expect(s.length).toBeLessThan(32);
    }
    // registry ⊇ roster: the ROT1 derivation registry must hold exactly the same identities
    expect([...keysMod.ROT1_ACCOUNTS].sort()).toEqual([...activation.SOLDIER_ROSTER].sort());
  });

  it('activation surface objects expose only the audited field set — no key/cipher/seed field can ever appear', () => {
    const surface = activation.buildSoldierActivationSurface({
      roster: activation.SOLDIER_ROSTER,
      mesh: { online: false, planId: null, lastBeatAt: null, moves: [] },
      legionOnline: false,
      legionFleet: [],
    });
    const LAWFUL_FIELDS = new Set(['account', 'rcPct', 'meshPlanId', 'meshPlanned', 'legionEnabled', 'legionStoppedReason', 'activationState']);
    for (const s of surface.soldiers) {
      for (const k of Object.keys(s)) expect(LAWFUL_FIELDS.has(k)).toBe(true);
    }
  });

  it('the full all-soldier mesh census (G78-a): 13 army bodies + headcorner + saos-0004, registered in BOTH registries', () => {
    const ARMY = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'hcsoldier4', 'hcsoldier5', 'hcsoldier6'];
    const roster = activation.SOLDIER_ROSTER as readonly string[];
    const rot1 = keysMod.ROT1_ACCOUNTS;
    // every army body is registered in both registries — the census is 15/15 names
    for (const a of ARMY) {
      expect(roster.includes(a)).toBe(true);
      expect(rot1.includes(a)).toBe(true);
    }
    expect(roster.includes('headcorner')).toBe(true);
    expect(rot1.includes('headcorner')).toBe(true);
    expect(roster.includes('saos-0004')).toBe(true);
    expect(rot1.includes('saos-0004')).toBe(true);
    // the mesh balances the same census (three-roster sync law)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mesh = require('../../mini-services/rc-rebalance/index') as typeof import('../../mini-services/rc-rebalance/index');
    const meshRoster = mesh.DEFAULT_ROSTER as readonly string[];
    for (const a of [...ARMY, 'headcorner', 'saos-0004']) expect(meshRoster.includes(a)).toBe(true);
  });

  it('saos-0004 + hcsoldier4/5/6 presence state — measured, not assumed (registered since G77-a/G78-a)', () => {
    // The honest measured truth: saos-0004 was wire-in registered by G77-a (fuel mesh),
    // and G78-a completed the census with hcsoldier4/5/6 — the pre-G78 pin ("absent")
    // was updated with the same plaintext-field audit, never silently.
    const inRoster = (activation.SOLDIER_ROSTER as readonly string[]).includes('saos-0004');
    const inRot1 = keysMod.ROT1_ACCOUNTS.includes('saos-0004');
    expect(inRoster).toBe(true);
    expect(inRot1).toBe(true);
    for (const s of ['hcsoldier4', 'hcsoldier5', 'hcsoldier6']) {
      expect((activation.SOLDIER_ROSTER as readonly string[]).includes(s)).toBe(true);
      expect(keysMod.ROT1_ACCOUNTS.includes(s)).toBe(true);
    }
  });
});

describe('fleet-enc envelope — fail-closed decode (wave-80 vault-auth lineage)', () => {
  const fk = require('./fleet-keys-decode') as typeof import('./fleet-keys-decode');
  it('junk input throws honestly (MAGIC missing in every known format)', () => {
    expect(() => fk.decodeFleetEnc('not-a-fleet-envelope')).toThrow(/MAGIC/);
    expect(() => fk.decodeFleetEnc('SAOS-FLEET-VAULT-1' + 'zz')).toThrow(); // bad hex / short payload
  });
  it('the FLEET_MAGIC contract is the sealed-fleet envelope, not a key', () => {
    expect(fk.FLEET_MAGIC).toBe('SAOS-FLEET-VAULT-1');
  });
});
