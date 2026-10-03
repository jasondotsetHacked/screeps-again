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
import type { WorkerExecution } from '../work/execution';
import { planSafety, type SafetyPlan } from './planSafety';

export interface ColonyTick {
  state: ColonyState;
  demands: WorkDemand[];
  assignments: WorkerAssignment[];
  executions: WorkerExecution[];
  safety: SafetyPlan & { accepted: boolean };
}

export function runColony(room: Room, canActivateSafeMode = true,
  activateSafeMode: () => number = () => room.controller!.activateSafeMode()): ColonyTick {
  recoverWorkerMemory(room);

  const state = observeColony(room);
  runTowers(state);
  const safety = { ...planSafety(state, canActivateSafeMode), accepted: false };
  if (safety.activateSafeMode) {
    try {
      safety.accepted = activateSafeMode() === OK;
    } catch (error) {
      recordOpsError('colony', room.name + '/safety', error);
    }
  }
  // Preserve tower-first survival behavior. Site placement is transitional;
  // newly placed sites enter the next tick's shared observation.
  try {
    runConstruction(room);
  } catch (error) {
    // Optional site placement must not abort population recovery or labor.
    recordOpsError('colony', room.name + '/construction', error);
  }
  runSpawning(room, state);
  const demands = planWork(state);
  const assignments = scheduleWorkers(state, demands);
  const byName = new Map(assignments.map((assignment) => [assignment.creepName, assignment]));
  const energy = workerEnergyContext(state);
  const executions: WorkerExecution[] = [];

  for (const creep of state.workerCreeps) {
    try {
      executions.push(runWorker(creep, byName.get(creep.name), energy));
    } catch (error) {
      recordOpsError('creep', creep.name, error);
      executions.push({ creepName: creep.name, phase: 'blocked', accepted: false });
      console.log(
        '[creep:error] ' +
          creep.name +
          ': ' +
          (error instanceof Error ? error.stack ?? error.message : String(error))
      );
    }
  }
  return { state, demands, assignments, executions, safety };
}
