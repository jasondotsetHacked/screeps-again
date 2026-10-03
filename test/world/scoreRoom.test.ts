import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreRoom } from '../../tools/world/scoreRoom';
import type { DeepRoomAnalysis, RegionalRoomSummary } from '../../tools/world/types';

function room(status = 'normal'): DeepRoomAnalysis {
  return {
    roomName: 'E12N12',
    status,
    roomClass: 'standard',
    owner: null,
    protectionEndsAt: null,
    terrain: null,
    anchor: { x: 25, y: 25 },
    sources: [{ x: 10, y: 10 }, { x: 40, y: 40 }],
    controller: { x: 20, y: 20 },
    mineral: null,
    sourceOpenTiles: [4, 4],
    sourcePathCosts: [20, 20],
    controllerPathCost: 20,
    error: null
  };
}

test('adjacent RCL8 owner receives a large strategic penalty', () => {
  const target = room();
  const isolated = scoreRoom(target, [target]);
  const neighbor: RegionalRoomSummary = {
    roomName: 'E13N12',
    status: 'normal',
    roomClass: 'standard',
    owner: { userId: 'u1', username: 'neighbor', rcl: 8 }
  };
  const pressured = scoreRoom(target, [target, neighbor]);
  assert.ok(isolated.total - pressured.total >= 9);
  assert.ok(pressured.dimensions.strategy.warnings.some((warning) => warning.includes('Adjacent high-RCL')));
});

test('respawn protection softens but does not erase adjacent RCL8 risk', () => {
  const target = room('respawn');
  const neighbor: RegionalRoomSummary = {
    roomName: 'E13N12',
    status: 'normal',
    roomClass: 'standard',
    owner: { userId: 'u1', username: 'neighbor', rcl: 8 }
  };
  const isolated = scoreRoom(target, [target]);
  const pressured = scoreRoom(target, [target, neighbor]);
  assert.ok(isolated.total - pressured.total >= 7);
});
