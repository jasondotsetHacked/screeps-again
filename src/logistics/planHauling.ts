import type { EnergySupply } from '../colony/planEnergy';
import type { WorkPosition, WorkTarget } from '../work/demands';
import { distance, type SourceOperation } from '../operations/sourceOperation';

export interface RefillConsumer extends WorkTarget { amount: number; priority: number; critical?: boolean }
export interface HaulAssignment { kind: 'withdraw' | 'transfer'; target: WorkTarget; amount: number }

export interface HaulerLoad {
  pos: WorkPosition; energy: number; freeCapacity: number; delivering?: boolean; loadingSupported?: boolean;
}

export function haulerDeliveryMode(creep: HaulerLoad, operation: SourceOperation | undefined,
  consumers: readonly RefillConsumer[]): boolean {
  if (creep.energy <= 0) return false;
  // Half a body load amortizes a trip without requiring a large source backlog.
  // Once dispatched, finish delivering rather than turning around after a small
  // sink. The only durable state is this load/use intent, never a resource promise.
  return Boolean(creep.delivering || creep.energy >= Math.ceil((creep.energy + creep.freeCapacity) / 2) ||
    !operation?.ready || creep.loadingSupported === false ||
    consumers.some((c) => c.pos.roomName === creep.pos.roomName && c.amount > 0 && c.critical));
}

export function planHauling(creep: HaulerLoad,
  operation: SourceOperation | undefined, supplies: readonly EnergySupply[],
  consumers: readonly RefillConsumer[]): HaulAssignment | undefined {
  if (!operation || creep.pos.roomName !== operation.home) return undefined;
  if (haulerDeliveryMode(creep, operation, consumers)) {
    const sink = consumers.filter((c) => c.pos.roomName === operation.home && c.amount > 0)
      .sort((a, b) => Number(Boolean(b.critical)) - Number(Boolean(a.critical)) ||
        b.priority - a.priority || distance(creep.pos, a.pos) - distance(creep.pos, b.pos) ||
        a.id.localeCompare(b.id))[0];
    if (sink) return { kind: 'transfer', target: sink, amount: Math.min(creep.energy, sink.amount) };
  }
  if (!operation.ready) return undefined;
  const supply = supplies.find((s) => s.id === operation.bufferId && s.kind === 'withdraw' &&
    s.pos.roomName === operation.home && s.amount > 0);
  return supply && creep.freeCapacity > 0
    ? { kind: 'withdraw', target: supply, amount: Math.min(creep.freeCapacity, supply.amount) } : undefined;
}
