// ═══ soldier-activation tests — the deterministic activation verdict law ══════

import { describe, expect, test } from 'bun:test';
import { buildSoldierActivationSurface, SOLDIER_ROSTER, type MeshSurfaceInput, type LegionFleetEntry } from './soldier-activation';

const MESH_ONLINE: MeshSurfaceInput = { online: true, planId: 'a'.repeat(64), lastBeatAt: '2026-10-26T14:00:00.000Z', moves: [{ from: 'whale', to: 'haran' }] };
const MESH_OFFLINE: MeshSurfaceInput = { online: false, planId: null, lastBeatAt: null, moves: [] };

function legion(entries: (Partial<LegionFleetEntry> & { name: string })[]): LegionFleetEntry[] {
  return entries.map((e) => ({ fallen: e.name, ...e }) as LegionFleetEntry);
}

describe('soldier-activation: deterministic verdicts', () => {
  test('mesh-planned soldiers are rebalancing — precedence over legion state', () => {
    const surface = buildSoldierActivationSurface({
      roster: ['haran', 'headcorner'],
      mesh: MESH_ONLINE,
      legionOnline: true,
      legionFleet: legion([{ name: 'haran', enabled: true }, { name: 'headcorner', enabled: true }]),
    });
    expect(surface.soldiers.find((s) => s.account === 'haran')?.activationState).toBe('rebalancing');
    expect(surface.soldiers.find((s) => s.account === 'haran')?.meshPlanned).toBe(true);
    expect(surface.counts.rebalancing).toBe(1);
  });

  test('legion active/stopped/unlisted mapping is exact and honest', () => {
    const surface = buildSoldierActivationSurface({
      roster: ['headcorner', 'lsa', 'tov', 'ghost'],
      mesh: MESH_OFFLINE,
      legionOnline: true,
      legionFleet: legion([
        { name: 'headcorner', enabled: true, stoppedReason: null },
        { name: 'lsa', enabled: false },
        { name: 'tov', enabled: true, stoppedReason: 'daily-stop-loss' },
      ]),
    });
    const by = new Map(surface.soldiers.map((s) => [s.account, s]));
    expect(by.get('headcorner')?.activationState).toBe('active');
    expect(by.get('lsa')?.activationState).toBe('stopped');
    expect(by.get('tov')?.activationState).toBe('stopped');
    expect(by.get('tov')?.legionStoppedReason).toBe('daily-stop-loss');
    // 'ghost' is on-chain identity without a legion agent — honest, not fabricated
    expect(by.get('ghost')?.activationState).toBe('unlisted');
    expect(by.get('ghost')?.legionEnabled).toBeNull();
    expect(surface.counts).toEqual({ rebalancing: 0, active: 1, stopped: 2, idle: 0, unlisted: 1 });
  });

  test('mesh offline → mesh fields null, moves never fabricated, verdicts still honest', () => {
    const surface = buildSoldierActivationSurface({
      roster: ['haran'],
      mesh: MESH_OFFLINE,
      legionOnline: false,
      legionFleet: [],
    });
    const s = surface.soldiers[0];
    expect(surface.meshOnline).toBe(false);
    expect(surface.legionOnline).toBe(false);
    expect(s.meshPlanId).toBeNull();
    expect(s.meshPlanned).toBe(false);
    expect(s.rcPct).toBeNull();
    expect(s.activationState).toBe('unlisted');
  });

  test('rcPct flows from the mesh measurement when provided', () => {
    const surface = buildSoldierActivationSurface({
      roster: ['whale'],
      mesh: MESH_ONLINE,
      legionOnline: false,
      legionFleet: [],
      rcByAccount: { whale: 93.42 },
    });
    expect(surface.soldiers[0].rcPct).toBe(93.42);
  });

  test('canon roster is the 11 ROT1 soldiers (kept in sync across the three surfaces)', () => {
    expect(SOLDIER_ROSTER).toHaveLength(11);
    expect(SOLDIER_ROSTER).toContain('headcorner');
  });
});
