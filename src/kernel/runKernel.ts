import { runColony, type ColonyTick } from '../colony/runColony';
import { cleanupDeadCreepMemory, initializeMemory } from '../memory/lifecycle';
import { publishOpsSnapshot, recordOpsError } from '../ops/opsTelemetry';

const STATUS_INTERVAL = 100;

export function runKernel(): void {
  const cpuStart = Game.cpu.getUsed();

  initializeMemory();
  cleanupDeadCreepMemory();

  const ownedRooms = Object.values(Game.rooms).filter(
    (room) => room.controller?.my
  );

  const colonies = new Map<string, ColonyTick>();
  // Screeps accepts only one global safe-mode intent: a later request can
  // replace an earlier one. Existing protection also prevents activation.
  let canActivateSafeMode = !ownedRooms.some((room) => Boolean(room.controller?.safeMode));
  for (const room of ownedRooms) {
    try {
      const colony = runColony(room, canActivateSafeMode, () => {
        const result = room.controller!.activateSafeMode();
        // Record the global gate immediately, even if later colony work throws.
        if (result === OK) canActivateSafeMode = false;
        return result;
      });
      colonies.set(room.name, colony);
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
