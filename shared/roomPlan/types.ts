// This boundary deliberately uses literal strings and plain data, never Screeps types.
export interface Tile { x: number; y: number }
export type PlanStructureType = 'spawn' | 'extension' | 'tower' | 'storage' | 'terminal' |
  'factory' | 'link' | 'container' | 'road' | 'powerSpawn' | 'observer' | 'nuker' | 'lab' | 'extractor';
export interface RoomAsset extends Tile {
  type: string;
  id?: string;
  site?: boolean;
  owned?: boolean;
  blocking?: boolean;
}
export interface RoomFacts {
  roomName: string;
  /** Row-major 50x50: 0 plain, 1 wall, 2 swamp, 3 wall + swamp. */
  terrain: string;
  controller: Tile;
  sources: (Tile & { id: string })[];
  mineral?: Tile;
  spawn1: Tile;
  assets: RoomAsset[];
  /** Source operations can nominate already assigned infrastructure for adoption. */
  sourceBuffers?: { sourceId: string; pos: Tile }[];
}
export interface PlannedStructure extends Tile {
  type: PlanStructureType;
  module: string;
  minRcl: number;
  priority: number;
  owner: 'colony' | 'source';
  transitional?: boolean;
}
export interface Reservation extends Tile {
  module: string;
  purpose: 'manager' | 'access' | 'work' | 'future';
  futureType?: PlanStructureType;
}
export interface PlanModule { id: string; kind: 'core' | 'extensions' | 'labs'; origin: Tile; rotation: number }
export interface SourcePlan { sourceId: string; miner: Tile; container: Tile; link?: Tile; access: Tile }
export interface CorePlan {
  manager: Tile; storage: Tile; terminal: Tile; factory: Tile; link: Tile;
  access: Tile[]; entrance: Tile;
}
export interface ControllerPlan { container: Tile; link?: Tile; work: Tile[]; access: Tile }
export interface RoadRoute { id: string; tiles: Tile[] }
export interface AssetDisposition extends RoomAsset {
  disposition: 'adopted' | 'tolerated-legacy' | 'transitional' | 'migration-candidate';
  reason: string;
}
export interface RoomPlan {
  version: 1;
  algorithm: 'hybrid-v1';
  id: string;
  anchorId: string;
  roomName: string;
  spawn1: Tile;
  structures: PlannedStructure[];
  reservations: Reservation[];
  modules: PlanModule[];
  core?: CorePlan;
  sources: SourcePlan[];
  controller?: ControllerPlan;
  routes: RoadRoute[];
  assets: AssetDisposition[];
  score: { total: number; coreTerrainPenalty: number; coreGeometryPenalty: number; coreLogisticsCost: number; roadCost: number; roadTiles: number; clearance: number };
  feasibility: { complete: boolean; reasons: string[] };
  warnings: string[];
}
export interface PlanOptions { maxCoreRange?: number }
