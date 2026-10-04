import type { EnergySupply } from '../colony/planEnergy';
import type { WorkPosition, WorkTarget } from '../work/demands';
import { distance, type SourceOperation } from '../operations/sourceOperation';

export interface RefillConsumer extends WorkTarget { amount: number; priority: number }
export interface HaulAssignment { kind: 'withdraw' | 'transfer'; target: WorkTarget; amount: number }

export function planHauling(creep: { pos: WorkPosition; energy: number; freeCapacity: number },
  operation: SourceOperation | undefined, supplies: readonly EnergySupply[],
  consumers: readonly RefillConsumer[]): HaulAssignment | undefined {
  if (!operation || creep.pos.roomName !== operation.home) return undefined;
  if (creep.energy > 0) {
    const sink = consumers.filter((c) => c.pos.roomName === operation.home && c.amount > 0)
      .sort((a, b) => b.priority - a.priority || distance(creep.pos, a.pos) - distance(creep.pos, b.pos) ||
        a.id.localeCompare(b.id))[0];
    return sink ? { kind: 'transfer', target: sink, amount: Math.min(creep.energy, sink.amount) } : undefined;
  }
  if (!operation.ready) return undefined;
  const supply = supplies.find((s) => s.id === operation.bufferId && s.kind === 'withdraw' &&
    s.pos.roomName === operation.home && s.amount > 0);
  return supply && creep.freeCapacity > 0
    ? { kind: 'withdraw', target: supply, amount: Math.min(creep.freeCapacity, supply.amount) } : undefined;
}
