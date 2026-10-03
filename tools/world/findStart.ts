import { getScreepsClient } from '../lib/screepsClient';
import { planInitialSpawn, type InitialSpawnPlan } from './spawnPlan';
import { scanRegion, type RegionScanResult } from './scanRegion';
import type { ScoredRoom } from './types';

export interface StartCandidate {
  shard: string;
  seedRoom: string;
  room: ScoredRoom;
  spawn: InitialSpawnPlan;
  shardRooms: number;
  shardUsers: number;
  combinedScore: number;
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

export async function findStartCandidates(
  radius = 5,
  onProgress?: (message: string) => void
): Promise<FindStartResult> {
  const api = getScreepsClient();
  const [shardsResponse, worldStatus] = await Promise.all([
    api.gameShardsInfo(),
    api.userWorldStatus()
  ]);

  const shards = shardsResponse.shards
    .filter((shard) => shard.rooms > 0)
    .sort((a, b) => a.users / Math.max(a.rooms, 1) - b.users / Math.max(b.rooms, 1));

  const scans: RegionScanResult[] = [];
  const candidates: StartCandidate[] = [];

  for (const shard of shards) {
    try {
      onProgress?.(`Finding a starting search area on ${shard.name}...`);
      const start = await api.userWorldStartRoom(shard.name);
      const rawSeed = start.room[0];

      if (!rawSeed) {
        onProgress?.(`Skipping ${shard.name}: no start-room hint returned.`);
        continue;
      }

      const seedRoom = normalizeStartRoom(shard.name, rawSeed);
      const scan = await scanRegion(
        shard.name,
        seedRoom,
        radius,
        (message) => onProgress?.(`[${shard.name}] ${message}`)
      );

      scans.push(scan);

      for (const room of scan.candidates.slice(0, 5)) {
        try {
          const spawn = await planInitialSpawn(
            shard.name,
            room.room.roomName,
            api
          );

          const density = shard.users / Math.max(shard.rooms, 1);
          const densityPenalty = Math.min(8, density * 20);
          const spawnPenalty = Math.min(8, spawn.score / 60);
          const combinedScore = Number(
            Math.max(0, room.total - densityPenalty - spawnPenalty).toFixed(1)
          );

          candidates.push({
            shard: shard.name,
            seedRoom,
            room,
            spawn,
            shardRooms: shard.rooms,
            shardUsers: shard.users,
            combinedScore
          });
        } catch (error) {
          onProgress?.(
            `Could not plan Spawn1 in ${shard.name}/${room.room.roomName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      onProgress?.(
        `Skipping shard ${shard.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  candidates.sort(
    (a, b) =>
      b.combinedScore - a.combinedScore ||
      b.room.total - a.room.total ||
      a.spawn.score - b.spawn.score
  );

  return {
    scannedAt: new Date().toISOString(),
    worldStatus,
    candidates,
    scans
  };
}
