import { getScreepsClient, withScreepsRetry } from '../lib/screepsClient';
import { planInitialSpawn, type InitialSpawnPlan } from './spawnPlan';
import { scanRegion } from './scanRegion';
import type {
  RegionScanResult,
  ScoredRoom
} from './types';

export interface StartCandidate {
  shard: string;
  seedRoom: string;
  room: ScoredRoom;
  spawn: InitialSpawnPlan;
  shardRooms: number;
  shardUsers: number;
  combinedScore: number;
  launchRisk: 'normal' | 'adjacent-high-rcl';
}

export interface FindStartResult {
  scannedAt: string;
  worldStatus: unknown;
  candidates: StartCandidate[];
  scans: RegionScanResult[];
}

function normalizeStartRoom(shard: string, raw: string): string {
  return raw.startsWith(`${shard}/`) ? raw.slice(shard.length + 1) : raw;
}

export function startLaunchRisk(
  room: ScoredRoom
): StartCandidate['launchRisk'] {
  const adjacentHighRcl = room.nearbyOwners.some(
    (owner) => owner.nearestDistance <= 1 && owner.maxRcl >= 7
  );

  const unprotected =
    room.room.status === 'normal' &&
    room.room.protectionEndsAt === null;

  return adjacentHighRcl && unprotected
    ? 'adjacent-high-rcl'
    : 'normal';
}

export interface FindStartOptions {
  allowShardX?: boolean;
  startSamples?: number;
}

export async function findStartCandidates(
  radius = 5,
  onProgress?: (message: string) => void,
  options: FindStartOptions = {}
): Promise<FindStartResult> {
  const api = getScreepsClient();
  const [shardsResponse, worldStatus] = await Promise.all([
    withScreepsRetry(
      () => api.gameShardsInfo(),
      'shard list',
      onProgress
    ),
    withScreepsRetry(
      () => api.userWorldStatus(),
      'world status',
      onProgress
    )
  ]);

  const shards = shardsResponse.shards
    .filter(
      (shard) =>
        shard.rooms > 0 &&
        (options.allowShardX === true || shard.name !== 'shardX')
    )
    .sort(
      (a, b) =>
        a.users / Math.max(a.rooms, 1) -
        b.users / Math.max(b.rooms, 1)
    );

  if (
    options.allowShardX !== true &&
    shardsResponse.shards.some((shard) => shard.name === 'shardX')
  ) {
    onProgress?.(
      'Skipping shardX by default: controller actions there require active Access Key access. Use --allow-shard-x only when that access is intentional.'
    );
  }

  const samples = options.startSamples ?? 4;
  if (!Number.isInteger(samples) || samples < 1 || samples > 8) {
    throw new Error('startSamples must be an integer from 1 through 8');
  }

  const scans: RegionScanResult[] = [];
  const candidateByRoom = new Map<string, StartCandidate>();

  for (const shard of shards) {
    try {
      onProgress?.(
        `Sampling up to ${samples} starting search areas on ${shard.name}...`
      );

      const seedRooms = new Set<string>();
      for (let sample = 0; sample < samples; sample += 1) {
        const start = await withScreepsRetry(
          () => api.userWorldStartRoom(shard.name),
          `start-room hint for ${shard.name}`,
          onProgress
        );
        const rawSeed = start.room[0];
        if (rawSeed) {
          seedRooms.add(normalizeStartRoom(shard.name, rawSeed));
        }
      }

      if (seedRooms.size === 0) {
        onProgress?.(
          `Skipping ${shard.name}: no start-room hint returned across ${samples} sample(s).`
        );
        continue;
      }

      onProgress?.(
        `${shard.name}: discovered ${seedRooms.size} unique search seed(s): ${[...seedRooms].join(', ')}`
      );

      for (const seedRoom of seedRooms) {
        const scan = await scanRegion(
          shard.name,
          seedRoom,
          radius,
          (message) =>
            onProgress?.(`[${shard.name}/${seedRoom}] ${message}`)
        );

        scans.push(scan);

        for (const room of scan.candidates.slice(0, 8)) {
          try {
            const spawn = await withScreepsRetry(
              () =>
                planInitialSpawn(
                  shard.name,
                  room.room.roomName,
                  api
                ),
              `Spawn1 plan for ${shard.name}/${room.room.roomName}`,
              onProgress
            );

            const density = shard.users / Math.max(shard.rooms, 1);
            const densityPenalty = Math.min(8, density * 20);
            const spawnPenalty = Math.min(8, spawn.score / 60);
            const combinedScore = Number(
              Math.max(
                0,
                room.total - densityPenalty - spawnPenalty
              ).toFixed(1)
            );

            const candidate: StartCandidate = {
              shard: shard.name,
              seedRoom,
              room,
              spawn,
              shardRooms: shard.rooms,
              shardUsers: shard.users,
              combinedScore,
              launchRisk: startLaunchRisk(room)
            };

            const key = `${shard.name}/${room.room.roomName}`;
            const existing = candidateByRoom.get(key);
            if (
              !existing ||
              candidate.combinedScore > existing.combinedScore
            ) {
              candidateByRoom.set(key, candidate);
            }
          } catch (error) {
            onProgress?.(
              `Could not plan Spawn1 in ${shard.name}/${room.room.roomName}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    } catch (error) {
      onProgress?.(
        `Skipping shard ${shard.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const candidates = [...candidateByRoom.values()];

  candidates.sort((a, b) => {
    if (a.launchRisk !== b.launchRisk) {
      return a.launchRisk === 'normal' ? -1 : 1;
    }

    return (
      b.combinedScore - a.combinedScore ||
      b.room.total - a.room.total ||
      a.spawn.score - b.spawn.score
    );
  });

  return {
    scannedAt: new Date().toISOString(),
    worldStatus,
    candidates,
    scans
  };
}
