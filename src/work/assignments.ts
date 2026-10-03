import type { WorkCapability, WorkKind } from './demands';

export interface WorkerAssignment {
  creepName: string;
  demandId: string;
  kind: WorkKind;
  targetId: string;
  capability: WorkCapability;
  contribution: number;
  emergency: boolean;
  service: 'minimum' | 'desired' | 'surplus';
}
