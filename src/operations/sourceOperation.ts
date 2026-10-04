import type { WorkPosition, WorkTarget } from '../work/demands';
import { countPopulation, type PopulationCreep, type SpawningCreep } from '../spawning/population';
import type { PopulationRequest } from '../spawning/spawnPlan';
import { bodyCost } from '../spawning/body';

export interface SourceTile extends WorkPosition {
  walkable: boolean;
  placeable: boolean;
  containerId?: string;
  siteId?: string;
  routeTicks?: number;
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

// Home-room miners spend almost their whole lifetime stationary. Remote
// ingress deserves a separate body policy when remote operations are introduced.
export function localMinerBody(income: number): BodyPartConstant[] {
  const work = Math.min(5, Math.max(1, Math.ceil(income / HARVEST_POWER)));
  return [...Array<BodyPartConstant>(work).fill(WORK), CARRY, MOVE];
}

export function localMinerIngress(body: readonly BodyPartConstant[], routeTicks: number): number {
  const moves = body.filter((part) => part === MOVE).length;
  const weight = body.length - moves;
  // Conservatively include CARRY weight even though ingress is normally empty.
  // The reverse path ends at spawn range one; add a worst-case swamp tile for
  // the exact mining position and rounding. Roads deliberately get no discount.
  return moves > 0 ? Math.ceil(weight / moves) * (routeTicks + 5) : Infinity;
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
  haulTripTicks: number;
  minerIngressTicks: number;
  ready: boolean;
  enabled: boolean;
  reason: 'ready' | 'no-tile' | 'no-buffer' | 'no-path' | 'capacity' | 'haul-limit' | 'worker-recovery' | 'colony-unavailable';
}

export function planSourceOperation(input: {
  home: string; source: WorkTarget; energyCapacity: number; tile?: SourceTile;
  haulTripTicks?: number; capacity: number; functioning: boolean; workforceReady: boolean;
}): SourceOperation {
  const income = input.energyCapacity / ENERGY_REGEN_TIME;
  const miner = localMinerBody(income);
  // Buy only the CARRY needed for this trip (at least two parts), capped at
  // eight balanced pairs. Longer trips request multiple bodies below.
  const desiredPairs = Math.max(2, Math.ceil(income * (2 * (input.haulTripTicks ?? 0) + 2) * 1.2 / CARRY_CAPACITY));
  const hauler = haulerBody(Math.min(input.capacity, desiredPairs * 100));
  const haulers = haulingRequirement(income, input.haulTripTicks ?? 0,
    hauler.filter((part) => part === CARRY).length * CARRY_CAPACITY);
  const reason = !input.functioning ? 'colony-unavailable'
    : !input.tile ? 'no-tile' : !input.tile.containerId ? 'no-buffer'
      : input.capacity < bodyCost(miner) || hauler.length === 0 ? 'capacity'
        : input.haulTripTicks === undefined || input.tile.routeTicks === undefined ? 'no-path'
          : haulers > 3 ? 'haul-limit' : !input.workforceReady ? 'worker-recovery' : 'ready';
  const ready = reason === 'ready' || reason === 'worker-recovery';
  return { id: localSourceId(input.source.id), home: input.home, source: input.source, tile: input.tile,
    bufferId: input.tile?.containerId, income, minerBody: miner, haulerBody: hauler, haulers,
    haulTripTicks: input.haulTripTicks ?? 0,
    minerIngressTicks: localMinerIngress(miner, input.tile?.routeTicks ?? 0),
    ready, enabled: reason === 'ready', reason };
}

export function specialistLead(operation: SourceOperation, kind: 'miner' | 'hauler'): number {
  const body = kind === 'miner' ? operation.minerBody : operation.haulerBody;
  return body.length * CREEP_SPAWN_TIME +
    (kind === 'miner' ? operation.minerIngressTicks : operation.haulTripTicks) + 50;
}

export interface MinerCandidate {
  name: string; pos: WorkPosition; work: number; carry: number; move: number;
  spawning: boolean; ticksToLive?: number;
}

export function primaryMiner(operation: SourceOperation | undefined, creeps: readonly MinerCandidate[],
  canYield: boolean): string | undefined {
  if (!operation?.tile || !operation.ready) return undefined;
  const onTile = (c: MinerCandidate) => c.pos.roomName === operation.home && distance(c.pos, operation.tile!) === 0;
  const usable = creeps.filter((c) => !c.spawning && c.pos.roomName === operation.home &&
    c.work > 0 && c.carry > 0 && (onTile(c) || c.move > 0));
  // An immobile occupant cannot vacate safely. Keep useful mining on that tile
  // until it expires; worker fallback covers any lost WORK throughput.
  const pinned = creeps.filter((c) => !c.spawning && onTile(c) && (c.move === 0 || !canYield))
    .sort((a, b) => (a.ticksToLive ?? Infinity) - (b.ticksToLive ?? Infinity) || a.name.localeCompare(b.name))[0];
  if (pinned) return pinned.name;
  return usable.sort((a, b) => Number(b.work * HARVEST_POWER >= operation.income) -
    Number(a.work * HARVEST_POWER >= operation.income) || Number(onTile(b)) - Number(onTile(a)) ||
    (a.ticksToLive ?? Infinity) - (b.ticksToLive ?? Infinity) || a.name.localeCompare(b.name))[0]?.name;
}

export function requestSourcePopulation(operations: readonly SourceOperation[],
  creeps: readonly PopulationCreep[], spawning: readonly SpawningCreep[]): PopulationRequest[] {
  const requests: PopulationRequest[] = [];
  for (const operation of operations) {
    if (!operation.enabled) continue;
    const minerCount = countPopulation({ identity: { kind: 'miner', home: operation.home, operationId: operation.id },
      creeps, spawning, replacementLead: specialistLead(operation, 'miner') });
    for (const kind of ['miner', 'hauler'] as const) {
      // Build the producer's support chain intentionally: hauling starts only
      // once its miner is effective (including a body currently spawning).
      if (kind === 'hauler' && minerCount.effective === 0) continue;
      const identity = { kind, home: operation.home, operationId: operation.id };
      const lead = specialistLead(operation, kind);
      const count = kind === 'miner' ? minerCount
        : countPopulation({ identity, creeps, spawning, replacementLead: lead });
      const target = kind === 'miner' ? 1 : operation.haulers;
      if (count.effective >= target) continue;
      requests.push({ id: `${operation.home}:${operation.id}:${kind}`, identity, priority: 'logistics',
        body: kind === 'miner' ? operation.minerBody : operation.haulerBody, initialMemory: {},
        reason: count.aging ? 'replacement' : 'local-source',
        explanation: `[spawn] ${operation.home} ${kind} ${operation.id} ${count.effective + 1}/${target}; income=${operation.income}; haul=${operation.haulTripTicks}; ingress=${operation.minerIngressTicks}; lead=${lead}` });
    }
  }
  // Maintain established chains before adding new specialist populations.
  // Worker requests are composed separately and retain all survival priorities.
  const replacements = requests.filter((request) => request.reason === 'replacement');
  return replacements.length ? replacements : requests;
}
