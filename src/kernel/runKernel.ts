import { prepareColony, runColony, type ColonyObservation, type ColonyTick } from '../colony/runColony';
import { cleanupDeadCreepMemory, initializeMemory } from '../memory/lifecycle';
import { publishOpsSnapshot, recordOpsError } from '../ops/opsTelemetry';
import { arbitrateSafety } from './arbitrateSafety';
import { updateVisibleRoomIntel } from '../world/roomIntel';

const STATUS_INTERVAL = 100;

export function runKernel(): void {
  const cpuStart = Game.cpu.getUsed();

  initializeMemory();
  cleanupDeadCreepMemory();

  const ownedRooms = Object.values(Game.rooms).filter(
    (room) => room.controller?.my
  );

  const observations = new Map<string, ColonyObservation>();
  for (const room of ownedRooms) {
    try {
      observations.set(room.name, prepareColony(room));
    } catch (error) {
      recordOpsError('colony', room.name + '/observation', error);
    }
  }
  updateVisibleRoomIntel(Object.values(Game.rooms), observations);
  const protectionActive = ownedRooms.some((room) => Boolean(room.controller?.safeMode));
  const winner = arbitrateSafety([...observations.values()].flatMap((colony) =>
    colony.safety.request ? [colony.safety.request] : []), protectionActive);
  for (const observation of observations.values()) {
    const safety = observation.safety;
    if (safety.request && safety.request !== winner) {
      safety.reason = protectionActive ? 'safe-mode-elsewhere' : 'arbitration-deferred';
    }
  }
  if (winner) {
    const safety = observations.get(winner.roomName)!.safety;
    safety.attempted = true;
    try {
      safety.accepted = Game.rooms[winner.roomName].controller!.activateSafeMode() === OK;
    } catch (error) {
      // Detailed errors stay in private console diagnostics, not public ops.
      console.log('[safety:error] ' + winner.roomName + ': ' + String(error));
      recordOpsError('colony', winner.roomName + '/safety', 'Safe-mode activation failed');
    }
  }

  const colonies = new Map<string, ColonyTick>();
  for (const room of ownedRooms) {
    const observation = observations.get(room.name);
    if (!observation) continue;
    try {
      colonies.set(room.name, runColony(room, observation));
    } catch (error) {
      recordOpsError('colony', room.name, error);
      console.log(
        '[colony:error] ' +
          room.name +
          ': ' +
          (error instanceof Error ? error.stack ?? error.message : String(error))
      );
    }
  }

  publishOpsSnapshot(ownedRooms, cpuStart, colonies);

  if (Game.time % STATUS_INTERVAL === 0) {
    const roomNames = ownedRooms.map((room) => room.name).join(', ') || 'none';
    const cpuUsed = Game.cpu.getUsed() - cpuStart;

    console.log(
      '[kernel] tick=' +
        Game.time +
        ' ownedRooms=' +
        roomNames +
        ' creeps=' +
        Object.keys(Game.creeps).length +
        ' bucket=' +
        Game.cpu.bucket +
        ' cpu=' +
        cpuUsed.toFixed(2)
    );
  }
}
