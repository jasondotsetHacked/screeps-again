export function runTowers(room: Room): void {
  const towers = room
    .find(FIND_MY_STRUCTURES)
    .filter(
      (structure): structure is StructureTower =>
        structure.structureType === STRUCTURE_TOWER
    );

  if (towers.length === 0) return;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const injured = room.find(FIND_MY_CREEPS).filter(
    (creep) => creep.hits < creep.hitsMax
  );

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

    const repairTarget = tower.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (structure) =>
        (structure.structureType === STRUCTURE_ROAD ||
          structure.structureType === STRUCTURE_CONTAINER) &&
        structure.hits < structure.hitsMax * 0.35
    });

    if (repairTarget) tower.repair(repairTarget);
  }
}
