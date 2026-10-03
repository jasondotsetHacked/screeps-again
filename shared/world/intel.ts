import { classifyRoom, type RoomClass } from './rooms';
import type { RoomPositionLike } from './terrain';

export const ROOM_INTEL_VERSION = 1 as const;

export interface IntelObject extends RoomPositionLike {
  id: string;
}

export interface RoomObservation {
  roomName: string;
  tick: number;
  controller: (IntelObject & {
    owner: string | null;
    level: number;
    reservation: { username: string; ticksRemaining: number } | null;
  }) | null;
  sources: readonly IntelObject[];
  mineral: (IntelObject & { type: string }) | null;
  presence: { foreignCreeps: number; foreignTowers: number; invaderCores: number };
}

// Facts only. Room identity is the containing map key; all ticks are shard-local.
export interface RoomIntel {
  version: typeof ROOM_INTEL_VERSION;
  lastSeen: number;
  roomClass: RoomClass;
  controller: (IntelObject & {
    owner: string | null;
    level: number;
    reservation: { username: string; expiresAt: number } | null;
  }) | null;
  sources: IntelObject[];
  mineral: (IntelObject & { type: string }) | null;
  presence: { foreignCreeps: number; foreignTowers: number; invaderCores: number };
}

export interface WorldIntelMemory {
  version: 1;
  // Legacy/future entries may be retained without vision. Consumers must read
  // through validation rather than assuming every persisted entry is current.
  rooms: Record<string, unknown>;
}

function objectFact(object: IntelObject): IntelObject {
  return { id: object.id, x: object.x, y: object.y };
}

// A complete sighting replaces old facts, including explicit absence. Never
// spread runtime inputs: this allowlist is also the serialization boundary.
export function projectRoomIntel(observation: RoomObservation): RoomIntel {
  const controller = observation.controller;
  const mineral = observation.mineral;
  return {
    version: ROOM_INTEL_VERSION,
    lastSeen: observation.tick,
    roomClass: classifyRoom(observation.roomName),
    controller: controller ? {
      ...objectFact(controller), owner: controller.owner, level: controller.level,
      reservation: controller.reservation ? {
        username: controller.reservation.username,
        expiresAt: observation.tick + controller.reservation.ticksRemaining
      } : null
    } : null,
    sources: observation.sources.map(objectFact).sort((a, b) => a.id.localeCompare(b.id)),
    mineral: mineral ? { ...objectFact(mineral), type: mineral.type } : null,
    presence: {
      foreignCreeps: observation.presence.foreignCreeps,
      foreignTowers: observation.presence.foreignTowers,
      invaderCores: observation.presence.invaderCores
    }
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isObjectFact(value: unknown): value is IntelObject {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    nonnegativeInteger(value.x) && value.x < 50 && nonnegativeInteger(value.y) && value.y < 50;
}

// Memory is untrusted after resets, manual edits, or a code rollback. An older
// unknown record is not silently treated as current intel with invented facts.
export function isRoomIntel(value: unknown): value is RoomIntel {
  if (!isRecord(value) || value.version !== ROOM_INTEL_VERSION ||
      !nonnegativeInteger(value.lastSeen) ||
      typeof value.roomClass !== 'string' ||
      !['standard', 'highway', 'sourceKeeper'].includes(value.roomClass) ||
      !Array.isArray(value.sources) || !value.sources.every(isObjectFact)) return false;
  const controller = value.controller;
  if (controller !== null) {
    if (!isObjectFact(controller) || !isRecord(controller) ||
        !(controller.owner === null || typeof controller.owner === 'string') ||
        !nonnegativeInteger(controller.level) || controller.level > 8) return false;
    const reservation = controller.reservation;
    if (reservation !== null && (!isRecord(reservation) ||
        typeof reservation.username !== 'string' || !nonnegativeInteger(reservation.expiresAt))) return false;
  }
  if (value.mineral !== null && (!isObjectFact(value.mineral) ||
      !isRecord(value.mineral) || typeof value.mineral.type !== 'string')) return false;
  return isRecord(value.presence) && nonnegativeInteger(value.presence.foreignCreeps) &&
    nonnegativeInteger(value.presence.foreignTowers) && nonnegativeInteger(value.presence.invaderCores);
}

export function intelFreshness(value: unknown, tick: number, maxAge: number): 'unknown' | 'fresh' | 'stale' {
  if (!nonnegativeInteger(tick) || !nonnegativeInteger(maxAge)) {
    throw new Error('Intel freshness requires non-negative integer tick and maxAge');
  }
  if (!isRoomIntel(value) || value.lastSeen > tick) return 'unknown';
  return tick - value.lastSeen <= maxAge ? 'fresh' : 'stale';
}

export function readRoomIntel(world: unknown, roomName: string): RoomIntel | undefined {
  if (!isRecord(world) || world.version !== 1 || !isRecord(world.rooms)) return undefined;
  const value = world.rooms[roomName];
  return isRoomIntel(value) ? value : undefined;
}
