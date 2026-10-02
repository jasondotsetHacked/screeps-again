import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyRoom, roomsInSquare } from '../../shared/world/rooms';
import {
  analyzeTerrain,
  countWalkableNeighbors,
  type RoomPositionLike
} from '../../shared/world/terrain';
import { terrainPathCost } from '../../shared/world/pathing';
import { getScreepsClient } from '../lib/screepsClient';
import { scoreRoom } from './scoreRoom';
import type {
  DeepRoomAnalysis,
  RegionScanResult,
  RegionalRoomSummary,
  RoomOwner
} from './types';

const MAP_STATS_BATCH = 50;
const DEEP_SCAN_CONCURRENCY = 4;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );

  return results;
}

function ownerFromStats(
  stats: { own?: { user: string; level: number } },
  users: Record<string, { username?: string }>
): RoomOwner | null {
  if (!stats.own) return null;

  return {
    userId: stats.own.user,
    username: users[stats.own.user]?.username ?? stats.own.user,
    rcl: stats.own.level
  };
}

function positionOf(object: { x: number; y: number }): RoomPositionLike {
  return { x: object.x, y: object.y };
}

async function inspectRoom(
  api: ReturnType<typeof getScreepsClient>,
  shard: string,
  summary: RegionalRoomSummary
): Promise<DeepRoomAnalysis> {
  try {
    const [terrainResponse, objectsResponse, statusResponse] = await Promise.all([
      api.gameRoomTerrain(summary.roomName, shard),
      api.gameRoomObjects(summary.roomName, shard),
      api.gameRoomStatus(summary.roomName, shard)
    ]);

    const encoded = terrainResponse.terrain[0].terrain;
    const terrain = analyzeTerrain(encoded);
    const anchor = terrain.largestOpenSquare.anchor;

    const sources = objectsResponse.objects
      .filter((object) => object.type === 'source')
      .map(positionOf);

    const controllerObject = objectsResponse.objects.find(
      (object) => object.type === 'controller'
    );
    const mineralObject = objectsResponse.objects.find(
      (object) => object.type === 'mineral'
    );

    const controller = controllerObject ? positionOf(controllerObject) : null;
    const mineral = mineralObject ? positionOf(mineralObject) : null;

    const sourceOpenTiles = sources.map((source) =>
      countWalkableNeighbors(encoded, source)
    );

    const sourcePathCosts = anchor
      ? sources.map((source) => terrainPathCost(encoded, anchor, source))
      : sources.map(() => null);

    const controllerPathCost =
      anchor && controller ? terrainPathCost(encoded, anchor, controller) : null;

    return {
      ...summary,
      protectionEndsAt: statusResponse.novice ?? statusResponse.respawn ?? null,
      terrain,
      anchor,
      sources,
      controller,
      mineral,
      sourceOpenTiles,
      sourcePathCosts,
      controllerPathCost,
      error: null
    };
  } catch (error) {
    return {
      ...summary,
      protectionEndsAt: null,
      terrain: null,
      anchor: null,
      sources: [],
      controller: null,
      mineral: null,
      sourceOpenTiles: [],
      sourcePathCosts: [],
      controllerPathCost: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function scanRegion(
  shard: string,
  centerRoom: string,
  radius: number,
  onProgress?: (message: string) => void
): Promise<RegionScanResult> {
  if (!Number.isInteger(radius) || radius < 1 || radius > 6) {
    throw new Error('Region radius must be an integer from 1 through 6.');
  }

  const api = getScreepsClient();
  const roomNames = roomsInSquare(centerRoom, radius);
  const roomStats = new Map<string, RegionalRoomSummary>();
  const users: Record<string, { username?: string }> = {};
  let gameTime = 0;

  onProgress?.(`Loading map metadata for ${roomNames.length} rooms...`);

  for (const batch of chunks(roomNames, MAP_STATS_BATCH)) {
    const response = await api.gameMapStats(batch, 'owner0', shard);
    gameTime = Math.max(gameTime, response.gameTime);

    for (const [userId, user] of Object.entries(response.users)) {
      users[userId] = user;
    }

    for (const roomName of batch) {
      const stats = response.stats[roomName];
      if (!stats) continue;

      roomStats.set(roomName, {
        roomName,
        status: stats.status,
        roomClass: classifyRoom(roomName),
        owner: ownerFromStats(stats, users)
      });
    }
  }

  const summaries = roomNames
    .map((roomName) => roomStats.get(roomName))
    .filter((room): room is RegionalRoomSummary => Boolean(room));

  const candidates = summaries.filter(
    (room) =>
      room.roomClass === 'standard' &&
      room.status !== 'closed' &&
      !room.owner
  );

  onProgress?.(`Deep-scanning ${candidates.length} unowned standard rooms...`);

  let completed = 0;
  const deepRooms = await mapLimit(
    candidates,
    DEEP_SCAN_CONCURRENCY,
    async (candidate) => {
      const result = await inspectRoom(api, shard, candidate);
      completed += 1;
      if (completed % 10 === 0 || completed === candidates.length) {
        onProgress?.(`Deep scan ${completed}/${candidates.length}`);
      }
      return result;
    }
  );

  const [worldStatus, respawnProhibited] = await Promise.all([
    api.userWorldStatus(),
    api.userRespawnProhibitedRooms()
  ]);

  const prohibited = new Set(
    respawnProhibited.rooms
      .filter((value) => value.startsWith(`${shard}/`))
      .map((value) => value.slice(shard.length + 1))
  );

  const scored = deepRooms
    .filter((room) => !prohibited.has(room.roomName))
    .map((room) => scoreRoom(room, summaries))
    .sort((a, b) => b.total - a.total);

  return {
    shard,
    centerRoom,
    radius,
    scannedAt: new Date().toISOString(),
    gameTime,
    worldStatus,
    respawnProhibitedRooms: [...prohibited],
    rooms: summaries,
    candidates: scored
  };
}

export async function saveRegionScan(scan: RegionScanResult): Promise<string> {
  const directory = path.join('.world-cache', 'regions', scan.shard);
  await mkdir(directory, { recursive: true });

  const timestamp = scan.scannedAt.replace(/[:.]/g, '-');
  const filename = `${scan.centerRoom}-r${scan.radius}-${timestamp}.json`;
  const outputPath = path.join(directory, filename);

  await writeFile(outputPath, JSON.stringify(scan, null, 2), 'utf8');
  return outputPath;
}
