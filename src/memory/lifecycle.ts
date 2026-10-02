const MEMORY_SCHEMA_VERSION = 1;

export function initializeMemory(): void {
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
  for (const name of Object.keys(Memory.creeps)) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }
}
