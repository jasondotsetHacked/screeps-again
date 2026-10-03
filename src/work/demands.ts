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
}
