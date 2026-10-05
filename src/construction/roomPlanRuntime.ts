import { planRoom } from '../../shared/roomPlan/planRoom';
import type { RoomAsset, RoomFacts, RoomPlan } from '../../shared/roomPlan/types';
import type { SourceOperation } from '../operations/sourceOperation';
import { chooseSourceTiles } from '../operations/observeSources';
import { selectSpawnAnchor } from './spawnAnchor';

export function observePlanAssets(room: Room): RoomAsset[] {
  const normalize = (s: Structure | ConstructionSite, site = false): RoomAsset => ({
    x: s.pos.x, y: s.pos.y, type: s.structureType, id: s.id, site,
    owned: (s as OwnedStructure).my === true,
    blocking: s.structureType === STRUCTURE_RAMPART ? !(s as StructureRampart).my && !(s as StructureRampart).isPublic :
      !['road', 'container', 'extractor'].includes(s.structureType)
  });
  return [...room.find(FIND_STRUCTURES).map((s) => normalize(s)),
    ...room.find(FIND_MY_CONSTRUCTION_SITES).map((s) => normalize(s, true))];
}
export function firstSpawn(room: Room): StructureSpawn | undefined {
  const spawns = room.find(FIND_MY_STRUCTURES).filter((s): s is StructureSpawn => s.structureType === STRUCTURE_SPAWN);
  return selectSpawnAnchor(spawns, Memory.roomPlans?.[room.name]);
}
/** Observation adapter only; layout decisions live in shared/roomPlan. */
export function observeRoomFacts(room: Room, spawn: StructureSpawn, operations?: readonly SourceOperation[]): RoomFacts {
  const terrain = room.getTerrain();
  const cells: string[] = [];
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) cells.push(String(terrain.get(x, y) & 3));
  const sources = room.find(FIND_SOURCES);
  const buffers = operations ? operations.flatMap((o) => o.tile ? [{ sourceId: o.source.id, pos: { x: o.tile.x, y: o.tile.y } }] : []) :
    [...chooseSourceTiles(room, sources, room.find(FIND_STRUCTURES), room.find(FIND_MY_CONSTRUCTION_SITES), spawn.pos)]
      .flatMap(([sourceId, p]) => p ? [{ sourceId, pos: { x: p.x, y: p.y } }] : []);
  const mineral = room.find(FIND_MINERALS)[0];
  return { roomName: room.name, terrain: cells.join(''), spawn1: { x: spawn.pos.x, y: spawn.pos.y },
    controller: { x: room.controller!.pos.x, y: room.controller!.pos.y },
    sources: sources.map((s) => ({ id: s.id, x: s.pos.x, y: s.pos.y })),
    ...(mineral ? { mineral: { x: mineral.pos.x, y: mineral.pos.y } } : {}), assets: observePlanAssets(room), sourceBuffers: buffers };
}
export function committedRoomPlan(roomName: string): RoomPlan | undefined { return Memory.roomPlans?.[roomName]; }
/** No automatic invalidation on RCL, new sites, missing creeps or global resets. */
export function ensureRoomPlan(room: Room, spawn: StructureSpawn, operations?: readonly SourceOperation[]): RoomPlan | undefined {
  const current = committedRoomPlan(room.name);
  if (current) {
    if (current.version !== 1 || current.algorithm !== 'hybrid-v1' || current.spawn1.x !== spawn.pos.x || current.spawn1.y !== spawn.pos.y) {
      if (Game.time % 100 === 0) console.log(`[roomplan] ${room.name} version/anchor mismatch; construction paused; explicit replan required`);
      return undefined;
    }
    return current;
  }
  // A one-time mature layout is optional work; postpone when recovery has drained CPU reserve.
  if (Game.cpu?.bucket !== undefined && Game.cpu.bucket < 3000) return undefined;
  const result = planRoom(observeRoomFacts(room, spawn, operations));
  Memory.roomPlans ??= {};
  Memory.roomPlans[room.name] = result.roomPlan;
  console.log(`[roomplan] ${room.name} committed ${result.roomPlan.id} complete=${result.feasibility.complete} score=${result.score.total} ${[...result.feasibility.reasons, ...result.warnings].join('; ')}`);
  return result.roomPlan;
}
/** Console helper: preview first; commit only on explicit true. Never demolishes. */
export function replanRoom(roomName: string, commit = false): RoomPlan {
  const room = Game.rooms[roomName];
  const spawn = room && firstSpawn(room);
  if (!room?.controller?.my || !spawn) throw new Error('Owned visible room with spawn required');
  const plan = planRoom(observeRoomFacts(room, spawn)).roomPlan;
  if (commit) { Memory.roomPlans ??= {}; Memory.roomPlans[roomName] = plan; }
  return plan;
}

let debugInstalled = false;
export function installRoomPlanDebug(): void {
  if (debugInstalled) return;
  Object.assign(globalThis, { roomPlan: {
    preview: (roomName: string) => replanRoom(roomName),
    replan: (roomName: string) => replanRoom(roomName, true),
    show: (roomName: string) => { Memory.roomPlanVisuals ??= {}; Memory.roomPlanVisuals[roomName] = true; },
    hide: (roomName: string) => { if (Memory.roomPlanVisuals) delete Memory.roomPlanVisuals[roomName]; }
  } });
  debugInstalled = true;
}
