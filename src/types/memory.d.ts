declare global {
  interface Memory {
    meta?: {
      schemaVersion: number;
      firstSeenTick: number;
    };
  }
}

export {};
