import type { WorkPosition, WorkTarget } from '../work/demands';

export interface EnergySupply extends WorkTarget {
  kind: 'harvest' | 'pickup' | 'withdraw';
  amount: number;
  regeneration?: number;
}

export interface EnergyConsumer {
  pos: WorkPosition;
  work: number;
  move: number;
  freeCapacity: number;
  sourceId?: string;
}

export function planWorkerEnergyAccess(worker: EnergyConsumer, supplies: readonly EnergySupply[],
  fallback: readonly EnergySupply[], sourceWork: ReadonlyMap<string, number>): {
    supply?: EnergySupply; releaseFallback: boolean;
  } {
  const supply = selectEnergySupply(worker, supplies, sourceWork);
  // Soft source ownership gives way when labor cannot acquire one useful load
  // downstream, including immobile workers and peers exhausting the projection.
  const releaseFallback = fallback.length > 0 && worker.freeCapacity > 0 &&
    (!supply || supply.kind === 'harvest' || supply.amount < Math.min(worker.freeCapacity, CARRY_CAPACITY));
  return { supply: releaseFallback ? selectEnergySupply(worker, [...supplies, ...fallback], sourceWork) : supply,
    releaseFallback };
}

// Acquisition is a separate, pure decision: energy gained per estimated travel
// and acquisition tick, with contention for self-harvesting generalists.
export function selectEnergySupply(
  worker: EnergyConsumer,
  supplies: readonly EnergySupply[],
  sourceWork: ReadonlyMap<string, number>
): EnergySupply | undefined {
  if (worker.freeCapacity <= 0) return undefined;
  let best: EnergySupply | undefined;
  let bestCost = Infinity;
  for (const supply of supplies) {
    if (supply.pos.roomName !== worker.pos.roomName || supply.amount <= 0 ||
        (supply.kind === 'harvest' && worker.work <= 0)) continue;
    const travel = Math.max(0, Math.max(Math.abs(worker.pos.x - supply.pos.x),
      Math.abs(worker.pos.y - supply.pos.y)) - 1);
    if (travel > 0 && worker.move <= 0) continue;
    const amount = Math.min(worker.freeCapacity, supply.amount);
    const otherWork = Math.max(0, (sourceWork.get(supply.id) ?? 0) -
      (worker.sourceId === supply.id ? worker.work : 0));
    const acquisition = supply.kind === 'harvest'
      ? Math.ceil(amount / (worker.work * HARVEST_POWER)) * (1 + otherWork / worker.work)
      : 1;
    const cost = (travel + acquisition) / amount;
    const retained = supply.id === worker.sourceId;
    const bestRetained = best?.id === worker.sourceId;
    if (cost < bestCost || (cost === bestCost &&
        (retained !== bestRetained ? retained : !best || supply.id.localeCompare(best.id) < 0))) {
      best = supply;
      bestCost = cost;
    }
  }
  // If every source is empty, wait near one expected to regenerate soon.
  // A usable store/drop/other source always wins before this fallback.
  if (!best && worker.work > 0) {
    let waitCost = Infinity;
    for (const supply of supplies) {
      if (supply.kind !== 'harvest' || supply.pos.roomName !== worker.pos.roomName) continue;
      const travel = Math.max(0, Math.max(Math.abs(worker.pos.x - supply.pos.x),
        Math.abs(worker.pos.y - supply.pos.y)) - 1);
      if (travel > 0 && worker.move <= 0) continue;
      const cost = Math.max(travel, supply.regeneration ?? Infinity);
      if (!best || cost < waitCost || (cost === waitCost && supply.id.localeCompare(best.id) < 0)) {
        best = supply;
        waitCost = cost;
      }
    }
  }
  return best;
}
