import type { WorkPosition, WorkTarget } from '../work/demands';
import { countPopulation, type PopulationCreep, type SpawningCreep } from '../spawning/population';
import type { PopulationRequest } from '../spawning/spawnPlan';
import { bodyCost } from '../spawning/body';

export interface SourceTile extends WorkPosition {
  walkable: boolean;
  placeable: boolean;
  containerId?: string;
  siteId?: string;
}

export function localSourceId(sourceId: string): string { return `source:${sourceId}`; }
export function distance(a: WorkPosition, b: WorkPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Already-built buffers win, then valid sites, then empty tiles toward spawn.
// Input is just eight adjacent numeric observations; no terrain/path Memory.
export function selectSourceTile(tiles: readonly SourceTile[], anchor: WorkPosition): SourceTile | undefined {
  return tiles.filter((tile) => tile.walkable && (tile.containerId || tile.siteId || tile.placeable))
    .sort((a, b) => Number(Boolean(b.containerId)) - Number(Boolean(a.containerId)) ||
      Number(Boolean(b.siteId)) - Number(Boolean(a.siteId)) || distance(a, anchor) - distance(b, anchor) ||
      a.y - b.y || a.x - b.x)[0];
}

export function minerBody(income: number): BodyPartConstant[] {
  const work = Math.min(5, Math.max(1, Math.ceil(income / HARVEST_POWER)));
  return [...Array<BodyPartConstant>(work).fill(WORK), CARRY,
    ...Array<BodyPartConstant>(Math.ceil((work + 1) / 2)).fill(MOVE)];
}

export function haulerBody(capacity: number): BodyPartConstant[] {
  const pairs = Math.min(8, Math.floor(capacity / 100));
  return Array.from({ length: Math.max(0, pairs) }, () => [CARRY, MOVE]).flat();
}

export function haulingRequirement(income: number, oneWayTicks: number, carryCapacity: number): number {
  // Two action ticks, plus 20% travel/slack for local congestion.
  return carryCapacity > 0 ? Math.max(1, Math.ceil(income * (2 * oneWayTicks + 2) * 1.2 / carryCapacity)) : Infinity;
}

export interface SourceOperation {
  id: string;
  home: string;
  source: WorkTarget;
  tile?: SourceTile;
  bufferId?: string;
  income: number;
  minerBody: BodyPartConstant[];
  haulerBody: BodyPartConstant[];
  haulers: number;
  travelTicks: number;
  ready: boolean;
  enabled: boolean;
  reason: 'ready' | 'no-tile' | 'no-buffer' | 'no-path' | 'capacity' | 'haul-limit' | 'worker-recovery' | 'colony-unavailable';
}

export function planSourceOperation(input: {
  home: string; source: WorkTarget; energyCapacity: number; tile?: SourceTile;
  travelTicks?: number; capacity: number; functioning: boolean; workforceReady: boolean;
}): SourceOperation {
  const income = input.energyCapacity / ENERGY_REGEN_TIME;
  const miner = minerBody(income);
  // Buy only the CARRY needed for this trip (at least two parts), capped at
  // eight balanced pairs. Longer trips request multiple bodies below.
  const desiredPairs = Math.max(2, Math.ceil(income * (2 * (input.travelTicks ?? 0) + 2) * 1.2 / CARRY_CAPACITY));
  const hauler = haulerBody(Math.min(input.capacity, desiredPairs * 100));
  const haulers = haulingRequirement(income, input.travelTicks ?? 0,
    hauler.filter((part) => part === CARRY).length * CARRY_CAPACITY);
  const reason = !input.functioning ? 'colony-unavailable'
    : !input.tile ? 'no-tile' : !input.tile.containerId ? 'no-buffer'
      : input.capacity < bodyCost(miner) || hauler.length === 0 ? 'capacity'
        : input.travelTicks === undefined ? 'no-path'
          : haulers > 3 ? 'haul-limit' : !input.workforceReady ? 'worker-recovery' : 'ready';
  const ready = reason === 'ready' || reason === 'worker-recovery';
  return { id: localSourceId(input.source.id), home: input.home, source: input.source, tile: input.tile,
    bufferId: input.tile?.containerId, income, minerBody: miner, haulerBody: hauler, haulers,
    travelTicks: input.travelTicks ?? 0, ready, enabled: reason === 'ready', reason };
}

export function specialistLead(operation: SourceOperation, kind: 'miner' | 'hauler'): number {
  const body = kind === 'miner' ? operation.minerBody : operation.haulerBody;
  // Miner has 3 MOVE for 6 non-MOVE parts; loaded swamp travel takes two times
  // the hauler's conservative travel estimate. Include spawn queue headroom.
  return body.length * CREEP_SPAWN_TIME + operation.travelTicks * (kind === 'miner' ? 2 : 1) + 50;
}

export function requestSourcePopulation(operations: readonly SourceOperation[],
  creeps: readonly PopulationCreep[], spawning: readonly SpawningCreep[]): PopulationRequest[] {
  const requests: PopulationRequest[] = [];
  for (const operation of operations) {
    if (!operation.enabled) continue;
    for (const kind of ['miner', 'hauler'] as const) {
      const identity = { kind, home: operation.home, operationId: operation.id };
      const lead = specialistLead(operation, kind);
      const count = countPopulation({ identity, creeps, spawning, replacementLead: lead });
      const target = kind === 'miner' ? 1 : operation.haulers;
      if (count.effective >= target) continue;
      requests.push({ id: `${operation.home}:${operation.id}:${kind}`, identity, priority: 'logistics',
        body: kind === 'miner' ? operation.minerBody : operation.haulerBody, initialMemory: {},
        reason: count.aging ? 'replacement' : 'local-source',
        explanation: `[spawn] ${operation.home} ${kind} ${operation.id} ${count.effective + 1}/${target}; income=${operation.income}; travel=${operation.travelTicks}; lead=${lead}` });
    }
  }
  return requests;
}
