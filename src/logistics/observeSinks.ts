import type { ColonyState } from '../colony/colonyState';
import { workTarget } from '../colony/colonyState';
import { distance, type SourceOperation } from '../operations/sourceOperation';
import { localRouteTicks } from '../operations/observeSources';
import type { WorkDemand } from '../work/demands';
import type { RefillConsumer } from './planHauling';

export const CONTROLLER_RESERVE = 500;

export function refillConsumers(targets: ColonyState['refillTargets'], demands: readonly WorkDemand[]): RefillConsumer[] {
  return targets.map((target) => {
    const demand = demands.find((d) => d.kind === 'refill' && d.target.id === target.id);
    return { ...target, amount: target.freeEnergy, priority: demand?.priority ?? 0,
      critical: Boolean(demand && (demand.emergency || demand.minimum > 0)) };
  });
}

export function observeLogisticsSinks(state: ColonyState, operations: readonly SourceOperation[],
  demands: readonly WorkDemand[]): { consumers: RefillConsumer[]; downstream: Set<string> } {
  const consumers = refillConsumers(state.refillTargets, demands);
  const downstream = new Set<string>();
  const spawn = [...state.spawns].filter((s) => s.isActive()).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!spawn) return { consumers, downstream };
  const candidates = [...state.structures].sort((a, b) => a.id.localeCompare(b.id));
  const controllerBuffer = candidates.find((s) => s.structureType === STRUCTURE_CONTAINER && state.controller &&
    distance(s.pos, state.controller.pos) <= 3 && !operations.some((o) => o.bufferId === s.id ||
      o.tile && distance(o.tile, s.pos) === 0) && !state.sources.some((source) => distance(source.pos, s.pos) <= 1));
  const storage = candidates.find((s) => s.structureType === STRUCTURE_STORAGE && (s as StructureStorage).my && s.isActive());
  for (const target of [controllerBuffer, storage]) {
    if (!target || state.structures.some((s) => distance(s.pos, target.pos) === 0 &&
      (OBSTACLE_OBJECT_TYPES.some((type) => type === s.structureType) && s !== target || s.structureType === STRUCTURE_RAMPART &&
        !(s as StructureRampart).my && !(s as StructureRampart).isPublic)) ||
      localRouteTicks(state.room, target.pos, spawn.pos) === undefined) continue;
    downstream.add(target.id);
    const store = (target as StructureContainer | StructureStorage).store;
    const amount = Math.min(store.getFreeCapacity(RESOURCE_ENERGY), target === controllerBuffer
      ? Math.max(0, CONTROLLER_RESERVE - store.getUsedCapacity(RESOURCE_ENERGY)) : Infinity);
    if (amount > 0) consumers.push({ ...workTarget(target), amount, priority: target === controllerBuffer ? 70 : 10,
      critical: target === controllerBuffer && demands.some((d) => d.kind === 'upgrade' && d.emergency) });
  }
  return { consumers, downstream };
}
