import { bodyCost, buildWorkerBody } from './workerBody';
import { countPopulation, type PopulationCreep, type SpawningCreep } from './population';
import type { PopulationRequest } from './spawnPlan';

export interface WorkerPopulation {
  // Live includes aging workers; spawning is a separate, disjoint count.
  liveWorkers: number;
  spawningWorkers: number;
  agingWorkers: number;
  effectiveWorkers: number;
  target: number;
}

export function workerTarget(sourceCount: number, capacity: number): number {
  if (capacity <= 300) return Math.max(3, sourceCount * 3);
  if (capacity <= 550) return Math.max(4, sourceCount * 2 + 1);
  return Math.max(4, sourceCount + 2);
}

export function planWorkerPopulation(input: {
  roomName: string;
  workers: readonly PopulationCreep[];
  spawning: readonly SpawningCreep[];
  replacementLead: number;
  target: number;
}): WorkerPopulation {
  const count = countPopulation({
    identity: { kind: 'worker', home: input.roomName },
    creeps: input.workers, spawning: input.spawning, replacementLead: input.replacementLead
  });
  return {
    liveWorkers: count.live,
    spawningWorkers: count.spawning,
    agingWorkers: count.aging,
    effectiveWorkers: count.effective,
    target: input.target
  };
}

export interface WorkerSpawnPlan {
  reason: 'bootstrap' | 'critical-depletion' | 'normal';
  body: BodyPartConstant[];
  energyBudget: number;
  cost: number;
}

export function requestWorkerPopulation(input: {
  home: string;
  population: WorkerPopulation;
  replacementLead: number;
  energyAvailable: number;
  energyCapacity: number;
}): PopulationRequest | null {
  const { population, home } = input;
  // Keep unmet intent visible to arbitration even while waiting for energy.
  // Recovery uses the affordable body when possible; otherwise reserve the
  // preferred body until the next tick reobserves energy and recomputes requests.
  const plan = planWorkerSpawn(population, input.energyAvailable, input.energyCapacity)
    ?? planWorkerSpawn(population, input.energyCapacity, input.energyCapacity);
  if (!plan) return null;
  return {
    id: `workers:${home}`,
    identity: { kind: 'worker', home },
    priority: plan.reason === 'bootstrap' ? 'bootstrap'
      : plan.reason === 'critical-depletion' ? 'recovery' : 'normal',
    body: plan.body,
    initialMemory: { working: false },
    reason: plan.reason,
    explanation: plan.reason !== 'normal'
      ? `[spawn] ${home} recovery=${plan.reason}; effective=${population.effectiveWorkers}/${population.target}; body=${plan.body.join(',')}; budget=${plan.energyBudget}; cost=${plan.cost}`
      : `[spawn] ${home} worker ${population.effectiveWorkers + 1}/${population.target}; replacement lead=${input.replacementLead} ticks`
  };
}

export function planWorkerSpawn(
  population: WorkerPopulation,
  energyAvailable: number,
  energyCapacity: number
): WorkerSpawnPlan | null {
  if (population.effectiveWorkers >= population.target) return null;

  const normalBody = buildWorkerBody(energyCapacity);
  if (normalBody.length === 0) return null;
  const normalCost = bodyCost(normalBody);
  const criticalThreshold = Math.max(1, Math.floor(population.target / 3));
  const depleted = population.effectiveWorkers <= criticalThreshold;

  if (!depleted && energyAvailable < normalCost) return null;

  // Recovery can spend available energy, but always prefers the normal body
  // when affordable. Healthy colonies wait for that body.
  const energyBudget = energyAvailable >= normalCost
    ? energyCapacity
    : Math.min(energyAvailable, energyCapacity);
  const body = buildWorkerBody(energyBudget);
  if (body.length === 0) return null;

  return {
    reason: population.liveWorkers === 0 && population.spawningWorkers === 0
      ? 'bootstrap'
      : depleted ? 'critical-depletion' : 'normal',
    body,
    energyBudget,
    cost: bodyCost(body)
  };
}
