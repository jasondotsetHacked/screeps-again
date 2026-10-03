import { runConstruction } from '../construction/runConstruction';
import { runWorker } from '../creeps/runWorker';
import { runSpawning } from '../spawning/runSpawning';
import { runTowers } from '../structures/runTowers';

export function runColony(room: Room): void {
  runTowers(room);
  runConstruction(room);
  runSpawning(room);

  const creeps = Object.values(Game.creeps).filter(
    (creep) =>
      creep.memory.home === room.name &&
      creep.memory.kind === 'worker'
  );

  for (const creep of creeps) {
    try {
      runWorker(creep);
    } catch (error) {
      console.log(
        `[creep:error] ${creep.name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
    }
  }
}
