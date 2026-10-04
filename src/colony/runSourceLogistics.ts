import type { ColonyState } from './colonyState';
import { readNamedCreepIdentity } from '../creeps/identity';
import { runMiner } from '../creeps/runMiner';
import { runHauler } from '../creeps/runHauler';
import type { WorkerEnergyContext } from '../creeps/runWorker';
import { planHauling, type RefillConsumer } from '../logistics/planHauling';
import { distance, type SourceOperation } from '../operations/sourceOperation';
import type { WorkDemand } from '../work/demands';
import { recordOpsError } from '../ops/opsTelemetry';

export function runSourceLogistics(state: ColonyState, operations: readonly SourceOperation[],
  energy: WorkerEnergyContext, demands: readonly WorkDemand[]): void {
  const consumers: RefillConsumer[] = state.refillTargets.map((target) => ({ ...target,
    amount: target.freeEnergy, priority: demands.find((d) => d.kind === 'refill' && d.target.id === target.id)?.priority ?? 0 }));
  energy.consumers = consumers;
  const miners = new Map<string, Creep[]>();
  const haulers: Creep[] = [];
  for (const creep of Object.values(Game.creeps)) {
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
    const usable = (c: Creep) => !c.spawning && c.room.name === state.room.name &&
      c.getActiveBodyparts(WORK) > 0 && c.getActiveBodyparts(CARRY) > 0;
    const ordered = [...creeps].sort((a, b) => Number(usable(b)) - Number(usable(a)) ||
      Number(Boolean(operation?.tile && distance(b.pos, operation.tile) === 0)) -
      Number(Boolean(operation?.tile && distance(a.pos, operation.tile) === 0)) ||
      (a.ticksToLive ?? Infinity) - (b.ticksToLive ?? Infinity) || a.name.localeCompare(b.name));
    for (const creep of ordered) {
      try {
        if (runMiner(creep, operation, creep === ordered[0]) &&
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
      if (!runHauler(creep, operation, assignment)) continue;
      const carry = creep.getActiveBodyparts(CARRY);
      // Damaged mobility still permits useful hauling, but cannot justify
      // suppressing generalist fallback with the original throughput estimate.
      if (creep.getActiveBodyparts(MOVE) >= carry) {
        haulingCapacity.set(id, (haulingCapacity.get(id) ?? 0) + carry * CARRY_CAPACITY);
      }
      if (assignment) {
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
