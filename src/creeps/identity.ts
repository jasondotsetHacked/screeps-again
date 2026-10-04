// Extend the kind union when a population has a producer and an executor.
// Identity is durable ownership, never the creep's current physical room.
export type CreepKind = 'worker';

export interface CreepIdentity {
  kind: CreepKind;
  home: string;
  operationId?: string;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function readCreepIdentity(memory: unknown): CreepIdentity | null {
  if (!memory || typeof memory !== 'object') return null;
  const value = memory as Record<string, unknown>;
  if (value.kind !== 'worker' || !nonemptyString(value.home) ||
      (value.operationId !== undefined && !nonemptyString(value.operationId))) return null;
  return {
    kind: value.kind, home: value.home,
    ...(value.operationId === undefined ? {} : { operationId: value.operationId })
  };
}

export function samePopulation(a: CreepIdentity, b: CreepIdentity): boolean {
  return a.kind === b.kind && a.home === b.home && a.operationId === b.operationId;
}

export function identityConflicts(memory: unknown, identity: CreepIdentity): boolean {
  if (!memory || typeof memory !== 'object') return false;
  const value = memory as Record<string, unknown>;
  return (nonemptyString(value.kind) && value.kind !== identity.kind) ||
    (nonemptyString(value.home) && value.home !== identity.home) ||
    (value.operationId !== undefined && value.operationId !== identity.operationId);
}

export function creepName(identity: CreepIdentity, suffix: string): string {
  return `${identity.kind}-${identity.home}-${suffix}`;
}

// The existing worker naming contract is a fallback, not authoritative identity.
// Do not infer operation identity from a name.
export function identityFromName(name: string): CreepIdentity | null {
  const match = /^worker-([EW]\d+[NS]\d+)-([a-z0-9]+)$/.exec(name);
  return match ? { kind: 'worker', home: match[1] } : null;
}

export function recoverCreepIdentity(name: string, memory: unknown): CreepIdentity | null {
  if (readCreepIdentity(memory)) return null;
  const fallback = identityFromName(name);
  if (!fallback) return null;
  const value = memory && typeof memory === 'object'
    ? memory as Record<string, unknown> : {};
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
