// Extend the kind union when a population has a producer and an executor.
// Identity is durable ownership, never the creep's current physical room.
export type CreepKind = 'worker' | 'miner' | 'hauler';

export interface CreepIdentity {
  kind: CreepKind;
  home: string;
  operationId?: string;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function recoveryKey(value: string): string { return encodeURIComponent(value).replace(/~/g, '%7E'); }

export function readCreepIdentity(memory: unknown): CreepIdentity | null {
  if (!memory || typeof memory !== 'object') return null;
  const value = memory as Record<string, unknown>;
  if ((value.kind !== 'worker' && value.kind !== 'miner' && value.kind !== 'hauler') ||
      !nonemptyString(value.home) ||
      (value.operationId !== undefined && !nonemptyString(value.operationId)) ||
      (value.kind !== 'worker' && !nonemptyString(value.operationId))) return null;
  return {
    kind: value.kind, home: value.home,
    ...(value.operationId === undefined ? {} : { operationId: value.operationId })
  };
}

export function samePopulation(a: CreepIdentity, b: CreepIdentity): boolean {
  return a.kind === b.kind && a.home === b.home && a.operationId === b.operationId;
}

// Specialist recovery keys are also an integrity check: damaged metadata must
// not silently turn a source-A body into a source-B body (or a worker). Legacy
// worker Memory remains authoritative, including deployed names that disagree.
export function readNamedCreepIdentity(name: string, memory: unknown): CreepIdentity | null {
  const identity = readCreepIdentity(memory);
  if (!identity) return null;
  const named = identityFromName(name);
  if (identity.kind !== 'worker' || (named && named.kind !== 'worker')) {
    return named && samePopulation(identity, named) ? identity : null;
  }
  return identity;
}

export function identityConflicts(memory: unknown, identity: CreepIdentity): boolean {
  if (!memory || typeof memory !== 'object') return false;
  const value = memory as Record<string, unknown>;
  return (nonemptyString(value.kind) && value.kind !== identity.kind) ||
    (nonemptyString(value.home) && value.home !== identity.home) ||
    (value.operationId !== undefined && value.operationId !== identity.operationId);
}

export function creepName(identity: CreepIdentity, suffix: string): string {
  if (identity.kind !== 'worker') {
    // Generic operation recovery key; no source strategy belongs in spawning.
    return `${identity.kind}-${identity.home}~${recoveryKey(identity.operationId!)}~${suffix}`;
  }
  return `${identity.kind}-${identity.home}-${suffix}`;
}

// The existing worker naming contract is a fallback, not authoritative identity.
// Workers retain their deployed contract. Specialists carry a generic recovery
// key in their name, so a Memory reset cannot erase their population scope.
export function identityFromName(name: string): CreepIdentity | null {
  const match = /^worker-([EW]\d+[NS]\d+)-([a-z0-9]+)$/.exec(name);
  if (match) return { kind: 'worker', home: match[1] };
  const specialist = /^(miner|hauler)-([EW]\d+[NS]\d+)~([^~]+)~([a-z0-9]+)$/.exec(name);
  if (!specialist) return null;
  try {
    const operationId = decodeURIComponent(specialist[3]);
    if (!operationId || recoveryKey(operationId) !== specialist[3]) return null;
    return { kind: specialist[1] as CreepKind, home: specialist[2], operationId };
  } catch { return null; }
}

export function recoverCreepIdentity(name: string, memory: unknown): CreepIdentity | null {
  if (readCreepIdentity(memory)) return null;
  const fallback = identityFromName(name);
  if (!fallback) return null;
  const value = memory && typeof memory === 'object'
    ? memory as Record<string, unknown> : {};
  if (fallback.kind !== 'worker') {
    return identityConflicts(memory, fallback) ? null : fallback;
  }
  // Partial metadata can establish a conflicting owner or kind. Never adopt it
  // by name. Preserve operation intent rather than silently dropping it.
  if (value.operationId !== undefined && !nonemptyString(value.operationId)) return null;
  const identity = { ...fallback,
    ...(value.operationId === undefined ? {} : { operationId: value.operationId }) };
  return identityConflicts(memory, identity) ? null : identity;
}

export function createCreepMemory(identity: CreepIdentity, born: number,
  initial: Omit<CreepMemory, keyof CreepIdentity | 'born'> = {}): CreepMemory {
  return { ...initial, ...identity, born };
}
