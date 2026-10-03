import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupDeadCreepMemory,
  recoverWorkerMemory
} from '../../src/memory/lifecycle';

test('dead creep cleanup preserves memory for creeps still spawning', () => {
  globalThis.Memory = {
    creeps: {
      alive: { kind: 'worker', home: 'E25S47' },
      spawning: { kind: 'worker', home: 'E25S47' },
      dead: { kind: 'worker', home: 'E25S47' }
    }
  } as Memory;

  globalThis.Game = {
    creeps: {
      alive: {}
    },
    spawns: {
      Spawn1: {
        spawning: { name: 'spawning' }
      }
    }
  } as unknown as Game;

  cleanupDeadCreepMemory();

  assert.ok(Memory.creeps.alive);
  assert.ok(Memory.creeps.spawning);
  assert.equal(Memory.creeps.dead, undefined);
});

test('worker memory recovery adopts orphaned bot-named workers', () => {
  const orphan = {
    name: 'worker-E25S47-abc123',
    memory: {},
    store: {
      getUsedCapacity: () => 0
    }
  } as unknown as Creep;

  globalThis.Game = {
    time: 12345,
    creeps: {
      [orphan.name]: orphan
    }
  } as unknown as Game;

  const room = { name: 'E25S47' } as Room;

  recoverWorkerMemory(room);

  assert.equal(orphan.memory.kind, 'worker');
  assert.equal(orphan.memory.home, 'E25S47');
  assert.equal(orphan.memory.working, false);
  assert.equal(orphan.memory.born, 12345);
});
