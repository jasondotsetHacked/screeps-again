import { inside, key, tile } from './grid';
import type { PlanStructureType, Reservation, RoomPlan } from './types';

/** Runtime view of durable intent. Observations and logical route traces are debug results only. */
export type RoomPlanIntent = Omit<RoomPlan, 'assets' | 'routes'>;
// Index ordering is part of storageVersion 1; changing these tables needs a new codec version.
const structureTypes: readonly PlanStructureType[] = ['spawn', 'extension', 'tower', 'storage', 'terminal',
  'factory', 'link', 'container', 'road', 'powerSpawn', 'observer', 'nuker', 'lab', 'extractor'];
const purposes: readonly Reservation['purpose'][] = ['manager', 'access', 'work', 'future'];
type PackedStructure = [position: number, type: number, module: number, minRcl: number, priority: number, flags: number];
type PackedReservation = [position: number, module: number, purpose: number, futureType?: number];
export interface StoredRoomPlan extends Omit<RoomPlanIntent, 'structures' | 'reservations'> {
  storageVersion: 1;
  moduleIds: string[];
  structures: PackedStructure[];
  /** Each planned road coordinate occurs once, with canonical network metadata inferred on read. */
  roads: number[];
  reservations: PackedReservation[];
}
export function acceptablePlan(plan: Pick<RoomPlan, 'version' | 'algorithm' | 'feasibility'>): boolean {
  return plan.version === 1 && plan.algorithm === 'hybrid-v1' &&
    plan.feasibility.complete === true && plan.feasibility.reasons.length === 0;
}
/** Commit gate and explicit whitelist; never spread the full planning/debug result into Memory. */
export function storeRoomPlan(plan: RoomPlanIntent): StoredRoomPlan {
  if (!acceptablePlan(plan)) throw new Error('Cannot commit an incomplete or unsupported RoomPlan');
  const moduleIds = [...new Set([...plan.structures, ...plan.reservations].map((s) => s.module))].sort();
  const moduleIndex = (id: string) => moduleIds.indexOf(id);
  const roads: number[] = [], structures: PackedStructure[] = [];
  for (const s of plan.structures) {
    if (s.type === 'road') {
      if (s.module !== 'network' || s.minRcl !== 2 || s.priority !== 100 || s.owner !== 'colony' || s.transitional)
        throw new Error('Unsupported road metadata for RoomPlan storage version 1');
      roads.push(key(s));
    } else structures.push([key(s), structureTypes.indexOf(s.type), moduleIndex(s.module), s.minRcl, s.priority,
      Number(s.owner === 'source') | (s.transitional ? 2 : 0)]);
  }
  const reservations: PackedReservation[] = plan.reservations.map((r) => [key(r), moduleIndex(r.module), purposes.indexOf(r.purpose),
    ...(r.futureType ? [structureTypes.indexOf(r.futureType)] : [])] as PackedReservation);
  const stored: StoredRoomPlan = {
    storageVersion: 1, version: plan.version, algorithm: plan.algorithm, id: plan.id, anchorId: plan.anchorId,
    roomName: plan.roomName, spawn1: plan.spawn1, moduleIds, structures, roads, reservations,
    modules: plan.modules, ...(plan.core ? { core: plan.core } : {}), sources: plan.sources,
    ...(plan.controller ? { controller: plan.controller } : {}), score: plan.score,
    feasibility: plan.feasibility, warnings: plan.warnings
  };
  // Detach from the full preview object; editing a preview never edits committed Memory.
  return JSON.parse(JSON.stringify(stored)) as StoredRoomPlan;
}
export function readRoomPlan(stored: StoredRoomPlan): RoomPlanIntent {
  if (stored.storageVersion !== 1 || !acceptablePlan(stored)) throw new Error('Unsupported or incomplete stored RoomPlan');
  const position = (id: number) => {
    if (!Number.isInteger(id) || id < 0 || id >= 2500 || !inside(tile(id))) throw new Error('Invalid stored RoomPlan position');
    return tile(id);
  };
  const entry = <T>(table: readonly T[], index: number): T => {
    if (!Number.isInteger(index) || table[index] === undefined) throw new Error('Invalid stored RoomPlan dictionary index');
    return table[index];
  };
  const structures: RoomPlanIntent['structures'] = stored.structures.map(([id, type, module, minRcl, priority, flags]) => {
    if (!Number.isInteger(minRcl) || minRcl < 1 || minRcl > 8 || !Number.isInteger(priority) || priority < 0 ||
      !Number.isInteger(flags) || flags < 0 || flags > 3) throw new Error('Invalid stored RoomPlan construction metadata');
    const structureType = entry(structureTypes, type);
    if (structureType === 'road') throw new Error('Stored road must use unique road coordinate list');
    return { ...position(id), type: structureType, module: entry(stored.moduleIds, module), minRcl, priority,
      owner: flags & 1 ? 'source' : 'colony', ...(flags & 2 ? { transitional: true } : {}) };
  });
  if (new Set(stored.roads).size !== stored.roads.length) throw new Error('Duplicate stored road coordinate');
  for (const id of stored.roads) structures.push({ ...position(id), type: 'road', module: 'network', minRcl: 2, priority: 100, owner: 'colony' });
  const reservations: Reservation[] = stored.reservations.map(([id, module, purpose, futureType]) => ({
    ...position(id), module: entry(stored.moduleIds, module), purpose: entry(purposes, purpose),
    ...(futureType !== undefined ? { futureType: entry(structureTypes, futureType) } : {})
  }));
  return { version: stored.version, algorithm: stored.algorithm, id: stored.id, anchorId: stored.anchorId,
    roomName: stored.roomName, spawn1: stored.spawn1, structures, reservations, modules: stored.modules,
    ...(stored.core ? { core: stored.core } : {}), sources: stored.sources,
    ...(stored.controller ? { controller: stored.controller } : {}), score: stored.score,
    feasibility: stored.feasibility, warnings: stored.warnings };
}
