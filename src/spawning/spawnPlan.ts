import type { CreepIdentity } from '../creeps/identity';
import { bodyCost } from './body';

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

// Reserve energy for the highest-priority home request. An unaffordable winner
// waits; lower priorities cannot spend its recovery/preferred-body budget.
// Request IDs must be unique within a home, and break ties independently of order.
export function planSpawn(input: {
  home: string;
  requests: readonly PopulationRequest[];
  energyAvailable: number;
  energyCapacity: number;
}): SpawnPlan | null {
  const request = input.requests.filter((entry) => entry.identity.home === input.home)
    .sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!request || request.body.length === 0 || request.body.length > 50) return null;
  const cost = bodyCost(request.body);
  if (!Number.isFinite(cost) || cost <= 0 ||
      cost > input.energyAvailable || cost > input.energyCapacity) return null;
  return { request, cost };
}
