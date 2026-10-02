export interface RoomPositionLike {
  x: number;
  y: number;
}

export interface TerrainMetrics {
  wallTiles: number;
  swampTiles: number;
  plainTiles: number;
  walkableRatio: number;
  swampRatioOfWalkable: number;
  largestOpenSquare: {
    side: number;
    anchor: RoomPositionLike | null;
  };
}

const ROOM_SIZE = 50;
const WALL = 1;
const SWAMP = 2;

export function terrainAt(encoded: string, x: number, y: number): number {
  if (x < 0 || x >= ROOM_SIZE || y < 0 || y >= ROOM_SIZE) {
    return WALL;
  }

  const value = Number(encoded[y * ROOM_SIZE + x]);
  return Number.isFinite(value) ? value : WALL;
}

export function isWalkable(encoded: string, x: number, y: number): boolean {
  return (terrainAt(encoded, x, y) & WALL) === 0;
}

export function isSwamp(encoded: string, x: number, y: number): boolean {
  return (terrainAt(encoded, x, y) & SWAMP) !== 0;
}

export function countWalkableNeighbors(encoded: string, position: RoomPositionLike): number {
  let count = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (isWalkable(encoded, position.x + dx, position.y + dy)) {
        count += 1;
      }
    }
  }

  return count;
}

export function analyzeTerrain(encoded: string, margin = 3): TerrainMetrics {
  if (encoded.length < ROOM_SIZE * ROOM_SIZE) {
    throw new Error(`Expected 2500 terrain cells, got ${encoded.length}`);
  }

  let wallTiles = 0;
  let swampTiles = 0;
  let plainTiles = 0;

  for (let y = 0; y < ROOM_SIZE; y += 1) {
    for (let x = 0; x < ROOM_SIZE; x += 1) {
      if (!isWalkable(encoded, x, y)) wallTiles += 1;
      else if (isSwamp(encoded, x, y)) swampTiles += 1;
      else plainTiles += 1;
    }
  }

  const previous = new Array<number>(ROOM_SIZE).fill(0);
  let bestSide = 0;
  let bestEndX = -1;
  let bestEndY = -1;

  for (let y = 0; y < ROOM_SIZE; y += 1) {
    const current = new Array<number>(ROOM_SIZE).fill(0);

    for (let x = 0; x < ROOM_SIZE; x += 1) {
      const withinMargin =
        x >= margin &&
        y >= margin &&
        x < ROOM_SIZE - margin &&
        y < ROOM_SIZE - margin;

      if (!withinMargin || !isWalkable(encoded, x, y)) {
        current[x] = 0;
        continue;
      }

      const left = x > 0 ? current[x - 1] : 0;
      const up = previous[x];
      const diagonal = x > 0 ? previous[x - 1] : 0;
      current[x] = 1 + Math.min(left, up, diagonal);

      if (current[x] > bestSide) {
        bestSide = current[x];
        bestEndX = x;
        bestEndY = y;
      }
    }

    for (let x = 0; x < ROOM_SIZE; x += 1) {
      previous[x] = current[x];
    }
  }

  const walkable = plainTiles + swampTiles;
  const startX = bestEndX - bestSide + 1;
  const startY = bestEndY - bestSide + 1;

  return {
    wallTiles,
    swampTiles,
    plainTiles,
    walkableRatio: walkable / (ROOM_SIZE * ROOM_SIZE),
    swampRatioOfWalkable: walkable === 0 ? 1 : swampTiles / walkable,
    largestOpenSquare: {
      side: bestSide,
      anchor:
        bestSide === 0
          ? null
          : {
              x: Math.floor(startX + (bestSide - 1) / 2),
              y: Math.floor(startY + (bestSide - 1) / 2)
            }
    }
  };
}
