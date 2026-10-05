import { compatible, planRoom } from '../../shared/roomPlan/planRoom';
import { reconcilePlan } from '../../shared/roomPlan/reconcile';
import { structureLimits } from '../../shared/roomPlan/limits';
import type { PlannedStructure, RoomPlan } from '../../shared/roomPlan/types';
import type { SourceOperation } from '../operations/sourceOperation';
import type { WorkPosition } from '../work/demands';
import { projectLocalLayout, type LocalLayout } from './localLayout';
import { committedRoomPlan, ensureRoomPlan, firstSpawn, observePlanAssets, observeRoomFacts } from './roomPlanRuntime';
import { renderRoomPlan } from './roomPlanVisual';

function createPlannedSite(room: Room, plan: RoomPlan, s: PlannedStructure): number {
  if (!plan.structures.some((p) => p.x === s.x && p.y === s.y && p.type === s.type)) return 0;
  const assets = observePlanAssets(room);
  const at = assets.filter((a) => a.x === s.x && a.y === s.y);
  if (at.some((a) => a.type === s.type || a.site || !compatible(s.type, a))) return 0;
  if (room.getTerrain().get(s.x, s.y) & TERRAIN_MASK_WALL) return 0;
  return room.createConstructionSite(s.x, s.y, s.type) === OK ? 1 : 0;
}
export function observeLocalLayout(room: Room, spawn: StructureSpawn, operations?: readonly SourceOperation[]): LocalLayout {
  return projectLocalLayout(committedRoomPlan(room.name) ?? planRoom(observeRoomFacts(room, spawn, operations)).roomPlan);
}
export function ensureLayoutSite(room: Room, tile: WorkPosition | undefined,
  type: typeof STRUCTURE_STORAGE | typeof STRUCTURE_CONTAINER): number {
  const spawn = firstSpawn(room);
  if (!tile || !spawn) return 0;
  const plan = ensureRoomPlan(room, spawn);
  const s = plan?.structures.find((s) => s.type === type && s.x === tile.x && s.y === tile.y);
  if (!plan || !s) return 0;
  if (type === STRUCTURE_STORAGE && observePlanAssets(room).some((a) => a.type === type)) return 0;
  return createPlannedSite(room, plan, s);
}
/** Source operations own source-specific site creation, consuming committed intent. */
export function ensureSourceContainers(room: Room, spawn: StructureSpawn, maxNew: number,
  operations?: readonly SourceOperation[]): number {
  if ((room.controller?.level ?? 0) < 2 || maxNew <= 0) return 0;
  const plan = ensureRoomPlan(room, spawn, operations);
  if (!plan) return 0;
  let placed = 0;
  for (const s of plan.structures.filter((s) => s.type === 'container' && s.owner === 'source')) {
    if (placed >= maxNew) break;
    if (operations && !operations.some((o) => o.source.id === s.module.slice(7) && o.tile?.walkable &&
      o.tile.routeTicks !== undefined && o.tile.x === s.x && o.tile.y === s.y)) continue;
    placed += createPlannedSite(room, plan, s);
  }
  return placed;
}
export function runConstruction(room: Room, operations?: readonly SourceOperation[]): void {
  if (!room.controller?.my) return;
  const spawn = firstSpawn(room);
  if (!spawn) return;
  const current = committedRoomPlan(room.name);
  if (current && Memory.roomPlanVisuals?.[room.name]) renderRoomPlan(room.visual, current);
  if (Game.time % 25 !== 0) return;
  const plan = ensureRoomPlan(room, spawn, operations);
  if (!plan) return;
  const assets = observePlanAssets(room);
  const limits: Record<string, number> = {};
  for (const s of plan.structures) limits[s.type] = CONTROLLER_STRUCTURES[s.type]?.[room.controller.level] ?? structureLimits[s.type]?.[room.controller.level] ?? 0;
  const roadsEnabled = Game.time % 100 === 0 && !assets.some((a) => a.site && a.type !== 'road');
  const { missing, conflicts } = reconcilePlan(plan, assets, room.controller.level, limits, 4, roadsEnabled);
  let remaining = 4;
  for (const s of missing) {
    if (remaining <= 0) break;
    if (s.owner === 'source' && s.type === 'container' && operations &&
      !operations.some((o) => o.source.id === s.module.slice(7) && o.tile?.walkable &&
        o.tile.routeTicks !== undefined && o.tile.x === s.x && o.tile.y === s.y)) continue;
    remaining -= createPlannedSite(room, plan, s);
  }
  if (conflicts.length && Game.time % 100 === 0) console.log(`[roomplan] ${room.name} retained conflicts: ${conflicts.slice(0, 8).join('; ')}`);
}
