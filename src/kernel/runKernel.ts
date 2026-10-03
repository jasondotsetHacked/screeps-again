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
  for (const room of ownedRooms) {
    try {
      colonies.set(room.name, runColony(room));
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
