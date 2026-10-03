import type { ColonyState } from '../colony/colonyState';
import type { WorkerAssignment } from '../work/assignments';

export interface WorkerEnergyContext {
  sources: readonly Source[];
  droppedEnergy: Resource[];
  sourceAssignments: Map<string, number>;
}

export function workerEnergyContext(state: ColonyState): WorkerEnergyContext {
  const sourceAssignments = new Map<string, number>();
  for (const worker of state.workerCreeps) {
    const id = worker.memory.sourceId;
    if (id) sourceAssignments.set(id, (sourceAssignments.get(id) ?? 0) + 1);
  }
  return { sources: state.sources, sourceAssignments, droppedEnergy: state.droppedEnergy };
}

function moveTo(creep: Creep, target: RoomObject): void {
  creep.moveTo(target, {
    reusePath: 10,
    maxRooms: 1
  });
}

function getSource(creep: Creep, context: WorkerEnergyContext): Source | null {
  const existing = context.sources.find((source) => source.id === creep.memory.sourceId);
  if (existing) return existing;
  let best: Source | undefined;
  for (const source of context.sources) {
    const assignedDifference = (context.sourceAssignments.get(source.id) ?? 0) -
      (best ? context.sourceAssignments.get(best.id) ?? 0 : 0);
    const distanceDifference = best ? creep.pos.getRangeTo(source) - creep.pos.getRangeTo(best) : 0;
    if (!best || assignedDifference < 0 ||
        (assignedDifference === 0 && (distanceDifference < 0 ||
          (distanceDifference === 0 && source.id.localeCompare(best.id) < 0)))) {
      best = source;
    }
  }
  if (!best) return null;
  const old = creep.memory.sourceId;
  if (old) context.sourceAssignments.set(old, Math.max(0, (context.sourceAssignments.get(old) ?? 0) - 1));
  creep.memory.sourceId = best.id;
  context.sourceAssignments.set(best.id, (context.sourceAssignments.get(best.id) ?? 0) + 1);
  return best;
}

function harvest(creep: Creep, context: WorkerEnergyContext): void {
  const dropped = creep.pos.findClosestByRange(context.droppedEnergy);

  if (dropped && creep.pos.getRangeTo(dropped) <= 4) {
    const result = creep.pickup(dropped);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, dropped);
    return;
  }

  const source = getSource(creep, context);
  if (!source) return;

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) moveTo(creep, source);
  if (result === ERR_INVALID_TARGET) {
    context.sourceAssignments.set(source.id, Math.max(0, (context.sourceAssignments.get(source.id) ?? 0) - 1));
    delete creep.memory.sourceId;
  }
}

function execute(creep: Creep, assignment: WorkerAssignment): void {
  const target = Game.getObjectById(assignment.targetId as Id<Structure | ConstructionSite>);
  if (!target) return; // Completed/destroyed targets are reconsidered next tick.
  let result: number;
  switch (assignment.kind) {
    case 'refill':
      result = creep.transfer(target as StructureSpawn | StructureExtension | StructureTower, RESOURCE_ENERGY);
      break;
    case 'build': result = creep.build(target as ConstructionSite); break;
    case 'repair': result = creep.repair(target as Structure); break;
    case 'upgrade': result = creep.upgradeController(target as StructureController); break;
  }
  if (result === ERR_NOT_IN_RANGE) moveTo(creep, target);
}

export function runWorker(
  creep: Creep,
  assignment: WorkerAssignment | undefined,
  energy: WorkerEnergyContext
): void {
  if (creep.spawning) return;
  const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  if (carried === 0) {
    creep.memory.working = false;
  } else if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
  }

  // An empty assigned worker still acquires energy. Emergency service uses
  // even a partial load immediately; normal work retains fill/use hysteresis.
  if (carried > 0 && (creep.memory.working || assignment?.emergency)) {
    if (assignment) execute(creep, assignment);
  } else {
    harvest(creep, energy);
  }
}
