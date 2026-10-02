import { cleanupDeadCreepMemory, initializeMemory } from '../memory/lifecycle';

const STATUS_INTERVAL = 100;

export function runKernel(): void {
  const cpuStart = Game.cpu.getUsed();

  initializeMemory();
  cleanupDeadCreepMemory();

  const ownedRooms = Object.values(Game.rooms).filter((room) => room.controller?.my);

  if (Game.time % STATUS_INTERVAL === 0) {
    const roomNames = ownedRooms.map((room) => room.name).join(', ') || 'none';
    const cpuUsed = Game.cpu.getUsed() - cpuStart;

    console.log(
      `[kernel] tick=${Game.time} ownedRooms=${roomNames} creeps=${Object.keys(Game.creeps).length} cpu=${cpuUsed.toFixed(2)}`
    );
  }
}
