import type { ColonyState } from '../colony/colonyState';
import { workTarget } from '../colony/colonyState';
import { distance, planSourceOperation, selectSourceTile, type SourceOperation, type SourceTile } from './sourceOperation';

export function sourceTiles(room: Room, source: Source, structures: readonly Structure[],
  sites: readonly ConstructionSite[]): SourceTile[] {
  const tiles: SourceTile[] = [];
  const terrain = room.getTerrain();
  for (let y = source.pos.y - 1; y <= source.pos.y + 1; y++) {
    for (let x = source.pos.x - 1; x <= source.pos.x + 1; x++) {
      if ((x === source.pos.x && y === source.pos.y) || x < 1 || x > 48 || y < 1 || y > 48) continue;
      const at = structures.filter((s) => s.pos.x === x && s.pos.y === y);
      const atSites = sites.filter((s) => s.pos.x === x && s.pos.y === y);
      const walkable = terrain.get(x, y) !== TERRAIN_MASK_WALL && !at.some((s) =>
        OBSTACLE_OBJECT_TYPES.some((type) => type === s.structureType) || (s.structureType === STRUCTURE_RAMPART &&
          !(s as StructureRampart).my && !(s as StructureRampart).isPublic));
      tiles.push({ x, y, roomName: room.name, walkable,
        placeable: at.every((s) => s.structureType === STRUCTURE_ROAD ||
          (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my)) && atSites.length === 0,
        containerId: at.find((s) => s.structureType === STRUCTURE_CONTAINER)?.id,
        siteId: atSites.find((s) => s.structureType === STRUCTURE_CONTAINER)?.id });
    }
  }
  return tiles;
}

export function chooseSourceTiles(room: Room, sources: readonly Source[], structures: readonly Structure[],
  sites: readonly ConstructionSite[], anchor: RoomPosition): Map<string, SourceTile | undefined> {
  const chosen = new Map<string, SourceTile | undefined>();
  const used = new Set<string>();
  for (const source of [...sources].sort((a, b) => a.id.localeCompare(b.id))) {
    let candidates = sourceTiles(room, source, structures, sites)
      .filter((tile) => !used.has(`${tile.x},${tile.y}`) &&
        !sources.some((s) => s.pos.x === tile.x && s.pos.y === tile.y) &&
        !(room.controller?.pos.x === tile.x && room.controller.pos.y === tile.y));
    let tile: SourceTile | undefined;
    while (candidates.length) {
      const candidate = selectSourceTile(candidates, anchor);
      if (!candidate) break;
      const routeTicks = localRouteTicks(room, candidate, anchor);
      // Adopt durable buffers/sites without duplicating them. For NEW buffers,
      // skip an unreachable preferred tile before committing construction to it.
      if (candidate.containerId || candidate.siteId || routeTicks !== undefined) {
        tile = { ...candidate, routeTicks };
        break;
      }
      candidates = candidates.filter((other) => other !== candidate);
    }
    chosen.set(source.id, tile);
    if (tile) used.add(`${tile.x},${tile.y}`);
  }
  return chosen;
}

function localRouteTicks(room: Room, tile: SourceTile, anchor: RoomPosition): number | undefined {
  const origin = new RoomPosition(tile.x, tile.y, room.name);
  const path = origin.findPathTo(anchor, { ignoreCreeps: true, maxRooms: 1, range: 1, maxOps: 2000 });
  const last = path.at(-1) ?? tile;
  if (distance({ ...last, roomName: room.name }, anchor) > 1) return undefined;
  const terrain = room.getTerrain();
  return path.reduce((sum, step) => sum + (terrain.get(step.x, step.y) === TERRAIN_MASK_SWAMP ? 5 : 1), 0);
}

export function observeSourceOperations(state: ColonyState): SourceOperation[] {
  const spawn = [...state.spawns].filter((s) => s.isActive()).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!spawn || !state.controller?.my) return [];
  const tiles = chooseSourceTiles(state.room, state.sources, state.structures, state.constructionSites, spawn.pos);
  const workforceReady = state.population.effectiveWorkers >= state.population.target &&
    state.workers.filter((w) => w.work > 0 && w.carry > 0 && w.move > 0).length >= 2;
  return [...state.sources].sort((a, b) => a.id.localeCompare(b.id)).map((source) => {
    const tile = tiles.get(source.id);
    let travelTicks: number | undefined;
    if (tile?.containerId && tile.routeTicks !== undefined) {
      // 1:1 CARRY:MOVE bodies take five ticks per loaded swamp step. Detour
      // allowance to the farthest refill consumer is bounded within this room.
      const detour = Math.max(0, ...state.structures.filter((s) =>
        (s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_TOWER ||
          s.structureType === STRUCTURE_SPAWN) && (s as OwnedStructure).my)
        .map((s) => distance(s.pos, spawn.pos) * 5));
      travelTicks = tile.routeTicks + detour;
    }
    return planSourceOperation({ home: state.room.name, source: workTarget(source),
      energyCapacity: source.energyCapacity ?? SOURCE_ENERGY_CAPACITY, tile, travelTicks,
      capacity: state.energy.capacity, functioning: true, workforceReady });
  });
}
