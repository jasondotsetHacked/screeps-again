import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from '../helpers/colony';
import { runSpawning } from '../../src/spawning/runSpawning';
import { planSpawn, type PopulationRequest } from '../../src/spawning/spawnPlan';

function setup() {
  const f = fixture({ count: 0 });
  const request: PopulationRequest = {
    id: 'test', identity: { kind: 'worker', home: f.room.name }, priority: 'normal',
    body: [WORK, CARRY, MOVE], initialMemory: { working: true }, reason: 'test', explanation: 'spawn test'
  };
  const plan = planSpawn({ home: f.room.name, requests: [request], energyAvailable: 300, energyCapacity: 300 })!;
  return { ...f, request, plan };
}

test('adapter applies producer memory and durable identity without worker initialization policy', (t) => {
  const logs = t.mock.method(console, 'log', () => {});
  const f = setup();
  f.request.identity.operationId = 'unused-operation-fixture';
  const spawn = f.refill();
  let calls = 0;
  spawn.spawnCreep = ((body, name, options) => {
    calls += 1;
    assert.deepEqual(body, [WORK, CARRY, MOVE]);
    assert.equal(name, 'worker-E25S47-1');
    assert.deepEqual(options?.memory, { ...f.request.identity, working: true, born: 1 });
    return OK;
  }) as StructureSpawn['spawnCreep'];
  assert.deepEqual(runSpawning(f.room, f.plan, [spawn]), { name: 'worker-E25S47-1', requestId: 'test', result: OK });
  assert.equal(calls, 1);
  assert.equal(logs.mock.calls[0].arguments[0], f.request.explanation);
});

test('adapter attempts only the first idle home spawn and reports failure without success logging', (t) => {
  const logs = t.mock.method(console, 'log', () => {});
  const f = setup();
  const busy = f.refill('busy');
  Object.assign(busy, { spawning: { name: 'existing' } });
  const idle = f.refill('idle');
  const extra = f.refill('extra');
  let calls = 0;
  busy.spawnCreep = extra.spawnCreep = (() => { throw new Error('wrong spawn'); }) as StructureSpawn['spawnCreep'];
  idle.spawnCreep = (() => { calls += 1; return ERR_NOT_ENOUGH_ENERGY; }) as StructureSpawn['spawnCreep'];
  assert.equal(runSpawning(f.room, f.plan, [busy, idle, extra])?.result, ERR_NOT_ENOUGH_ENERGY);
  assert.equal(calls, 1);
  assert.equal(logs.mock.callCount(), 0);
});

test('adapter does nothing for no plan, no idle spawn, or a foreign-home plan', () => {
  const f = setup();
  const spawn = f.refill();
  spawn.spawnCreep = (() => { throw new Error('unexpected spawn'); }) as StructureSpawn['spawnCreep'];
  assert.equal(runSpawning(f.room, null, [spawn]), null);
  assert.equal(runSpawning(f.room, f.plan, []), null);
  Object.assign(spawn, { spawning: { name: 'existing' } });
  assert.equal(runSpawning(f.room, f.plan, [spawn]), null);
  Object.assign(spawn, { spawning: null });
  f.request.identity.home = 'E1N1';
  assert.equal(runSpawning(f.room, f.plan, [spawn]), null);
});
