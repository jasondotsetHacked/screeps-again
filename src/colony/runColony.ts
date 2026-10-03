import { runConstruction } from '../construction/runConstruction';
import { runWorker, workerEnergyContext } from '../creeps/runWorker';
import { recoverWorkerMemory } from '../memory/lifecycle';
import { recordOpsError } from '../ops/opsTelemetry';
import { runSpawning } from '../spawning/runSpawning';
import { runTowers } from '../structures/runTowers';
import { observeColony, type ColonyState } from './colonyState';
import { planWork } from './planWork';
import { scheduleWorkers } from './scheduler';
import type { WorkDemand } from '../work/demands';
import type { WorkerAssignment } from '../work/assignments';

export interface ColonyTick {
  state: ColonyState;
  demands: WorkDemand[];
  assignments: WorkerAssignment[];
}

export function runColony(room: Room): ColonyTick {
  recoverWorkerMemory(room);

  const state = observeColony(room);
  runTowers(state);
  // Preserve tower-first survival behavior. Site placement is transitional;
  // newly placed sites enter the next tick's shared observation.
  runConstruction(room);
  runSpawning(room, state);
  const demands = planWork(state);
  const assignments = scheduleWorkers(state, demands);
  const byName = new Map(assignments.map((assignment) => [assignment.creepName, assignment]));
  const energy = workerEnergyContext(state);

  for (const creep of state.workerCreeps) {
    try {
      runWorker(creep, byName.get(creep.name), energy);
    } catch (error) {
      recordOpsError('creep', creep.name, error);
      console.log(
        '[creep:error] ' +
          creep.name +
          ': ' +
          (error instanceof Error ? error.stack ?? error.message : String(error))
      );
    }
  }
  return { state, demands, assignments };
}
