import type { HaulAssignment } from '../logistics/planHauling';
import type { SourceOperation } from '../operations/sourceOperation';
import { readNamedCreepIdentity } from './identity';

// Returns whether the planned intent/path remains usable. The colony owns
// reservations and assignment policy; this executor only issues local intents.
export function runHauler(creep: Creep, operation: SourceOperation | undefined,
  assignment: HaulAssignment | undefined): boolean {
  const identity = readNamedCreepIdentity(creep.name, creep.memory);
  if (creep.spawning || !operation || (!operation.ready && assignment?.kind !== 'transfer') || creep.room.name !== operation.home ||
      identity?.kind !== 'hauler' || identity.home !== operation.home || identity.operationId !== operation.id ||
      creep.getActiveBodyparts(CARRY) === 0 || creep.getActiveBodyparts(MOVE) === 0) return false;
  if (!assignment) return true;
  if (assignment.target.pos.roomName !== operation.home) return false;
  const target = Game.getObjectById(assignment.target.id as Id<StructureContainer | StructureSpawn | StructureExtension | StructureTower>);
  if (!target || target.pos.roomName !== operation.home) return false;
  const result = assignment.kind === 'withdraw'
    ? creep.withdraw(target, RESOURCE_ENERGY, assignment.amount)
    : creep.transfer(target, RESOURCE_ENERGY, assignment.amount);
  return result === ERR_NOT_IN_RANGE
    ? creep.moveTo(target, { reusePath: 10, maxRooms: 1, range: 1 }) === OK : result === OK;
}
