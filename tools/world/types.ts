import type { RoomClass } from '../../shared/world/rooms';
import type { RoomPositionLike, TerrainMetrics } from '../../shared/world/terrain';

export interface RoomOwner {
  userId: string;
  username: string;
  rcl: number;
}

export interface RegionalRoomSummary {
  roomName: string;
  status: string;
  roomClass: RoomClass;
  owner: RoomOwner | null;
}

export interface DeepRoomAnalysis extends RegionalRoomSummary {
  protectionEndsAt: number | null;
  terrain: TerrainMetrics | null;
  anchor: RoomPositionLike | null;
  sources: RoomPositionLike[];
  controller: RoomPositionLike | null;
  mineral: RoomPositionLike | null;
  sourceOpenTiles: number[];
  sourcePathCosts: Array<number | null>;
  controllerPathCost: number | null;
  error: string | null;
}

export interface ScoreDimension {
  score: number;
  max: number;
  reasons: string[];
  warnings: string[];
}

export interface NearbyOwner {
  username: string;
  nearestDistance: number;
  rooms: number;
  maxRcl: number;
}

export interface ScoredRoom {
  room: DeepRoomAnalysis;
  total: number;
  max: number;
  confidence: 'full' | 'partial';
  dimensions: {
    availability: ScoreDimension;
    economy: ScoreDimension;
    base: ScoreDimension;
    strategy: ScoreDimension;
  };
  nearbyOwners: NearbyOwner[];
}

export interface RegionScanResult {
  shard: string;
  centerRoom: string;
  radius: number;
  scannedAt: string;
  gameTime: number;
  worldStatus: unknown;
  respawnProhibitedRooms: string[];
  rooms: RegionalRoomSummary[];
  candidates: ScoredRoom[];
}
