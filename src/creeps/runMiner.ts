import { distance, type SourceOperation } from '../operations/sourceOperation';
import { readNamedCreepIdentity } from './identity';
import type { WorkPosition } from '../work/demands';

export function runMiner(creep: Creep, operation: SourceOperation | undefined, assigned: boolean,
  waitingPosition?: WorkPosition): boolean {
  const identity = readNamedCreepIdentity(creep.name, creep.memory);
  if (creep.spawning || !operation?.ready || !operation.tile || creep.room.name !== operation.home ||
      identity?.kind !== 'miner' || identity.home !== operation.home || identity.operationId !== operation.id) return false;
  const source = Game.getObjectById(operation.source.id as Id<Source>);
  const buffer = operation.bufferId && Game.getObjectById(operation.bufferId as Id<StructureContainer>);
  if (!source || !buffer || source.pos.roomName !== operation.home || buffer.pos.roomName !== operation.home) return false;
  const tile = new RoomPosition(operation.tile.x, operation.tile.y, operation.home);
  if (!assigned) {
    // Replacement overlap waits beside the incumbent, never harvests a second
    // source or competes for the single stationary position.
    if (distance(creep.pos, tile) === 0 && waitingPosition?.roomName === operation.home &&
        creep.getActiveBodyparts(MOVE) > 0) {
      creep.moveTo(new RoomPosition(waitingPosition.x, waitingPosition.y, operation.home),
        { reusePath: 10, maxRooms: 1, range: 0 });
    } else if (distance(creep.pos, tile) > 1 && creep.getActiveBodyparts(MOVE) > 0) {
      creep.moveTo(tile, { reusePath: 10, maxRooms: 1, range: 1 });
    }
    return false;
  }
  if (creep.getActiveBodyparts(WORK) === 0 || creep.getActiveBodyparts(CARRY) === 0) return false;
  if (distance(creep.pos, tile) > 0) {
    creep.moveTo(tile, { reusePath: 10, maxRooms: 1, range: 0 });
    return false;
  }
  let depositing = buffer.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && depositing) {
    depositing = creep.transfer(buffer, RESOURCE_ENERGY) === OK;
  }
  // Harvest and transfer can coexist; both use start-of-tick carried energy.
  // A CARRY part holds five harvest ticks, avoiding the full-store transfer gap.
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    const result = creep.harvest(source);
    return depositing && (result === OK || (source.energy === 0 && result === ERR_NOT_ENOUGH_RESOURCES));
  }
  return false;
}
