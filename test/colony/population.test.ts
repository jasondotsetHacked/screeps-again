import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { runColony } from '../../src/colony/runColony';

test('colony owns away workers but schedules only local workers', () => {
  const f = fixture({ count: 2 });
  f.workers[1].room = { name: 'E1N1' } as Room;
  f.workers[1].pos = position(10, 10, 'E1N1');
  const state = observeColony(f.room);
  assert.equal(state.population.liveWorkers, 2);
  assert.equal(state.workerCreeps.length, 2);
  assert.deepEqual(state.workers.map((worker) => worker.name), ['w0']);
});

test('colony passes all identities to accounting so stale spawn Memory cannot adopt a foreign worker', () => {
  const f = fixture({ count: 1 });
  f.workers[0].memory.home = 'E1N1';
  const spawn = f.refill();
  Object.assign(spawn, { spawning: { name: 'w0' } });
  Memory.creeps.w0 = { kind: 'worker', home: f.room.name };
  const state = observeColony(f.room);
  assert.equal(state.population.effectiveWorkers, 0);
  assert.equal(state.workerCreeps.length, 0);
});

test('total worker wipe flows through request arbitration to 200-energy bootstrap', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 0 });
  f.room.energyAvailable = 200;
  f.room.energyCapacityAvailable = 800;
  const spawn = f.refill();
  const started: BodyPartConstant[][] = [];
  spawn.spawnCreep = ((body, _name, options) => {
    started.push(body);
    assert.deepEqual(options?.memory, { kind: 'worker', home: f.room.name, working: false, born: 1 });
    return OK;
  }) as StructureSpawn['spawnCreep'];
  const colony = runColony(f.room);
  assert.deepEqual(started, [[WORK, CARRY, MOVE]]);
  assert.equal(colony.executions.length, 0);
  f.room.energyAvailable = 199;
  Game.time += 1;
  runColony(f.room);
  assert.equal(started.length, 1);
});

test('healthy colony waits for its preferred replacement while aging worker remains usable labor', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 4 });
  f.room.energyCapacityAvailable = 800;
  f.room.energyAvailable = 200;
  f.workers[0].ticksToLive = 1;
  const spawn = f.refill();
  const bodies: BodyPartConstant[][] = [];
  spawn.spawnCreep = ((body) => { bodies.push(body); return OK; }) as StructureSpawn['spawnCreep'];
  const waiting = runColony(f.room);
  assert.equal(waiting.state.population.effectiveWorkers, 3);
  assert.equal(waiting.state.workers.length, 4);
  assert.equal(bodies.length, 0);
  f.room.energyAvailable = 800;
  runColony(f.room);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], Array.from({ length: 4 }, () => [WORK, CARRY, MOVE]).flat());
});

test('recovered spawn-only workers and duplicate spawn entries prevent unnecessary depletion bodies', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 2 });
  f.room.energyCapacityAvailable = 800;
  f.room.energyAvailable = 200;
  const busy = f.refill('busy');
  Object.assign(busy, { spawning: { name: 'worker-E25S47-abc' } });
  Game.spawns = { first: busy, duplicate: busy };
  f.structures.push(busy);
  const idle = f.refill('idle');
  idle.spawnCreep = (() => { throw new Error('healthy population should wait'); }) as StructureSpawn['spawnCreep'];
  const colony = runColony(f.room);
  assert.equal(colony.state.population.spawningWorkers, 1);
  assert.equal(colony.state.population.effectiveWorkers, 3);
  assert.ok(Memory.creeps['worker-E25S47-abc']);
  assert.equal(colony.executions.length, 2);
});
