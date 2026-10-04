import { runConstruction } from '../construction/runConstruction';
import { runWorker, workerEnergyContext } from '../creeps/runWorker';
import { recoverColonyCreepMemory } from '../memory/lifecycle';
import { recordOpsError } from '../ops/opsTelemetry';
import { runSpawning } from '../spawning/runSpawning';
import { requestWorkerPopulation } from '../spawning/workerPlan';
import { planSpawn } from '../spawning/spawnPlan';
import { runTowers } from '../structures/runTowers';
import { observeColony, type ColonyState } from './colonyState';
import { planWork } from './planWork';
import { scheduleWorkers } from './scheduler';
import type { WorkDemand } from '../work/demands';
import type { WorkerAssignment } from '../work/assignments';
import type { WorkerExecution } from '../work/execution';
import { planSafety, type SafetyOutcome } from './planSafety';
import { observeSourceOperations } from '../operations/observeSources';
import { requestSourcePopulation, type SourceOperation } from '../operations/sourceOperation';
import { runSourceLogistics } from './runSourceLogistics';

export interface ColonyObservation {
  state: ColonyState;
  safety: SafetyOutcome;
}

export interface ColonyTick {
  state: ColonyState;
  demands: WorkDemand[];
  assignments: WorkerAssignment[];
  executions: WorkerExecution[];
  safety: SafetyOutcome;
}

export function prepareColony(room: Room): ColonyObservation {
  recoverColonyCreepMemory(room);
  const state = observeColony(room);
  return { state, safety: { ...planSafety(state), attempted: false, accepted: false } };
}

export function runColony(room: Room, observation = prepareColony(room)): ColonyTick {
  const { state, safety } = observation;
  runTowers(state);
  let operations: SourceOperation[] = [];
  try { operations = observeSourceOperations(state); }
  catch (error) { recordOpsError('colony', room.name + '/source-planning', error); }
  // Preserve tower-first survival behavior. Site placement is transitional;
  // newly placed sites enter the next tick's shared observation.
  try {
    runConstruction(room, operations);
  } catch (error) {
    // Optional site placement must not abort population recovery or labor.
    recordOpsError('colony', room.name + '/construction', error);
  }
  const workerRequest = requestWorkerPopulation({
    home: room.name, population: state.population, replacementLead: state.replacementLead,
    energyAvailable: room.energyAvailable, energyCapacity: room.energyCapacityAvailable
  });
  runSpawning(room, planSpawn({
    home: room.name, requests: [
      ...(workerRequest ? [workerRequest] : []),
      ...requestSourcePopulation(operations, Object.values(Game.creeps), state.spawns.flatMap((spawn) => {
        const name = spawn.spawning?.name;
        return name ? [{ name, memory: Memory.creeps[name] }] : [];
      }))
    ],
    energyAvailable: room.energyAvailable, energyCapacity: room.energyCapacityAvailable
  }), state.spawns);
  const energy = workerEnergyContext(state);
  runSourceLogistics(state, operations, energy, planWork(state));
  const demands = planWork({ ...state, refillTargets: state.refillTargets.map((target) => ({ ...target,
    freeEnergy: energy.consumers?.find((consumer) => consumer.id === target.id)?.amount ?? target.freeEnergy
  })) });
  const assignments = scheduleWorkers(state, demands);
  const byName = new Map(assignments.map((assignment) => [assignment.creepName, assignment]));
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
