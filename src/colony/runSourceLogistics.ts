import type { ColonyState } from './colonyState';
import { readNamedCreepIdentity } from '../creeps/identity';
import { runMiner } from '../creeps/runMiner';
import { runHauler } from '../creeps/runHauler';
import type { WorkerEnergyContext } from '../creeps/runWorker';
import { planHauling, type RefillConsumer } from '../logistics/planHauling';
import { distance, primaryMiner, type SourceOperation } from '../operations/sourceOperation';
import { sourceTiles } from '../operations/observeSources';
import type { WorkDemand } from '../work/demands';
import { recordOpsError } from '../ops/opsTelemetry';

export function runSourceLogistics(state: ColonyState, operations: readonly SourceOperation[],
  energy: WorkerEnergyContext, demands: readonly WorkDemand[]): void {
  const consumers: RefillConsumer[] = state.refillTargets.map((target) => ({ ...target,
    amount: target.freeEnergy, priority: demands.find((d) => d.kind === 'refill' && d.target.id === target.id)?.priority ?? 0 }));
  energy.consumers = consumers;
  const miners = new Map<string, Creep[]>();
  const haulers: Creep[] = [];
  const gameCreeps = Object.values(Game.creeps);
  const occupants = [...gameCreeps, ...state.hostiles];
  for (const creep of gameCreeps) {
    const identity = readNamedCreepIdentity(creep.name, creep.memory);
    if (identity?.home !== state.room.name) continue;
    if (identity.kind === 'miner') {
      const group = miners.get(identity.operationId!) ?? [];
      group.push(creep);
      miners.set(identity.operationId!, group);
    } else if (identity.kind === 'hauler') haulers.push(creep);
  }
  const healthyMiners = new Set<string>();
  for (const [id, creeps] of miners) {
    const operation = operations.find((o) => o.id === id);
    const source = state.sources.find((s) => s.id === operation?.source.id);
    // A movable damaged incumbent must vacate its tile for a selected healthy
    // replacement. Choose a free local waiting tile above the intent executor.
    const waiting = source && operation?.tile && sourceTiles(state.room, source, state.structures, state.constructionSites)
      .find((tile) => tile.walkable && distance(tile, operation.tile!) <= 1 &&
        !operations.some((o) => o.tile && distance(tile, o.tile) === 0) &&
        !state.sources.some((s) => distance(tile, s.pos) === 0) &&
        !(state.controller && distance(tile, state.controller.pos) === 0) &&
        !occupants.some((c) => c.pos.roomName === tile.roomName && distance(c.pos, tile) === 0));
    const primary = primaryMiner(operation, creeps.map((c) => ({ name: c.name, pos: c.pos,
      work: c.getActiveBodyparts(WORK), carry: c.getActiveBodyparts(CARRY), move: c.getActiveBodyparts(MOVE),
      spawning: c.spawning, ticksToLive: c.ticksToLive })), Boolean(waiting));
    const ordered = [...creeps].sort((a, b) => a.name.localeCompare(b.name));
    for (const creep of ordered) {
      try {
        if (runMiner(creep, operation, creep.name === primary, waiting || undefined) &&
            creep.getActiveBodyparts(WORK) * HARVEST_POWER >= (operation?.income ?? Infinity)) healthyMiners.add(id);
      } catch (error) { recordOpsError('creep', creep.name, error); }
    }
  }
  const haulingCapacity = new Map<string, number>();
  for (const creep of haulers.sort((a, b) => a.name.localeCompare(b.name))) {
    const id = readNamedCreepIdentity(creep.name, creep.memory)!.operationId!;
    const operation = operations.find((o) => o.id === id);
    try {
      const assignment = planHauling({ pos: creep.pos, energy: creep.store.getUsedCapacity(RESOURCE_ENERGY),
        freeCapacity: creep.store.getFreeCapacity(RESOURCE_ENERGY) }, operation, energy.supplies, consumers);
      const execution = runHauler(creep, operation, assignment);
      if (execution === 'blocked') continue;
      const carry = creep.getActiveBodyparts(CARRY);
      // Damaged mobility still permits useful hauling, but cannot justify
      // suppressing generalist fallback with the original throughput estimate.
      if (creep.getActiveBodyparts(MOVE) >= carry) {
        haulingCapacity.set(id, (haulingCapacity.get(id) ?? 0) + carry * CARRY_CAPACITY);
      }
      if (assignment && execution === 'resource') {
        const reservation = assignment.kind === 'withdraw'
          ? energy.supplies.find((s) => s.id === assignment.target.id)
          : consumers.find((c) => c.id === assignment.target.id);
        if (reservation) reservation.amount -= assignment.amount;
      }
    } catch (error) { recordOpsError('creep', creep.name, error); }
  }
  for (const operation of operations) {
    // General labor still needs energy. Only avoid direct harvesting while a
    // complete working chain leaves at least one worker load in its buffer.
    // Loss, blocked intents, recovery, empty buffers or damaged bodies release
    // direct source access in this very tick; store access always remains.
    const buffered = energy.supplies.find((s) => s.id === operation.bufferId)?.amount ?? 0;
    const requiredCarry = operation.haulerBody.filter((p) => p === CARRY).length * CARRY_CAPACITY * operation.haulers;
    if (operation.enabled && healthyMiners.has(operation.id) &&
        (haulingCapacity.get(operation.id) ?? 0) >= requiredCarry && buffered >= CARRY_CAPACITY) {
      energy.supplies = energy.supplies.filter((s) => s.id !== operation.source.id);
    }
  }
}
