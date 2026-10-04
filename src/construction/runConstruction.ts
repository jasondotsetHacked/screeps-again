import { chooseSourceTiles } from '../operations/observeSources';
import type { SourceOperation } from '../operations/sourceOperation';
import { distance } from '../operations/sourceOperation';
import { layoutReservations, layoutCoexistence, planLocalLayout, type LocalLayout, type LayoutObject } from './localLayout';
import type { WorkPosition } from '../work/demands';

const PLAN_INTERVAL = 25;
const ROAD_INTERVAL = 100;
const MAX_NEW_SITES_PER_PLAN = 4;

function buildable(room: Room, x: number, y: number, reserved: readonly WorkPosition[] = []): boolean {
  if (x <= 1 || x >= 48 || y <= 1 || y >= 48) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  if (reserved.some((p) => p.x === x && p.y === y)) return false;

  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.some((structure) => structure.structureType !== STRUCTURE_ROAD)) {
    return false;
  }

  return room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length === 0;
}

function countStructuresAndSites(
  room: Room,
  structureType: BuildableStructureConstant
): number {
  const structures = room.find(FIND_STRUCTURES).filter(
    (structure) => structure.structureType === structureType
  ).length;
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES).filter(
    (site) => site.structureType === structureType
  ).length;
  return structures + sites;
}

function candidateTiles(
  room: Room,
  origin: RoomPosition,
  minRange: number,
  maxRange: number,
  reserved: readonly WorkPosition[]
): RoomPosition[] {
  const candidates: RoomPosition[] = [];

  for (let range = minRange; range <= maxRange; range += 1) {
    for (let y = origin.y - range; y <= origin.y + range; y += 1) {
      for (let x = origin.x - range; x <= origin.x + range; x += 1) {
        if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== range) {
          continue;
        }

        if ((x + y) % 2 !== 0) continue;
        if (!buildable(room, x, y, reserved)) continue;
        candidates.push(new RoomPosition(x, y, room.name));
      }
    }
  }

  return candidates;
}

function placeStructureSites(
  room: Room,
  spawn: StructureSpawn,
  structureType: BuildableStructureConstant,
  desired: number,
  maxNew: number,
  reserved: readonly WorkPosition[]
): number {
  let existing = countStructuresAndSites(room, structureType);
  let placed = 0;
  if (existing >= desired) return placed;

  const candidates = candidateTiles(room, spawn.pos, 2, 7, reserved);

  for (const position of candidates) {
    if (existing >= desired || placed >= maxNew) break;

    const result = room.createConstructionSite(
      position.x,
      position.y,
      structureType
    );

    if (result === OK) {
      existing += 1;
      placed += 1;
    }
  }

  return placed;
}

export function ensureSourceContainers(
  room: Room,
  spawn: StructureSpawn,
  maxNew: number,
  operations?: readonly SourceOperation[]
): number {
  if ((room.controller?.level ?? 0) < 2) return 0;

  let placed = 0;
  const sources = room.find(FIND_SOURCES);
  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const tiles = operations ? new Map(operations.map((o) => [o.source.id, o.tile]))
    : chooseSourceTiles(room, sources, structures, sites, spawn.pos);
  for (const source of [...sources].sort((a, b) => a.id.localeCompare(b.id))) {
    if (placed >= maxNew) break;

    const first = tiles.get(source.id);
    if (!first?.placeable || !first.walkable || first.containerId || first.siteId || first.routeTicks === undefined) continue;
    // A nearby source's assigned buffer does not satisfy this source. Only a
    // container/site on the exact assigned tile prevents duplicate placement.
    if ([...structures, ...sites].some((s) => s.structureType === STRUCTURE_CONTAINER &&
      s.pos.x === first.x && s.pos.y === first.y)) continue;

    if (
      room.createConstructionSite(
        first.x,
        first.y,
        STRUCTURE_CONTAINER
      ) === OK
    ) {
      placed += 1;
    }
  }

  return placed;
}

function placeRoadsOnPath(
  room: Room,
  from: RoomPosition,
  target: RoomPosition,
  maxNew: number,
  reserved: readonly WorkPosition[]
): number {
  const path = from.findPathTo(target, {
    ignoreCreeps: true,
    maxRooms: 1
  });

  let placed = 0;

  for (const step of path) {
    if (placed >= maxNew) break;
    if (!buildable(room, step.x, step.y, reserved)) continue;

    if (
      room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD) === OK
    ) {
      placed += 1;
    }
  }

  return placed;
}

function layoutObject(s: Structure | ConstructionSite, site = false): LayoutObject {
  return { pos: s.pos, type: s.structureType, site, my: (s as OwnedStructure).my,
    blocking: OBSTACLE_OBJECT_TYPES.some((type) => type === s.structureType) || s.structureType === STRUCTURE_RAMPART &&
      !(s as StructureRampart).my && !(s as StructureRampart).isPublic };
}

export function observeLocalLayout(room: Room, spawn: StructureSpawn, operations?: readonly SourceOperation[]): LocalLayout {
  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const sources = room.find(FIND_SOURCES);
  const tiles = operations ? operations.flatMap((o) => o.tile ? [o.tile] : [])
    : [...chooseSourceTiles(room, sources, structures, sites, spawn.pos).values()].filter((p): p is NonNullable<typeof p> => Boolean(p));
  const terrain = room.getTerrain();
  return planLocalLayout({ roomName: room.name, spawn: spawn.pos, controller: room.controller!.pos,
    sources: sources.map((s) => s.pos), sourceBuffers: tiles,
    fixed: room.find(FIND_MINERALS).map((m) => m.pos),
    objects: [...structures.map((s) => layoutObject(s)), ...sites.map((s) => layoutObject(s, true))],
    terrain: (x, y) => terrain.get(x, y) });
}

export function ensureLayoutSite(room: Room, tile: WorkPosition | undefined, type: typeof STRUCTURE_STORAGE | typeof STRUCTURE_CONTAINER): number {
  if (!tile) return 0;
  const objects = [...room.find(FIND_STRUCTURES).map((s) => layoutObject(s)),
    ...room.find(FIND_MY_CONSTRUCTION_SITES).map((s) => layoutObject(s, true))];
  if (objects.some((s) => s.type === type && (type === STRUCTURE_STORAGE || distance(s.pos, tile) === 0))) return 0;
  if (objects.some((s) => distance(s.pos, tile) === 0 && !layoutCoexistence(type, s))) return 0;
  return room.createConstructionSite(tile.x, tile.y, type) === OK ? 1 : 0;
}

export function runConstruction(room: Room, operations?: readonly SourceOperation[]): void {
  const controller = room.controller;
  if (!controller?.my) return;

  const spawn = room
    .find(FIND_MY_STRUCTURES)
    .find(
      (structure): structure is StructureSpawn =>
        structure.structureType === STRUCTURE_SPAWN
    );

  if (!spawn) return;
  if (Game.time % PLAN_INTERVAL !== 0) return;
  const layout = observeLocalLayout(room, spawn, operations);
  const reserved = [...layoutReservations(layout), ...(operations?.flatMap((o) => o.tile ? [o.tile] : []) ?? [])];

  if (Game.time % PLAN_INTERVAL === 0) {
    let remaining = MAX_NEW_SITES_PER_PLAN;
    // Establish the strategic site even while RCL4 extension capacity is still
    // growing. Construction labor continues to rank extensions above storage.
    if (controller.level >= 4) remaining -= ensureLayoutSite(room, layout.storage, STRUCTURE_STORAGE);

    const extensionLimit =
      CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][controller.level] ?? 0;

    remaining -= placeStructureSites(
      room,
      spawn,
      STRUCTURE_EXTENSION,
      extensionLimit,
      remaining,
      reserved
    );

    // Early energy capacity is the highest-value infrastructure for the
    // generalist-worker V1. Do not create lower-priority sites until every
    // available extension at this RCL is represented by a structure/site.
    if (
      countStructuresAndSites(room, STRUCTURE_EXTENSION) < extensionLimit
    ) {
      return;
    }

    const towerLimit =
      CONTROLLER_STRUCTURES[STRUCTURE_TOWER][controller.level] ?? 0;

    if (remaining > 0) {
      remaining -= placeStructureSites(
        room,
        spawn,
        STRUCTURE_TOWER,
        towerLimit,
        remaining,
        reserved
      );
    }

    if (countStructuresAndSites(room, STRUCTURE_TOWER) < towerLimit) {
      return;
    }

    if (remaining > 0) {
      remaining -= ensureSourceContainers(room, spawn, remaining, operations);
    }
    if (remaining > 0 && controller.level >= 2) {
      remaining -= ensureLayoutSite(room, layout.controllerBuffer, STRUCTURE_CONTAINER);
    }
  }

  if (
    controller.level >= 2 &&
    Game.time % ROAD_INTERVAL === 0 &&
    room.find(FIND_MY_CONSTRUCTION_SITES).filter(
      (site) => site.structureType !== STRUCTURE_ROAD
    ).length === 0
  ) {
    let remaining = MAX_NEW_SITES_PER_PLAN;

    for (const source of room.find(FIND_SOURCES)) {
      if (remaining <= 0) break;
      remaining -= placeRoadsOnPath(room, spawn.pos, source.pos, remaining, reserved);
    }

    if (remaining > 0) {
      placeRoadsOnPath(room, spawn.pos, controller.pos, remaining, reserved);
    }
  }
}
