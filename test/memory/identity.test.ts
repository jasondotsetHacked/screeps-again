import assert from 'node:assert/strict';
import test from 'node:test';
import { createCreepMemory, creepName, identityFromName, readCreepIdentity,
  recoverCreepIdentity, samePopulation } from '../../src/creeps/identity';

const identity = { kind: 'worker', home: 'E25S47' } as const;

test('identity reads legacy worker memory without requiring worker execution fields', () => {
  assert.deepEqual(readCreepIdentity(identity), identity);
  assert.deepEqual(readCreepIdentity({ ...identity, working: true, born: 1, unrelated: true }), identity);
  for (const memory of [undefined, null, 4, {}, { kind: 'worker' }, { home: identity.home },
    { ...identity, home: '' }, { ...identity, kind: 'scout' }, { ...identity, operationId: 5 }]) {
    assert.equal(readCreepIdentity(memory), null);
  }
});

test('operation identity is optional durable scope and ordinary workers omit it', () => {
  const operation = { ...identity, operationId: 'source:test' };
  assert.deepEqual(readCreepIdentity(operation), operation);
  assert.equal(samePopulation(identity, operation), false);
  assert.equal(samePopulation(operation, { ...operation }), true);
  assert.equal(samePopulation(identity, { ...identity, home: 'E1N1' }), false);
  assert.equal('operationId' in createCreepMemory(identity, 100, { working: false }), false);
  assert.deepEqual(createCreepMemory(operation, 100, { working: false }),
    { ...operation, born: 100, working: false });
});

test('worker names retain the deployed contract and are only a recovery source', () => {
  const name = creepName(identity, (12345).toString(36));
  assert.equal(name, 'worker-E25S47-9ix');
  assert.deepEqual(identityFromName(name), identity);
  assert.deepEqual(identityFromName('worker-W1N2-abc123'), { kind: 'worker', home: 'W1N2' });
  for (const name of ['stranger', 'worker-E25S47-', 'worker-E25S47-abc-extra',
    'worker-fake-123', 'scout-E25S47-123']) assert.equal(identityFromName(name), null);
  assert.equal(recoverCreepIdentity(name, { kind: 'worker', home: 'E1N1' }), null);
});

test('orphan recovery repairs absent or malformed identity but refuses conflicting partial metadata', () => {
  const name = 'worker-E25S47-abc';
  for (const memory of [undefined, null, {}, { kind: 'worker' }, { home: identity.home },
    { kind: 3, home: null }, { kind: '', home: '' }]) {
    assert.deepEqual(recoverCreepIdentity(name, memory), identity);
  }
  for (const memory of [{ kind: 'worker', home: 'E1N1' }, { home: 'E1N1' }, { kind: 'scout' },
    { ...identity, operationId: null }, { operationId: '' }]) {
    assert.equal(recoverCreepIdentity(name, memory), null);
  }
  assert.deepEqual(recoverCreepIdentity(name, { operationId: 'existing-intent' }),
    { ...identity, operationId: 'existing-intent' });
  assert.equal(recoverCreepIdentity('unrelated', {}), null);
});
