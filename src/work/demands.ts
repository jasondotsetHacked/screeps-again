export type WorkKind = 'refill' | 'build' | 'repair' | 'upgrade';
export type WorkCapability = 'work' | 'carry';

export interface WorkPosition {
  x: number;
  y: number;
  roomName: string;
}

export interface WorkTarget {
  id: string;
  pos: WorkPosition;
}

// Contributions are active WORK or CARRY parts, not creep counts or rates.
export interface WorkDemand {
  id: string;
  kind: WorkKind;
  target: WorkTarget;
  priority: number;
  minimum: number;
  desired: number;
  maximum?: number;
  capability: WorkCapability;
  emergency?: boolean;
  // Optional third-pass service. After all bounded desired work has been
  // scheduled, otherwise-idle workers may continue this demand up to the
  // separate surplus maximum. This keeps opportunistic work explicit in the
  // colony plan instead of hiding fallback decisions inside creep execution.
  surplusPriority?: number;
  surplusMaximum?: number;
}
