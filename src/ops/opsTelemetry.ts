const OPS_VERSION = 1 as const;
const SNAPSHOT_INTERVAL = 10;
const MAX_RECENT_ERRORS = 12;
const MAX_ERROR_LENGTH = 300;

function ensureOpsMemory(): OpsMemory {
  if (!Memory.ops || Memory.ops.version !== OPS_VERSION) {
    Memory.ops = {
      version: OPS_VERSION,
      recentErrors: []
    };
  }

  return Memory.ops;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

export function recordOpsError(
  scope: OpsErrorRecord['scope'],
  subject: string,
  error: unknown
): void {
  const ops = ensureOpsMemory();

  ops.recentErrors.push({
    tick: Game.time,
    scope,
    subject,
    message: errorMessage(error)
  });

  if (ops.recentErrors.length > MAX_RECENT_ERRORS) {
    ops.recentErrors.splice(
      0,
      ops.recentErrors.length - MAX_RECENT_ERRORS
    );
  }
}

export function publishOpsSnapshot(
  ownedRooms: Room[],
  cpuStart: number
): void {
  const ops = ensureOpsMemory();

  if (ops.snapshot && Game.time % SNAPSHOT_INTERVAL !== 0) {
    return;
  }

  const rooms: OpsRoomSnapshot[] = ownedRooms.map((room) => {
    const controller = room.controller;
    const spawns = room.find(FIND_MY_SPAWNS);

    return {
      name: room.name,
      rcl: controller?.level ?? 0,
      progress: controller?.progress ?? null,
      progressTotal: controller?.progressTotal ?? null,
      ticksToDowngrade: controller?.ticksToDowngrade ?? null,
      safeMode: controller?.safeMode ?? null,
      energyAvailable: room.energyAvailable,
      energyCapacityAvailable: room.energyCapacityAvailable,
      constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES).length,
      hostiles: room.find(FIND_HOSTILE_CREEPS).length,
      spawns: spawns.map((spawn) => ({
        name: spawn.name,
        energy: spawn.store.getUsedCapacity(RESOURCE_ENERGY),
        energyCapacity: spawn.store.getCapacity(RESOURCE_ENERGY),
        spawning: spawn.spawning
          ? {
              name: spawn.spawning.name,
              remainingTime: spawn.spawning.remainingTime
            }
          : null
      }))
    };
  });

  const creeps: OpsCreepSnapshot[] = Object.values(Game.creeps).map(
    (creep) => ({
      name: creep.name,
      room: creep.room.name,
      x: creep.pos.x,
      y: creep.pos.y,
      ttl: creep.ticksToLive ?? null,
      spawning: creep.spawning,
      energy: creep.store.getUsedCapacity(RESOURCE_ENERGY),
      energyCapacity: creep.store.getCapacity(RESOURCE_ENERGY),
      kind: creep.memory.kind ?? null,
      home: creep.memory.home ?? null,
      working: creep.memory.working ?? null,
      sourceId: creep.memory.sourceId?.toString() ?? null
    })
  );

  ops.snapshot = {
    tick: Game.time,
    cpuUsed: Number((Game.cpu.getUsed() - cpuStart).toFixed(2)),
    cpuLimit: Game.cpu.limit,
    bucket: Game.cpu.bucket,
    rooms,
    creeps
  };
}
