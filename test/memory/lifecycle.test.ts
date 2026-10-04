import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupDeadCreepMemory,
  recoverWorkerMemory
} from '../../src/memory/lifecycle';
import { fixture } from '../helpers/colony';

test('dead creep cleanup preserves memory for creeps still spawning', () => {
  (globalThis as unknown as { Memory: Memory }).Memory = {
    creeps: {
      alive: { kind: 'worker', home: 'E25S47' },
      spawning: { kind: 'worker', home: 'E25S47' },
      dead: { kind: 'worker', home: 'E25S47' }
    }
  } as unknown as Memory;

  (globalThis as unknown as { Game: Game }).Game = {
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
  (globalThis as unknown as { RESOURCE_ENERGY: ResourceConstant }).RESOURCE_ENERGY =
    'energy' as ResourceConstant;

  const orphan = {
    name: 'worker-E25S47-abc123',
    memory: {},
    store: {
      getUsedCapacity: () => 0
    }
  } as unknown as Creep;

  (globalThis as unknown as { Game: Game }).Game = {
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

test('valid deployed worker memory is untouched even when its name disagrees with its owner', () => {
  const f = fixture({ count: 1 });
  const creep = f.workers[0];
  Object.assign(creep, { name: 'worker-E25S47-abc', memory: {
    kind: 'worker', home: 'E1N1', working: true, born: 10, sourceId: 'source', custom: 'preserved'
  } });
  const before = { ...creep.memory };
  recoverWorkerMemory(f.room);
  assert.deepEqual(creep.memory, before);
  creep.memory.home = f.room.name;
  const valid = { ...creep.memory };
  recoverWorkerMemory(f.room);
  assert.deepEqual(creep.memory, valid);
});

test('missing bot-named Memory recovers by home even while physically away', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 1, energy: 25 });
  const creep = f.workers[0];
  Object.assign(creep, { name: 'worker-E25S47-abc', memory: undefined, room: { name: 'E1N1' } });
  recoverWorkerMemory(f.room);
  assert.deepEqual(creep.memory, { kind: 'worker', home: f.room.name, working: true, born: 1 });
});

test('partial bot identity recovers in place and retains unrelated fields and prior birth tick', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 1, energy: 0 });
  const creep = f.workers[0];
  Object.assign(creep, { name: 'worker-E25S47-abc', memory: { home: f.room.name, born: 20, custom: 'kept' } });
  recoverWorkerMemory(f.room);
  assert.deepEqual(creep.memory, { kind: 'worker', home: f.room.name, born: 20, working: false, custom: 'kept' });
});

test('unrelated creeps, foreign partial homes and unsupported kinds are never adopted', () => {
  const f = fixture({ count: 3 });
  Object.assign(f.workers[0], { name: 'unrelated', memory: {} });
  Object.assign(f.workers[1], { name: 'worker-E25S47-abc', memory: { home: 'E1N1' } });
  Object.assign(f.workers[2], { name: 'worker-E25S47-def', memory: { kind: 'unmanaged' } });
  const before = f.workers.map((creep) => ({ ...creep.memory }));
  recoverWorkerMemory(f.room);
  assert.deepEqual(f.workers.map((creep) => creep.memory), before);
});

test('spawn-only orphan identity recovers once across duplicate spawn representations', (t) => {
  const logs = t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 0 });
  const name = 'worker-E25S47-abc';
  const spawn = f.refill();
  Object.assign(spawn, { spawning: { name } });
  Game.spawns = { first: spawn, duplicate: spawn };
  cleanupDeadCreepMemory();
  recoverWorkerMemory(f.room);
  assert.deepEqual(Memory.creeps[name], { kind: 'worker', home: f.room.name, working: false, born: 1 });
  assert.equal(logs.mock.callCount(), 1);
  cleanupDeadCreepMemory();
  assert.ok(Memory.creeps[name]);
});

test('spawning recovery preserves valid metadata and unrelated Memory; cleanup removes only dead creep entries', () => {
  const f = fixture({ count: 0 });
  const name = 'worker-E25S47-abc';
  const spawn = f.refill();
  Object.assign(spawn, { spawning: { name } });
  Game.spawns[spawn.name] = spawn;
  Memory.creeps[name] = { kind: 'worker', home: 'E1N1', born: 10, working: true };
  Memory.creeps.dead = { kind: 'worker', home: f.room.name };
  const custom = { preserved: true };
  Object.assign(Memory, { custom });
  const before = { ...Memory.creeps[name] };
  recoverWorkerMemory(f.room);
  cleanupDeadCreepMemory();
  assert.deepEqual(Memory.creeps[name], before);
  assert.equal(Memory.creeps.dead, undefined);
  assert.equal((Memory as unknown as { custom: object }).custom, custom);
});
