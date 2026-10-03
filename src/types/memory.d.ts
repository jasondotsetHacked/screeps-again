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
