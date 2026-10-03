declare global {
  interface Memory {
    meta?: {
      schemaVersion: number;
      firstSeenTick: number;
    };
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
