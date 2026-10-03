import assert from 'node:assert/strict';
import test from 'node:test';
import { terrainPathCost, terrainPathCostToRange } from '../../shared/world/pathing';

function terrainWithWalls(walls: Array<{ x: number; y: number }>): string {
  const cells = new Array<string>(2500).fill('0');
  for (const wall of walls) cells[wall.y * 50 + wall.x] = '1';
  return cells.join('');
}

test('exact terrain path rejects a wall target', () => {
  const terrain = terrainWithWalls([{ x: 12, y: 10 }]);
  assert.equal(terrainPathCost(terrain, { x: 10, y: 10 }, { x: 12, y: 10 }), null);
});

test('range path can approach a source that occupies a wall tile', () => {
  const terrain = terrainWithWalls([{ x: 12, y: 10 }]);
  assert.equal(terrainPathCostToRange(terrain, { x: 10, y: 10 }, { x: 12, y: 10 }, 1), 2);
});

test('range path can approach a controller without entering its tile', () => {
  const terrain = terrainWithWalls([{ x: 15, y: 10 }]);
  assert.equal(terrainPathCostToRange(terrain, { x: 10, y: 10 }, { x: 15, y: 10 }, 3), 4);
});
