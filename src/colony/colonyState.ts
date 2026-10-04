import { buildWorkerBody, replacementLeadTicks } from '../spawning/workerBody';
import { readNamedCreepIdentity, samePopulation } from '../creeps/identity';
import { planWorkerPopulation, workerTarget, type WorkerPopulation } from '../spawning/workerPlan';
import type { WorkTarget, WorkPosition } from '../work/demands';
import type { EnergySupply } from './planEnergy';
import { observeSafety, type CriticalTarget, type HostileThreat, type SafetyTower } from './safetyState';

export interface ColonyWorker {
  name: string;
  pos: WorkPosition;
  work: number;
  carry: number;
  move: number;
  energy: number;
  working: boolean;
}

export interface ColonyState {
  room: Room;
  controller?: WorkTarget & {
    my: boolean;
    level: number;
    ticksToDowngrade: number;
    downgradeLimit: number;
    safeMode: number;
    safeModeAvailable: number;
    safeModeCooldown: number;
    upgradeBlocked: number;
  };
  energy: { available: number; capacity: number };
  sources: readonly Source[];
  structures: readonly Structure[];
  constructionSites: readonly ConstructionSite[];
  spawns: readonly StructureSpawn[];
  towers: readonly StructureTower[];
  hostiles: readonly Creep[];
  droppedEnergy: Resource[];
  energySupplies: readonly EnergySupply[];
  hostileThreats: readonly HostileThreat[];
  criticalTargets: readonly CriticalTarget[];
  defenseTowers: readonly SafetyTower[];
  creeps: readonly Creep[];
  workerCreeps: readonly Creep[];
  workers: readonly ColonyWorker[];
  population: WorkerPopulation;
  replacementLead: number;
  refillTargets: readonly (WorkTarget & { structureType: StructureConstant; freeEnergy: number })[];
  buildTargets: readonly (WorkTarget & { structureType: StructureConstant; remaining: number })[];
  repairTargets: readonly (WorkTarget & { health: number; missingHits: number })[];
}

export function workTarget(object: { id: string; pos: RoomPosition }): WorkTarget {
  return { id: object.id, pos: {
    x: object.pos.x, y: object.pos.y, roomName: object.pos.roomName
  } };
}

// One observation at the colony boundary; numeric projections keep planners
// independent of Game/Memory and action methods. Runtime objects are tick-local.
export function observeColony(room: Room): ColonyState {
  const sources = room.find(FIND_SOURCES);
  const structures = room.find(FIND_STRUCTURES);
  const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const creeps = room.find(FIND_MY_CREEPS);
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const droppedEnergy = room.find(FIND_DROPPED_RESOURCES).filter((resource) =>
    resource.resourceType === RESOURCE_ENERGY && resource.amount >= 20);
  const tombstones = room.find(FIND_TOMBSTONES);
  const ruins = room.find(FIND_RUINS);
  const spawns = structures.filter((s): s is StructureSpawn =>
    s.structureType === STRUCTURE_SPAWN && (s as StructureSpawn).my);
  const towers = structures.filter((s): s is StructureTower =>
    s.structureType === STRUCTURE_TOWER && (s as StructureTower).my);
  const gameCreeps = Object.values(Game.creeps);
  const workerCreeps = gameCreeps.filter((creep) => {
    const identity = readNamedCreepIdentity(creep.name, creep.memory);
    return identity !== null && samePopulation(identity, { home: room.name, kind: 'worker' });
  });
  const plannedBody = buildWorkerBody(room.energyCapacityAvailable);
  const replacementLead = plannedBody.length ? replacementLeadTicks(plannedBody) : 0;
  const spawning = spawns.flatMap((spawn) => {
    const name = spawn.spawning?.name;
    return name ? [{ name, memory: Memory.creeps[name] }] : [];
  });
  const spawningNames = new Set(spawning.map((worker) => worker.name));
  const workers = workerCreeps.filter((creep) =>
    !creep.spawning && !spawningNames.has(creep.name) && creep.room.name === room.name
  ).map((creep): ColonyWorker => {
    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    return {
      name: creep.name,
      pos: { x: creep.pos.x, y: creep.pos.y, roomName: creep.room.name },
      work: creep.getActiveBodyparts(WORK),
      carry: creep.getActiveBodyparts(CARRY),
      move: creep.getActiveBodyparts(MOVE), energy,
      working: energy > 0 && (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 || Boolean(creep.memory.working))
    };
  });
  const controller = room.controller;
  // Do not drain spawning/defense pools. Containers and recovered stores are
  // general supplies; hostile ramparts make supplies on their tile inaccessible.
  const inaccessible = new Set(structures.filter((s) =>
    s.structureType === STRUCTURE_RAMPART && !(s as StructureRampart).my &&
    !(s as StructureRampart).isPublic
  ).map((s) => `${s.pos.x},${s.pos.y}`));
  const energySupplies: EnergySupply[] = [
    ...sources.map((source): EnergySupply => ({ ...workTarget(source), kind: 'harvest',
      amount: source.energy, regeneration: source.ticksToRegeneration })),
    ...droppedEnergy.map((drop): EnergySupply => ({ ...workTarget(drop), kind: 'pickup', amount: drop.amount })),
    ...[...structures.filter((s): s is StructureContainer | StructureStorage => s.structureType === STRUCTURE_CONTAINER ||
      (s.structureType === STRUCTURE_STORAGE && (s as StructureStorage).my && s.isActive())),
      ...tombstones, ...ruins].flatMap((store): EnergySupply[] => {
      const amount = store.store.getUsedCapacity(RESOURCE_ENERGY);
      return amount > 0 ? [{ ...workTarget(store), kind: 'withdraw', amount }] : [];
    })
  ].filter((supply) => !inaccessible.has(`${supply.pos.x},${supply.pos.y}`));
  return {
    room,
    controller: controller ? {
      ...workTarget(controller), my: controller.my, level: controller.level,
      ticksToDowngrade: controller.ticksToDowngrade,
      downgradeLimit: CONTROLLER_DOWNGRADE[controller.level] ?? 0,
      safeMode: controller.safeMode ?? 0,
      safeModeAvailable: controller.safeModeAvailable ?? 0,
      safeModeCooldown: controller.safeModeCooldown ?? 0,
      upgradeBlocked: controller.upgradeBlocked ?? 0
    } : undefined,
    energy: { available: room.energyAvailable, capacity: room.energyCapacityAvailable },
    sources, structures, constructionSites, spawns, towers, hostiles, droppedEnergy, creeps,
    energySupplies,
    ...observeSafety(room, structures, hostiles, spawns, towers),
    workerCreeps, workers, replacementLead,
    population: planWorkerPopulation({
      roomName: room.name, workers: gameCreeps, spawning, replacementLead,
      target: workerTarget(sources.length, room.energyCapacityAvailable)
    }),
    refillTargets: structures.flatMap((structure) => {
      if (structure.structureType !== STRUCTURE_SPAWN &&
          structure.structureType !== STRUCTURE_EXTENSION &&
          structure.structureType !== STRUCTURE_TOWER) return [];
      const target = structure as StructureSpawn | StructureExtension | StructureTower;
      const freeEnergy = target.my ? target.store.getFreeCapacity(RESOURCE_ENERGY) : 0;
      return freeEnergy > 0 ? [{ ...workTarget(target), structureType: target.structureType, freeEnergy }] : [];
    }),
    buildTargets: constructionSites.map((site) => ({
      ...workTarget(site), structureType: site.structureType,
      remaining: site.progressTotal - site.progress
    })),
    repairTargets: structures.filter((structure) =>
      (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) &&
      structure.hits < structure.hitsMax * 0.45
    ).map((structure) => ({
      ...workTarget(structure), health: structure.hits / structure.hitsMax,
      missingHits: Math.ceil(structure.hitsMax * 0.45) - structure.hits
    }))
  };
}
