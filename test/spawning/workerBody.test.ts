import assert from 'node:assert/strict';
import test from 'node:test';

// Screeps constants used by the pure body planner.
Object.assign(globalThis, {
  WORK: 'work',
  CARRY: 'carry',
  MOVE: 'move',
  CREEP_SPAWN_TIME: 3,
  BODYPART_COST: {
    work: 100,
    carry: 50,
    move: 50
  }
});

const {
  bodyCost,
  buildWorkerBody,
  replacementLeadTicks
} = await import('../../src/spawning/workerBody');

test('worker body can bootstrap from 200 energy', () => {
  const body = buildWorkerBody(200);
  assert.deepEqual(body, ['work', 'carry', 'move']);
  assert.equal(bodyCost(body), 200);
});

test('worker body scales with room capacity while staying capped', () => {
  assert.equal(buildWorkerBody(300).length, 3);
  assert.equal(buildWorkerBody(550).length, 6);
  assert.equal(buildWorkerBody(800).length, 12);
  assert.equal(buildWorkerBody(10000).length, 18);
});

test('replacement lead includes spawn, travel, and safety time', () => {
  assert.equal(
    replacementLeadTicks(['work', 'carry', 'move'], 30, 20),
    59
  );
});
