const MEMORY_SCHEMA_VERSION = 1;

export function initializeMemory(): void {
  if (!Memory.creeps) {
    Memory.creeps = {};
  }

  if (!Memory.meta) {
    Memory.meta = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      firstSeenTick: Game.time
    };
    return;
  }

  if (Memory.meta.schemaVersion !== MEMORY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Memory schema ${Memory.meta.schemaVersion}; runtime expects ${MEMORY_SCHEMA_VERSION}`
    );
  }
}

export function cleanupDeadCreepMemory(): void {
  const spawningNames = new Set(
    Object.values(Game.spawns)
      .map((spawn) => spawn.spawning?.name)
      .filter((name): name is string => Boolean(name))
  );

  for (const name of Object.keys(Memory.creeps)) {
    if (!Game.creeps[name] && !spawningNames.has(name)) {
      delete Memory.creeps[name];
    }
  }
}

export function recoverWorkerMemory(room: Room): void {
  const prefix = `worker-${room.name}-`;

  for (const creep of Object.values(Game.creeps)) {
    if (!creep.name.startsWith(prefix)) continue;

    if (
      creep.memory.kind === 'worker' &&
      creep.memory.home === room.name
    ) {
      continue;
    }

    creep.memory.kind = 'worker';
    creep.memory.home = room.name;
    creep.memory.working =
      creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    creep.memory.born ??= Game.time;

    console.log(
      `[memory] recovered worker metadata for ${creep.name} in ${room.name}`
    );
  }
}
