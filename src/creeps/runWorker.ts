import { isControllerUrgent } from './controllerUrgency';

type EnergyTarget =
  | StructureSpawn
  | StructureExtension
  | StructureTower;

function moveTo(creep: Creep, target: RoomObject): void {
  creep.moveTo(target, {
    reusePath: 10,
    maxRooms: 1
  });
}

function chooseSource(creep: Creep): Source | null {
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) return null;

  const assigned = new Map<string, number>();
  for (const other of Object.values(Game.creeps)) {
    if (
      other.name === creep.name ||
      other.memory.home !== creep.memory.home ||
      other.memory.kind !== 'worker' ||
      !other.memory.sourceId
    ) {
      continue;
    }

    assigned.set(
      other.memory.sourceId,
      (assigned.get(other.memory.sourceId) ?? 0) + 1
    );
  }

  sources.sort((a, b) => {
    const aAssigned = assigned.get(a.id) ?? 0;
    const bAssigned = assigned.get(b.id) ?? 0;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;
    return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });

  const source = sources[0];
  creep.memory.sourceId = source.id;
  return source;
}

function getSource(creep: Creep): Source | null {
  if (creep.memory.sourceId) {
    const existing = Game.getObjectById(creep.memory.sourceId);
    if (existing) return existing;
  }

  return chooseSource(creep);
}

function findEnergyTarget(creep: Creep): EnergyTarget | null {
  const targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (structure) => {
      if (
        structure.structureType !== STRUCTURE_SPAWN &&
        structure.structureType !== STRUCTURE_EXTENSION &&
        structure.structureType !== STRUCTURE_TOWER
      ) {
        return false;
      }

      return structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    }
  }) as EnergyTarget[];

  if (targets.length === 0) return null;

  targets.sort((a, b) => {
    const priority = (target: EnergyTarget): number => {
      if (target.structureType === STRUCTURE_SPAWN) return 0;
      if (target.structureType === STRUCTURE_EXTENSION) return 1;
      return 2;
    };

    const difference = priority(a) - priority(b);
    if (difference !== 0) return difference;
    return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });

  return targets[0];
}

function sitePriority(site: ConstructionSite): number {
  if (site.structureType === STRUCTURE_EXTENSION) return 0;
  if (site.structureType === STRUCTURE_TOWER) return 1;
  if (site.structureType === STRUCTURE_CONTAINER) return 2;
  if (site.structureType === STRUCTURE_ROAD) return 4;
  return 3;
}

function findBuildTarget(
  creep: Creep,
  includeRoads: boolean
): ConstructionSite | null {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => includeRoads || site.structureType !== STRUCTURE_ROAD
  );

  sites.sort((a, b) => {
    const priorityDifference = sitePriority(a) - sitePriority(b);
    if (priorityDifference !== 0) return priorityDifference;
    return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });

  return sites[0] ?? null;
}

function findRepairTarget(creep: Creep): Structure | null {
  const structures = creep.room.find(FIND_STRUCTURES).filter((structure) => {
    if (
      structure.structureType !== STRUCTURE_ROAD &&
      structure.structureType !== STRUCTURE_CONTAINER
    ) {
      return false;
    }

    return structure.hits < structure.hitsMax * 0.45;
  });

  structures.sort(
    (a, b) =>
      a.hits / a.hitsMax - b.hits / b.hitsMax ||
      creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b)
  );

  return structures[0] ?? null;
}

function harvest(creep: Creep): void {
  const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
    filter: (resource) =>
      resource.resourceType === RESOURCE_ENERGY && resource.amount >= 20
  });

  if (dropped && creep.pos.getRangeTo(dropped) <= 4) {
    const result = creep.pickup(dropped);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, dropped);
    return;
  }

  const source = getSource(creep);
  if (!source) return;

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) moveTo(creep, source);
  if (result === ERR_INVALID_TARGET) {
    delete creep.memory.sourceId;
  }
}

function work(creep: Creep): void {
  const controller = creep.room.controller;
  if (controller && isControllerUrgent(controller)) {
    const result = creep.upgradeController(controller);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, controller);
    return;
  }

  const energyTarget = findEnergyTarget(creep);
  if (energyTarget) {
    const result = creep.transfer(energyTarget, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, energyTarget);
    return;
  }

  const criticalSite = findBuildTarget(creep, false);
  if (criticalSite) {
    const result = creep.build(criticalSite);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, criticalSite);
    return;
  }

  const repairTarget = findRepairTarget(creep);
  if (repairTarget) {
    const result = creep.repair(repairTarget);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, repairTarget);
    return;
  }

  const roadSite = findBuildTarget(creep, true);
  if (roadSite) {
    const result = creep.build(roadSite);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, roadSite);
    return;
  }

  if (controller?.my) {
    const result = creep.upgradeController(controller);
    if (result === ERR_NOT_IN_RANGE) moveTo(creep, controller);
  }
}

export function runWorker(creep: Creep): void {
  if (creep.spawning) return;

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = false;
  } else if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
  }

  if (creep.memory.working) work(creep);
  else harvest(creep);
}
