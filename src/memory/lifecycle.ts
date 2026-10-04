import { recoverCreepIdentity } from '../creeps/identity';

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

export function recoverColonyCreepMemory(room: Room): void {
  for (const creep of Object.values(Game.creeps)) {
    const identity = recoverCreepIdentity(creep.name, creep.memory);
    if (!identity || identity.home !== room.name) continue;
    // A missing/non-object entry recovers locally; unrelated fields survive.
    if (!creep.memory || typeof creep.memory !== 'object') creep.memory = {};
    Object.assign(creep.memory, identity);
    if (identity.kind === 'worker') creep.memory.working =
      creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    creep.memory.born ??= Game.time;

    console.log(
      `[memory] recovered ${identity.kind} metadata for ${creep.name} in ${room.name}`
    );
  }

  // A spawning creep may not yet be in Game.creeps. Restore its durable
  // identity before observation; the population counter deduplicates by name.
  for (const spawn of Object.values(Game.spawns ?? {})) {
    const name = spawn.spawning?.name;
    if (!name || Game.creeps[name]) continue;
    const identity = recoverCreepIdentity(name, Memory.creeps[name]);
    if (!identity || identity.home !== room.name) continue;
    const memory = Memory.creeps[name];
    Memory.creeps[name] = {
      ...(memory && typeof memory === 'object' ? memory : {}),
      ...identity, ...(identity.kind === 'worker' ? { working: false } : {}), born: memory?.born ?? Game.time
    };
    console.log(`[memory] recovered spawning ${identity.kind} metadata for ${name} in ${room.name}`);
  }
}

// Backward-compatible entry point for existing callers/tests.
export const recoverWorkerMemory = recoverColonyCreepMemory;
