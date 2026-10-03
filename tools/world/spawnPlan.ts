import { terrainPathCost } from '../../shared/world/pathing';
import {
  countWalkableNeighbors,
  isSwamp,
  isWalkable,
  type RoomPositionLike
} from '../../shared/world/terrain';
import { getScreepsClient } from '../lib/screepsClient';

export interface InitialSpawnPlan {
  roomName: string;
  position: RoomPositionLike;
  score: number;
  sourcePathCosts: number[];
  controllerPathCost: number;
  anchorDistance: number;
  reasons: string[];
}

function range(a: RoomPositionLike, b: RoomPositionLike): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function key(position: RoomPositionLike): string {
  return `${position.x},${position.y}`;
}

export async function planInitialSpawn(
  shard: string,
  roomName: string,
  api = getScreepsClient()
): Promise<InitialSpawnPlan> {
  const [terrainResponse, objectsResponse] = await Promise.all([
    api.gameRoomTerrain(roomName, shard),
    api.gameRoomObjects(roomName, shard)
  ]);

  const encoded = terrainResponse.terrain[0]?.terrain;
  if (!encoded) {
    throw new Error(`No terrain data returned for ${shard}/${roomName}`);
  }

  const sources = objectsResponse.objects
    .filter((object) => object.type === 'source')
    .map((object) => ({ x: object.x, y: object.y }));

  const controllerObject = objectsResponse.objects.find(
    (object) => object.type === 'controller'
  );
  if (!controllerObject) {
    throw new Error(`No controller found in ${shard}/${roomName}`);
  }

  const controller = { x: controllerObject.x, y: controllerObject.y };
  const mineralObject = objectsResponse.objects.find(
    (object) => object.type === 'mineral'
  );
  const mineral = mineralObject
    ? { x: mineralObject.x, y: mineralObject.y }
    : null;

  const blocked = new Set(
    objectsResponse.objects.map((object) => key({ x: object.x, y: object.y }))
  );

  const heuristicCandidates: Array<{
    position: RoomPositionLike;
    heuristic: number;
  }> = [];

  for (let y = 4; y <= 45; y += 1) {
    for (let x = 4; x <= 45; x += 1) {
      const position = { x, y };

      if (!isWalkable(encoded, x, y)) continue;
      if (blocked.has(key(position))) continue;
      if (countWalkableNeighbors(encoded, position) < 5) continue;
      if (range(position, controller) < 3) continue;
      if (sources.some((source) => range(position, source) < 2)) continue;
      if (mineral && range(position, mineral) < 2) continue;

      const sourceDistance =
        sources.length === 0
          ? 100
          : sources.reduce((sum, source) => sum + range(position, source), 0) /
            sources.length;

      const edgeDistance = Math.min(x, y, 49 - x, 49 - y);
      const edgePenalty = edgeDistance < 7 ? (7 - edgeDistance) * 8 : 0;
      const swampPenalty = isSwamp(encoded, x, y) ? 15 : 0;
      const controllerDistance = range(position, controller);

      heuristicCandidates.push({
        position,
        heuristic:
          sourceDistance * 2 +
          controllerDistance +
          edgePenalty +
          swampPenalty
      });
    }
  }

  heuristicCandidates.sort((a, b) => a.heuristic - b.heuristic);
  const finalists = heuristicCandidates.slice(0, 48);

  const plans: InitialSpawnPlan[] = [];

  for (const finalist of finalists) {
    const sourcePathCosts = sources
      .map((source) => terrainPathCost(encoded, finalist.position, source))
      .filter((cost): cost is number => cost !== null);

    const controllerPathCost = terrainPathCost(
      encoded,
      finalist.position,
      controller
    );

    if (
      controllerPathCost === null ||
      sourcePathCosts.length !== sources.length
    ) {
      continue;
    }

    const averageSourcePath =
      sourcePathCosts.length === 0
        ? 999
        : sourcePathCosts.reduce((sum, cost) => sum + cost, 0) /
          sourcePathCosts.length;

    const center = { x: 25, y: 25 };
    const centerDistance = range(finalist.position, center);
    const swampPenalty = isSwamp(
      encoded,
      finalist.position.x,
      finalist.position.y
    )
      ? 20
      : 0;

    const score =
      averageSourcePath * 1.6 +
      controllerPathCost * 0.7 +
      centerDistance * 0.8 +
      swampPenalty;

    plans.push({
      roomName,
      position: finalist.position,
      score: Number(score.toFixed(1)),
      sourcePathCosts,
      controllerPathCost,
      anchorDistance: centerDistance,
      reasons: [
        `Average source terrain cost: ${averageSourcePath.toFixed(1)}`,
        `Controller terrain cost: ${controllerPathCost}`,
        `Interior position: ${finalist.position.x},${finalist.position.y}`
      ]
    });
  }

  plans.sort((a, b) => a.score - b.score);

  const best = plans[0];
  if (!best) {
    throw new Error(
      `Could not find a safe initial spawn position in ${shard}/${roomName}`
    );
  }

  return best;
}
