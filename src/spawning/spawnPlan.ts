import { readCreepIdentity, type CreepIdentity } from '../creeps/identity';

// A tick-local request for one body, produced only while its population needs
// service. Producers own targets, body policy, replacement lead and initial state.
export interface PopulationRequest {
  id: string;
  identity: CreepIdentity;
  priority: 'bootstrap' | 'recovery' | 'normal';
  body: readonly BodyPartConstant[];
  initialMemory: Omit<CreepMemory, keyof CreepIdentity | 'born'>;
  reason: string;
  explanation: string;
}

export interface SpawnPlan {
  request: PopulationRequest;
  cost: number;
}

const PRIORITY = { bootstrap: 2, recovery: 1, normal: 0 };

function validateRequest(request: PopulationRequest): SpawnPlan | null {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.id !== 'string' || request.id.trim().length === 0 ||
      !readCreepIdentity(request.identity) ||
      (request.priority !== 'bootstrap' && request.priority !== 'recovery' && request.priority !== 'normal') ||
      !Array.isArray(request.body) || request.body.length === 0 || request.body.length > 50 ||
      !request.initialMemory || typeof request.initialMemory !== 'object' || Array.isArray(request.initialMemory) ||
      ['kind', 'home', 'operationId', 'born'].some((field) => field in request.initialMemory) ||
      typeof request.reason !== 'string' || typeof request.explanation !== 'string') return null;

  let cost = 0;
  // Iterate every slot: sparse bodies and prototype keys are not body parts.
  for (const part of request.body) {
    if (typeof part !== 'string' || !Object.prototype.hasOwnProperty.call(BODYPART_COST, part)) return null;
    const partCost = BODYPART_COST[part as BodyPartConstant];
    if (!Number.isFinite(partCost) || partCost <= 0) return null;
    cost += partCost;
  }
  return Number.isFinite(cost) && cost > 0 ? { request, cost } : null;
}

// Reserve energy for the highest-priority home request. An unaffordable winner
// waits; lower priorities cannot spend its recovery/preferred-body budget.
// Reject malformed requests first, then reject all home-local ID collisions.
// Remaining IDs break ties independently of input order.
export function planSpawn(input: {
  home: string;
  requests: readonly PopulationRequest[];
  energyAvailable: number;
  energyCapacity: number;
}): SpawnPlan | null {
  const candidates: SpawnPlan[] = [];
  const idCounts = new Map<string, number>();
  for (const request of input.requests) {
    const plan = validateRequest(request);
    if (!plan || request.identity.home !== input.home) continue;
    candidates.push(plan);
    idCounts.set(request.id, (idCounts.get(request.id) ?? 0) + 1);
  }
  const winner = candidates.filter(({ request }) => idCounts.get(request.id) === 1)
    .sort(({ request: a }, { request: b }) => PRIORITY[b.priority] - PRIORITY[a.priority] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!winner || winner.cost > input.energyAvailable || winner.cost > input.energyCapacity) return null;
  return winner;
}
