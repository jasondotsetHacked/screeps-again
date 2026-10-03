import {
  bodyCost,
  buildWorkerBody,
  replacementLeadTicks
} from './workerBody';

function workerTarget(room: Room): number {
  const sourceCount = room.find(FIND_SOURCES).length;
  const capacity = room.energyCapacityAvailable;

  if (capacity <= 300) return Math.max(3, sourceCount * 3);
  if (capacity <= 550) return Math.max(4, sourceCount * 2 + 1);
  return Math.max(4, sourceCount + 2);
}

function isWorkerForRoom(creep: Creep, room: Room): boolean {
  return creep.memory.kind === 'worker' && creep.memory.home === room.name;
}

function spawnWorker(
  spawn: StructureSpawn,
  room: Room,
  energyBudget: number
): ScreepsReturnCode {
  const body = buildWorkerBody(energyBudget);
  if (body.length === 0) return ERR_NOT_ENOUGH_ENERGY;

  const name = `worker-${room.name}-${Game.time.toString(36)}`;
  return spawn.spawnCreep(body, name, {
    memory: {
      kind: 'worker',
      home: room.name,
      working: false,
      born: Game.time
    }
  });
}

export function runSpawning(room: Room): void {
  const spawns = room
    .find(FIND_MY_STRUCTURES)
    .filter(
      (structure): structure is StructureSpawn =>
        structure.structureType === STRUCTURE_SPAWN
    );

  const availableSpawn = spawns.find((spawn) => !spawn.spawning);
  if (!availableSpawn) return;

  const workers = Object.values(Game.creeps).filter((creep) =>
    isWorkerForRoom(creep, room)
  );

  const anyWorkerSpawning = spawns.some((spawn) => {
    const name = spawn.spawning?.name;
    return Boolean(
      name &&
        Memory.creeps[name]?.kind === 'worker' &&
        Memory.creeps[name]?.home === room.name
    );
  });

  if (workers.length === 0 && !anyWorkerSpawning) {
    const emergencyBudget = Math.min(
      room.energyAvailable,
      room.energyCapacityAvailable
    );

    const result = spawnWorker(availableSpawn, room, emergencyBudget);
    if (result === OK) {
      console.log(
        `[spawn] ${room.name} emergency bootstrap worker started with ${emergencyBudget} energy`
      );
    }
    return;
  }

  const plannedBody = buildWorkerBody(room.energyCapacityAvailable);
  if (plannedBody.length === 0) return;

  const lead = replacementLeadTicks(plannedBody);
  const effectiveWorkers = workers.filter(
    (creep) =>
      creep.spawning ||
      creep.ticksToLive === undefined ||
      creep.ticksToLive > lead
  ).length + (anyWorkerSpawning ? 1 : 0);

  const target = workerTarget(room);
  if (effectiveWorkers >= target) return;

  const cost = bodyCost(plannedBody);
  if (room.energyAvailable < cost) return;

  const result = spawnWorker(
    availableSpawn,
    room,
    room.energyCapacityAvailable
  );

  if (result === OK) {
    console.log(
      `[spawn] ${room.name} worker ${effectiveWorkers + 1}/${target}; replacement lead=${lead} ticks`
    );
  }
}
