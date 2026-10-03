export interface WorkerExecution {
  creepName: string;
  phase: 'acquire' | 'travel' | 'work' | 'idle' | 'spawning' | 'blocked';
  // Screeps accepted the action intent; this is not measured delivered work.
  accepted: boolean;
}
