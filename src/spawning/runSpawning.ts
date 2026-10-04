import { createCreepMemory, creepName } from '../creeps/identity';
import type { SpawnPlan } from './spawnPlan';

export interface SpawnAttempt {
  name: string;
  requestId: string;
  result: ScreepsReturnCode;
}

// The home colony supplies its capacity and an arbitrated plan. No population
// targets, role-specific bodies or initial-state policy belong in this adapter.
export function runSpawning(room: Room, plan: SpawnPlan | null,
  spawns: readonly StructureSpawn[]): SpawnAttempt | null {
  if (!plan || plan.request.identity.home !== room.name) return null;
  const spawn = spawns.find((candidate) => !candidate.spawning);
  if (!spawn) return null;
  const request = plan.request;
  const name = creepName(request.identity, Game.time.toString(36));
  const result = spawn.spawnCreep([...request.body], name, {
    memory: createCreepMemory(request.identity, Game.time, request.initialMemory)
  });
  if (result === OK) console.log(request.explanation);
  return { name, requestId: request.id, result };
}
