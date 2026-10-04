import type { HaulAssignment } from '../logistics/planHauling';
import type { SourceOperation } from '../operations/sourceOperation';
import { readNamedCreepIdentity } from './identity';

export type HaulerExecution = 'blocked' | 'idle' | 'travel' | 'resource';

// Distinguish accepted resource intents from usable travel. The colony owns
// reservations and assignment policy; this executor only issues local intents.
export function runHauler(creep: Creep, operation: SourceOperation | undefined,
  assignment: HaulAssignment | undefined): HaulerExecution {
  const identity = readNamedCreepIdentity(creep.name, creep.memory);
  if (creep.spawning || !operation || (!operation.ready && assignment?.kind !== 'transfer') || creep.room.name !== operation.home ||
      identity?.kind !== 'hauler' || identity.home !== operation.home || identity.operationId !== operation.id ||
      creep.getActiveBodyparts(CARRY) === 0 || creep.getActiveBodyparts(MOVE) === 0) return 'blocked';
  if (!assignment) return 'idle';
  if (assignment.target.pos.roomName !== operation.home) return 'blocked';
  const target = Game.getObjectById(assignment.target.id as Id<StructureContainer | StructureSpawn | StructureExtension | StructureTower>);
  if (!target || target.pos.roomName !== operation.home) return 'blocked';
  const result = assignment.kind === 'withdraw'
    ? creep.withdraw(target, RESOURCE_ENERGY, assignment.amount)
    : creep.transfer(target, RESOURCE_ENERGY, assignment.amount);
  return result === ERR_NOT_IN_RANGE
    ? (creep.moveTo(target, { reusePath: 10, maxRooms: 1, range: 1 }) === OK ? 'travel' : 'blocked')
    : result === OK ? 'resource' : 'blocked';
}
