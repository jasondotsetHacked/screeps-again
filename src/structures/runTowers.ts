import type { ColonyState } from '../colony/colonyState';

export function runTowers(state: Pick<ColonyState, 'towers' | 'hostiles' | 'creeps' | 'structures'>): void {
  const towers = state.towers;
  if (towers.length === 0) return;
  const hostiles = [...state.hostiles];
  const injured = state.creeps.filter((creep) => creep.hits < creep.hitsMax);
  const damaged = state.structures.filter((structure) =>
    (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) &&
    structure.hits < structure.hitsMax * 0.35);

  for (const tower of towers) {
    if (hostiles.length > 0) {
      const hostile = tower.pos.findClosestByRange(hostiles);
      if (hostile) tower.attack(hostile);
      continue;
    }

    if (injured.length > 0) {
      const target = tower.pos.findClosestByRange(injured);
      if (target) tower.heal(target);
      continue;
    }

    if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 500) continue;

    const repairTarget = tower.pos.findClosestByRange(damaged);

    if (repairTarget) tower.repair(repairTarget);
  }
}
