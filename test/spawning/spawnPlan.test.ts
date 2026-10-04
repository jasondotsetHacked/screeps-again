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

test('invalid bodies are rejected before priority selection without blocking valid peers', () => {
  const valid = request('valid');
  for (const body of [[], Array.from({ length: 51 }, () => MOVE), ['unknown-part'], ['toString'],
    Array(3), null, {}, 'work']) {
    const invalid = { ...request('invalid', { priority: 'bootstrap' }), body } as unknown as PopulationRequest;
    for (const requests of [[invalid, valid], [valid, invalid]]) {
      assert.equal(planSpawn({ ...base, requests })?.request, valid);
    }
  }
});

test('nonfinite or nonpositive part costs reject a request before selecting a valid alternative', () => {
  const originalCost = BODYPART_COST[WORK];
  const valid = request('valid', { body: [CARRY, MOVE] });
  try {
    for (const cost of [NaN, Infinity, -Infinity, 0, -1]) {
      BODYPART_COST[WORK] = cost;
      const invalid = request('invalid', { priority: 'bootstrap' });
      assert.equal(planSpawn({ ...base, requests: [invalid, valid] })?.request, valid);
    }
    BODYPART_COST[WORK] = Number.MAX_VALUE;
    const overflowing = request('overflowing', { priority: 'bootstrap', body: [WORK, WORK] });
    assert.equal(planSpawn({ ...base, requests: [overflowing, valid] })?.request, valid);
  } finally {
    BODYPART_COST[WORK] = originalCost;
  }
});

test('malformed request fields cannot throw or displace a structurally valid request', () => {
  const valid = request('valid');
  const invalidFields = [
    { id: '' }, { id: '  ' }, { id: 5 }, { identity: null }, { identity: {} },
    { identity: { home, kind: 'unknown' } }, { identity: { home, kind: 'worker', operationId: 1 } },
    { priority: 'unknown' }, { priority: 'toString' }, { initialMemory: null },
    { initialMemory: [] }, { initialMemory: 'invalid' }, { initialMemory: { home } },
    { initialMemory: { operationId: 'misplaced-identity' } }, { reason: 1 }, { explanation: null }
  ];
  const invalids = [null, undefined, 5, 'invalid', [], {},
    ...invalidFields.map((fields) => ({ ...request('invalid', { priority: 'bootstrap' }), ...fields }))];
  for (const invalid of invalids) {
    const requests = [invalid, valid] as unknown as PopulationRequest[];
    assert.equal(planSpawn({ ...base, requests })?.request, valid);
    assert.equal(planSpawn({ ...base, requests: [...requests].reverse() })?.request, valid);
  }
});

test('all requests with duplicate home IDs are rejected regardless of priority or input order', () => {
  const first = request('duplicate', { priority: 'bootstrap' });
  const second = request('duplicate', { body: [CARRY, MOVE],
    identity: { home, kind: 'worker', operationId: 'different-operation' } });
  const valid = request('unique', { priority: 'recovery' });
  for (const requests of [[first, second, valid], [second, first, valid], [valid, second, first]]) {
    assert.equal(planSpawn({ ...base, requests: Object.freeze(requests) })?.request, valid);
  }
  assert.equal(planSpawn({ ...base, requests: [first, second] }), null);
});

test('even identical duplicate requests violate the unique ID contract', () => {
  const duplicate = request('same');
  assert.equal(planSpawn({ ...base, requests: [duplicate, duplicate] }), null);
});

test('malformed and foreign-home requests do not invalidate a valid local request with the same ID', () => {
  const valid = request('shared');
  const malformed = request('shared', { priority: 'bootstrap', body: [] });
  const foreign = request('shared', { identity: { home: 'E1N1', kind: 'worker' }, priority: 'bootstrap' });
  const requests = [valid, malformed, foreign, { ...foreign }];
  assert.equal(planSpawn({ ...base, requests })?.request, valid);
  assert.equal(planSpawn({ ...base, requests: [...requests].reverse() })?.request, valid);
});

test('valid unaffordable priority still reserves energy after malformed requests are discarded', () => {
  const invalid = request('invalid', { priority: 'bootstrap', body: [] });
  const winner = request('recovery', { priority: 'recovery', body: [WORK, CARRY, MOVE, WORK, CARRY, MOVE] });
  const cheap = request('normal', { body: [CARRY, MOVE] });
  const requests = [invalid, cheap, winner];
  assert.equal(planSpawn({ ...base, energyAvailable: 200, requests }), null);
  assert.equal(planSpawn({ ...base, energyAvailable: 200, requests: [...requests].reverse() }), null);
  assert.equal(planSpawn({ ...base, energyAvailable: 400, requests })?.request, winner);
  assert.equal(planSpawn({ ...base, energyCapacity: 300, requests }), null);
});
