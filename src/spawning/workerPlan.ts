import { bodyCost, buildWorkerBody } from './workerBody';

interface WorkerIdentity {
  kind?: string;
  home?: string;
}

interface ExistingWorker {
  name: string;
  memory: WorkerIdentity;
  spawning: boolean;
  ticksToLive?: number;
}

interface SpawningWorker {
  name: string;
  memory?: WorkerIdentity;
}

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
  workers: readonly ExistingWorker[];
  spawning: readonly SpawningWorker[];
  replacementLead: number;
  target: number;
}): WorkerPopulation {
  const belongs = (memory: WorkerIdentity | undefined): boolean =>
    memory?.kind === 'worker' && memory.home === input.roomName;
  const existingByName = new Map(
    input.workers
      .filter((worker) => belongs(worker.memory))
      .map((worker) => [worker.name, worker])
  );
  const spawningNames = new Set(
    input.spawning
      .filter((worker) => belongs(worker.memory))
      .map((worker) => worker.name)
  );
  const spawnRepresentations = new Set(input.spawning.map((worker) => worker.name));

  // Either representation can establish that a known worker is spawning.
  for (const worker of existingByName.values()) {
    if (worker.spawning || spawnRepresentations.has(worker.name)) {
      spawningNames.add(worker.name);
    }
  }

  let liveWorkers = 0;
  let agingWorkers = 0;
  for (const worker of existingByName.values()) {
    if (spawningNames.has(worker.name)) continue;
    liveWorkers += 1;
    if (
      worker.ticksToLive !== undefined &&
      worker.ticksToLive <= input.replacementLead
    ) {
      agingWorkers += 1;
    }
  }

  return {
    liveWorkers,
    spawningWorkers: spawningNames.size,
    agingWorkers,
    effectiveWorkers: liveWorkers - agingWorkers + spawningNames.size,
    target: input.target
  };
}

export interface WorkerSpawnPlan {
  reason: 'bootstrap' | 'critical-depletion' | 'normal';
  body: BodyPartConstant[];
  energyBudget: number;
  cost: number;
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
    reason: population.effectiveWorkers === 0
      ? 'bootstrap'
      : depleted ? 'critical-depletion' : 'normal',
    body,
    energyBudget,
    cost: bodyCost(body)
  };
}
