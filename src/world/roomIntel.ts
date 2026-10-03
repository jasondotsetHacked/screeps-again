import {
  isRecord, projectRoomIntel, type RoomObservation, type WorldIntelMemory
} from '../../shared/world/intel';

export interface RoomIntelScans {
  sources: readonly Source[];
  structures: readonly Structure[];
  hostiles: readonly Creep[];
}

// The top-level Memory schema stays at v1. This optional namespace evolves
// independently; unseen records are preserved and upgraded only on new vision.
export function initializeWorldIntel(memory: { world?: unknown }): WorldIntelMemory | undefined {
  if (!isRecord(memory.world)) memory.world = { version: 1, rooms: {} };
  const world = memory.world as Record<string, unknown>;
  // Preserve valid future versions during a rollback, without stopping
  // colony execution or attempting a destructive downgrade.
  if (typeof world.version === 'number' && Number.isInteger(world.version) && world.version > 1) return undefined;
  // Missing/old headers and malformed values recover in place. Retained room
  // data stays untrusted until readRoomIntel validates it or vision rebuilds it.
  world.version = 1;
  if (!isRecord(world.rooms)) world.rooms = {};
  return world as unknown as WorldIntelMemory;
}

// Runtime adapter only. Owned rooms reuse the colony's tick-local scans.
export function observeRoom(room: Room, tick: number, scans?: RoomIntelScans): RoomObservation {
  const sources = scans?.sources ?? room.find(FIND_SOURCES);
  const structures = scans?.structures ?? room.find(FIND_STRUCTURES);
  const foreignCreeps = scans?.hostiles ?? room.find(FIND_HOSTILE_CREEPS);
  const mineral = room.find(FIND_MINERALS)[0];
  const controller = room.controller;
  const position = (object: { id: string; pos: RoomPosition }) => ({
    id: object.id, x: object.pos.x, y: object.pos.y
  });
  return {
    roomName: room.name, tick,
    controller: controller ? {
      ...position(controller), owner: controller.owner?.username ?? null, level: controller.level,
      reservation: controller.reservation ? {
        username: controller.reservation.username, ticksRemaining: controller.reservation.ticksToEnd
      } : null
    } : null,
    sources: sources.map(position),
    mineral: mineral ? { ...position(mineral), type: mineral.mineralType } : null,
    presence: {
      foreignCreeps: foreignCreeps.length,
      foreignTowers: structures.filter((s) => s.structureType === STRUCTURE_TOWER && !(s as StructureTower).my).length,
      invaderCores: structures.filter((s) => s.structureType === STRUCTURE_INVADER_CORE).length
    }
  };
}

export function updateVisibleRoomIntel(rooms: readonly Room[],
  observations: ReadonlyMap<string, { state: RoomIntelScans }> = new Map()): void {
  const world = initializeWorldIntel(Memory);
  if (!world) return;
  for (const room of rooms) {
    try {
      const previous: unknown = world.rooms[room.name];
      if (isRecord(previous) && typeof previous.version === 'number' && previous.version > 1) continue;
      world.rooms[room.name] = projectRoomIntel(observeRoom(room, Game.time, observations.get(room.name)?.state));
    } catch {
      // Private, fixed diagnostic: intel failure must not interrupt safety or
      // labor, and must not leak room/strategic details into public ops errors.
      console.log('[world:intel] visible room observation failed');
    }
  }
}
