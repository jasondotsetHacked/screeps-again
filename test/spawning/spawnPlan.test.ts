import assert from 'node:assert/strict';
import test from 'node:test';
import '../helpers/colony';
import { planSpawn, type PopulationRequest } from '../../src/spawning/spawnPlan';

const home = 'E25S47';
const base = { home, energyAvailable: 800, energyCapacity: 800 };

function request(id: string, overrides: Partial<PopulationRequest> = {}): PopulationRequest {
  return { id, identity: { home, kind: 'worker' }, priority: 'normal', body: [WORK, CARRY, MOVE],
    initialMemory: { working: false }, reason: 'test-request', explanation: 'test', ...overrides };
}

test('arbitration services bootstrap then recovery then normal without mutating inputs', () => {
  const normal = request('a');
  const recovery = request('b', { priority: 'recovery' });
  const bootstrap = request('c', { priority: 'bootstrap' });
  const requests = Object.freeze([normal, recovery, bootstrap]);
  assert.equal(planSpawn({ ...base, requests })?.request, bootstrap);
  assert.equal(planSpawn({ ...base, requests: [...requests].reverse() })?.request, bootstrap);
  assert.equal(planSpawn({ ...base, requests: [normal, recovery] })?.request, recovery);
  assert.equal(planSpawn({ ...base, requests: [normal] })?.request, normal);
  assert.deepEqual(requests, [normal, recovery, bootstrap]);
});

test('stable request IDs break equal-priority ties independently of input order', () => {
  const a = request('a');
  const z = request('z');
  assert.equal(planSpawn({ ...base, requests: [z, a] })?.request, a);
  assert.equal(planSpawn({ ...base, requests: [a, z] })?.request, a);
});

test('home capacity cannot service another home request, including higher-priority recovery', () => {
  const foreign = request('foreign', { identity: { home: 'E1N1', kind: 'worker' }, priority: 'bootstrap' });
  const local = request('local');
  assert.equal(planSpawn({ ...base, requests: [foreign] }), null);
  assert.equal(planSpawn({ ...base, requests: [foreign, local] })?.request, local);
  assert.equal(planSpawn({ ...base, requests: [] }), null);
});

test('unaffordable winners reserve energy rather than allowing lower priorities or later IDs to bypass', () => {
  const expensive = request('a', { priority: 'recovery', body: [WORK, CARRY, MOVE, WORK, CARRY, MOVE] });
  const cheap = request('b');
  assert.equal(planSpawn({ ...base, energyAvailable: 200, requests: [cheap, expensive] }), null);
  assert.equal(planSpawn({ ...base, energyAvailable: 200,
    requests: [{ ...expensive, priority: 'normal' }, cheap] }), null);
  assert.equal(planSpawn({ ...base, energyAvailable: 400, requests: [cheap, expensive] })?.cost, 400);
  assert.equal(planSpawn({ ...base, energyCapacity: 300, requests: [expensive] }), null);
});

test('arbitration rejects empty or oversized bodies and uses actual body cost', () => {
  for (const body of [[], Array.from({ length: 51 }, () => MOVE)]) {
    assert.equal(planSpawn({ ...base, requests: [request('invalid', { body })] }), null);
  }
  const carryOnly = request('body-policy-is-producer-owned', { body: [CARRY, MOVE] });
  assert.equal(planSpawn({ ...base, energyAvailable: 99, requests: [carryOnly] }), null);
  assert.equal(planSpawn({ ...base, energyAvailable: 100, requests: [carryOnly] })?.cost, 100);
});
