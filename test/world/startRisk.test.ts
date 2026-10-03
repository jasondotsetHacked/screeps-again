import assert from 'node:assert/strict';
import test from 'node:test';
import { startLaunchRisk } from '../../tools/world/findStart';
import type { ScoredRoom } from '../../tools/world/types';

function scored(status: string, protectionEndsAt: number | null, rcl: number, distance: number): ScoredRoom {
  return {
    total: 70,
    max: 100,
    confidence: 'full',
    room: {
      roomName: 'E25S47',
      status,
      roomClass: 'standard',
      owner: null,
      protectionEndsAt,
      terrain: null,
      anchor: { x: 25, y: 25 },
      sources: [{ x: 10, y: 10 }, { x: 40, y: 40 }],
      controller: { x: 20, y: 20 },
      mineral: null,
      sourceOpenTiles: [4, 4],
      sourcePathCosts: [20, 20],
      controllerPathCost: 20,
      error: null
    },
    dimensions: {
      availability: { score: 10, max: 10, reasons: [], warnings: [] },
      economy: { score: 20, max: 30, reasons: [], warnings: [] },
      base: { score: 20, max: 30, reasons: [], warnings: [] },
      strategy: { score: 20, max: 30, reasons: [], warnings: [] }
    },
    nearbyOwners: [{ username: 'neighbor', nearestDistance: distance, rooms: 1, maxRcl: rcl }]
  };
}

test('unprotected adjacent RCL8 is a launch-risk tier', () => {
  assert.equal(startLaunchRisk(scored('normal', null, 8, 1)), 'adjacent-high-rcl');
});

test('adjacent RCL2 is not launch-risk tier', () => {
  assert.equal(startLaunchRisk(scored('normal', null, 2, 1)), 'normal');
});

test('RCL8 two rooms away is not the adjacent-risk tier', () => {
  assert.equal(startLaunchRisk(scored('normal', null, 8, 2)), 'normal');
});

test('protected adjacent RCL8 is not forced into risk tier', () => {
  assert.equal(startLaunchRisk(scored('respawn', 9999999999, 8, 1)), 'normal');
});
