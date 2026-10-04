import { identityConflicts, readCreepIdentity, samePopulation, type CreepIdentity } from '../creeps/identity';

export interface PopulationCreep {
  name: string;
  memory?: unknown;
  spawning: boolean;
  ticksToLive?: number;
}

export interface SpawningCreep {
  name: string;
  memory?: unknown;
}

export interface PopulationCount {
  live: number;
  spawning: number;
  aging: number;
  effective: number;
}

// One name is one body. A valid live identity takes precedence over a stale
// spawn-memory representation; either representation can establish spawning.
export function countPopulation(input: {
  identity: CreepIdentity;
  creeps: readonly PopulationCreep[];
  spawning: readonly SpawningCreep[];
  replacementLead: number;
}): PopulationCount {
  const byName = new Map(input.creeps.map((creep) => [creep.name, creep]));
  const identities = new Map(input.creeps.map((creep) =>
    [creep.name, readCreepIdentity(creep.memory)]));
  const spawningNames = new Set<string>();
  for (const creep of input.spawning) {
    spawningNames.add(creep.name);
    const identity = readCreepIdentity(creep.memory);
    if (!identities.get(creep.name) && identity &&
        !identityConflicts(byName.get(creep.name)?.memory, identity)) {
      identities.set(creep.name, identity);
    }
  }
  let live = 0;
  let spawning = 0;
  let aging = 0;
  for (const [name, identity] of identities) {
    if (!identity || !samePopulation(identity, input.identity)) continue;
    const creep = byName.get(name);
    if (creep?.spawning || spawningNames.has(name)) {
      spawning += 1;
    } else {
      live += 1;
      if (creep?.ticksToLive !== undefined && creep.ticksToLive <= input.replacementLead) aging += 1;
    }
  }
  return { live, spawning, aging, effective: live - aging + spawning };
}
