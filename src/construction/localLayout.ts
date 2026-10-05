import type { WorkPosition } from '../work/demands';
import type { RoomPlan } from '../../shared/roomPlan/types';

/** Compatibility projection; there is no second placement engine. */
export interface LocalLayout {
  storage?: WorkPosition; coreLink?: WorkPosition; terminal?: WorkPosition; coreAccess?: WorkPosition;
  controllerBuffer?: WorkPosition; controllerLink?: WorkPosition; controllerWork?: WorkPosition;
}
export function layoutReservations(layout: LocalLayout): WorkPosition[] {
  return Object.values(layout).filter((p): p is WorkPosition => Boolean(p));
}
export function projectLocalLayout(plan: RoomPlan): LocalLayout {
  const pos = (p: { x: number; y: number } | undefined): WorkPosition | undefined => p ? { ...p, roomName: plan.roomName } : undefined;
  return { storage: pos(plan.core?.storage), coreLink: pos(plan.core?.link), terminal: pos(plan.core?.terminal),
    coreAccess: pos(plan.core?.manager), controllerBuffer: pos(plan.controller?.container),
    controllerLink: pos(plan.controller?.link), controllerWork: pos(plan.controller?.work[0]) };
}
