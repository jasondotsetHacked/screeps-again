declare global {
  interface Memory {
    meta?: {
      schemaVersion: number;
      firstSeenTick: number;
    };
    ops?: OpsMemory;
  }

  interface OpsMemory {
    version: 1;
    recentErrors: OpsErrorRecord[];
    snapshot?: OpsSnapshot;
  }

  interface OpsErrorRecord {
    tick: number;
    scope: 'colony' | 'creep';
    subject: string;
    message: string;
  }

  interface OpsSnapshot {
    tick: number;
    cpuUsed: number;
    cpuLimit: number;
    bucket: number;
    rooms: OpsRoomSnapshot[];
    creeps: OpsCreepSnapshot[];
  }

  interface OpsWorkerPopulationSnapshot {
    live: number;
    spawning: number;
    aging: number;
    effective: number;
    target: number;
    replacementLead: number;
  }

  interface OpsStructureProgressSnapshot {
    built: number;
    sites: number;
    target: number | null;
  }

  interface OpsInfrastructureSnapshot {
    extensions: OpsStructureProgressSnapshot;
    containers: OpsStructureProgressSnapshot;
    towers: OpsStructureProgressSnapshot;
    roads: OpsStructureProgressSnapshot;
  }

  interface OpsLaborSnapshot {
    totalDemands: number;
    emergency: boolean;
    kinds: {
      kind: 'refill' | 'build' | 'repair' | 'upgrade';
      capability: 'work' | 'carry';
      demands: number;
      minimum: number;
      desired: number;
      assigned: number;
      unsatisfied: number;
      unsatisfiedMinimum: number;
      workers: number;
      boundedAssigned?: number;
      surplusAssigned?: number;
      acquiringWorkers?: number;
      travelingWorkers?: number;
      workingWorkers?: number;
      blockedWorkers?: number;
      acceptedWorkIntents?: number;
    }[];
  }

  interface OpsRoomSnapshot {
    name: string;
    rcl: number;
    progress: number | null;
    progressTotal: number | null;
    ticksToDowngrade: number | null;
    safeMode: number | null;
    energyAvailable: number;
    energyCapacityAvailable: number;
    constructionSites: number;
    hostiles: number;
    spawns: OpsSpawnSnapshot[];
    workerPopulation?: OpsWorkerPopulationSnapshot;
    infrastructure?: OpsInfrastructureSnapshot;
    labor?: OpsLaborSnapshot;
    safety?: { requested: boolean; attempted?: boolean; accepted: boolean; reason: import('../colony/planSafety').SafetyPlan['reason'] };
  }

  interface OpsSpawnSnapshot {
    name: string;
    energy: number;
    energyCapacity: number | null;
    spawning: {
      name: string;
      remainingTime: number;
    } | null;
  }

  interface OpsCreepSnapshot {
    name: string;
    room: string;
    x: number;
    y: number;
    ttl: number | null;
    spawning: boolean;
    energy: number;
    energyCapacity: number | null;
    kind: string | null;
    home: string | null;
    working: boolean | null;
    sourceId: string | null;
  }

  interface CreepMemory {
    kind?: 'worker';
    home?: string;
    sourceId?: Id<Source>;
    working?: boolean;
    born?: number;
  }
}

export {};
