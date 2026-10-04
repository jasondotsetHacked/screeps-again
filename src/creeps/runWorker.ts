import type { ColonyState } from '../colony/colonyState';
import { planWorkerEnergyAccess, type EnergySupply } from '../colony/planEnergy';
import type { WorkerAssignment } from '../work/assignments';
import type { WorkerExecution } from '../work/execution';
import type { RefillConsumer } from '../logistics/planHauling';

export interface WorkerEnergyContext {
  supplies: EnergySupply[];
  sourceWork: Map<string, number>;
  consumers?: RefillConsumer[];
  fallbackSupplies?: EnergySupply[];
}

export function workerEnergyContext(state: ColonyState): WorkerEnergyContext {
  const sourceWork = new Map<string, number>();
  for (const worker of state.workerCreeps) {
    const id = worker.memory.sourceId;
    if (id && !worker.spawning) sourceWork.set(id,
      (sourceWork.get(id) ?? 0) + worker.getActiveBodyparts(WORK));
  }
  return { supplies: state.energySupplies.map((supply) => ({ ...supply })), sourceWork };
}

function outcome(creep: Creep, target: RoomObject, result: number,
  phase: 'acquire' | 'work'): WorkerExecution {
  if (result === ERR_NOT_IN_RANGE) {
    const movement = creep.moveTo(target, { reusePath: 10, maxRooms: 1 });
    return { creepName: creep.name, phase: movement === OK ? 'travel' : 'blocked', accepted: false };
  }
  return { creepName: creep.name, phase: result === OK ? phase : 'blocked', accepted: result === OK };
}

function acquire(creep: Creep, context: WorkerEnergyContext): WorkerExecution {
  const work = creep.getActiveBodyparts(WORK);
  const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const consumer = { pos: creep.pos, work,
    move: creep.getActiveBodyparts(MOVE), freeCapacity, sourceId: creep.memory.sourceId
  };
  const { supply, releaseFallback } = planWorkerEnergyAccess(consumer, context.supplies,
    context.fallbackSupplies ?? [], context.sourceWork);
  if (releaseFallback) {
    context.supplies.push(...context.fallbackSupplies!);
    context.fallbackSupplies = [];
  }
  const target = supply && Game.getObjectById(supply.id as Id<Source | Resource | StructureContainer | Tombstone | Ruin>);
  if (!supply || !target) return { creepName: creep.name, phase: 'blocked', accepted: false };

  let result: number;
  if (supply.kind === 'harvest') {
    const old = creep.memory.sourceId;
    if (old !== supply.id) {
      if (old) context.sourceWork.set(old, Math.max(0, (context.sourceWork.get(old) ?? 0) - work));
      creep.memory.sourceId = supply.id as Id<Source>;
      context.sourceWork.set(supply.id, (context.sourceWork.get(supply.id) ?? 0) + work);
    }
    // harvest checks source energy before range. Move explicitly while waiting
    // for a depleted source, rather than standing far away until it refills.
    result = (target as Source).energy === 0 && creep.pos.getRangeTo(target) > 1
      ? ERR_NOT_IN_RANGE : creep.harvest(target as Source);
    if (result === OK) supply.amount = Math.max(0, supply.amount - Math.min(freeCapacity, work * HARVEST_POWER));
    if (result === ERR_INVALID_TARGET) {
      context.sourceWork.set(supply.id, Math.max(0, (context.sourceWork.get(supply.id) ?? 0) - work));
      delete creep.memory.sourceId;
    }
  } else {
    const amount = Math.min(freeCapacity, supply.amount);
    result = supply.kind === 'pickup' ? creep.pickup(target as Resource)
      : creep.withdraw(target as StructureContainer | Tombstone | Ruin, RESOURCE_ENERGY, amount);
    // Only accepted resource intents consume this tick's projection. Travel
    // (successful or failed) leaves energy available to in-range consumers.
    const execution = outcome(creep, target, result, 'acquire');
    if (execution.accepted) supply.amount -= amount;
    return execution;
  }
  return outcome(creep, target, result, 'acquire');
}

function execute(creep: Creep, assignment: WorkerAssignment, energy: WorkerEnergyContext): WorkerExecution {
  const target = Game.getObjectById(assignment.targetId as Id<Structure | ConstructionSite>);
  if (!target) return { creepName: creep.name, phase: 'blocked', accepted: false };
  let result: number;
  switch (assignment.kind) {
    case 'refill': {
      const consumer = energy.consumers?.find((c) => c.id === assignment.targetId);
      const amount = consumer ? Math.min(consumer.amount, creep.store.getUsedCapacity(RESOURCE_ENERGY)) : undefined;
      if (amount === 0) return { creepName: creep.name, phase: 'idle', accepted: false };
      result = creep.transfer(target as StructureSpawn | StructureExtension | StructureTower, RESOURCE_ENERGY, amount);
      const execution = outcome(creep, target, result, 'work');
      if (consumer && execution.accepted) consumer.amount -= amount!;
      return execution;
    }
    case 'build': result = creep.build(target as ConstructionSite); break;
    case 'repair': result = creep.repair(target as Structure); break;
    case 'upgrade': result = creep.upgradeController(target as StructureController); break;
  }
  return outcome(creep, target, result, 'work');
}

export function runWorker(creep: Creep, assignment: WorkerAssignment | undefined,
  energy: WorkerEnergyContext): WorkerExecution {
  if (creep.spawning) return { creepName: creep.name, phase: 'spawning', accepted: false };
  const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  if (carried === 0) creep.memory.working = false;
  else if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) creep.memory.working = true;

  // Emergency service uses partial loads. Normal work retains fill/use
  // hysteresis; an empty assigned worker visits an energy supply first.
  if (carried > 0 && (creep.memory.working || assignment?.emergency)) {
    return assignment ? execute(creep, assignment, energy)
      : { creepName: creep.name, phase: 'idle', accepted: false };
  }
  return acquire(creep, energy);
}
