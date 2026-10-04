import assert from 'node:assert/strict';
import test from 'node:test';
import { countPopulation } from '../../src/spawning/population';

const identity = { home: 'E25S47', kind: 'worker' } as const;
const base = { identity, creeps: [], spawning: [], replacementLead: 80 };

test('generic accounting partitions live, spawning and aging bodies by name', () => {
  const input = { ...base, creeps: [
    { name: 'aging', memory: identity, spawning: false, ticksToLive: 80 },
    { name: 'live', memory: identity, spawning: false, ticksToLive: 81 },
    { name: 'unknown-ttl', memory: identity, spawning: false },
    { name: 'both', memory: identity, spawning: false, ticksToLive: 1 },
    { name: 'flag-only', memory: identity, spawning: true }
  ], spawning: [{ name: 'both' }, { name: 'only', memory: identity }, { name: 'only', memory: identity }] };
  const expected = { live: 3, aging: 1, spawning: 3, effective: 5 };
  assert.deepEqual(countPopulation(input), expected);
  assert.deepEqual(countPopulation({ ...input, creeps: [...input.creeps].reverse(),
    spawning: [...input.spawning].reverse() }), expected);
});

test('generic accounting isolates home and optional operation independently of physical room', () => {
  const operation = { ...identity, operationId: 'test-operation' };
  const creeps = [
    { name: 'away', memory: identity, spawning: false, room: { name: 'E1N1' } },
    { name: 'foreign', memory: { ...identity, home: 'E1N1' }, spawning: false },
    { name: 'operation', memory: operation, spawning: false },
    { name: 'unrelated', memory: { home: identity.home, kind: 'unmanaged' }, spawning: false }
  ];
  assert.deepEqual(countPopulation({ ...base, creeps }), { live: 1, spawning: 0, aging: 0, effective: 1 });
  assert.deepEqual(countPopulation({ ...base, identity: operation, creeps }),
    { live: 1, spawning: 0, aging: 0, effective: 1 });
});

test('valid live ownership wins over conflicting spawn-memory ownership in both colonies', () => {
  const foreign = { ...identity, home: 'E1N1' };
  const input = { ...base, creeps: [{ name: 'both', memory: foreign, spawning: false }],
    spawning: [{ name: 'both', memory: identity }] };
  assert.deepEqual(countPopulation(input), { live: 0, spawning: 0, aging: 0, effective: 0 });
  assert.deepEqual(countPopulation({ ...input, identity: foreign }),
    { live: 0, spawning: 1, aging: 0, effective: 1 });
});

test('missing live metadata can use spawn metadata, while unrelated names and total wipe count zero', () => {
  assert.deepEqual(countPopulation({ ...base, creeps: [{ name: 'both', spawning: true }],
    spawning: [{ name: 'both', memory: identity }, { name: 'missing' }, { name: 'missing' }] }),
    { live: 0, spawning: 1, aging: 0, effective: 1 });
  assert.deepEqual(countPopulation(base), { live: 0, spawning: 0, aging: 0, effective: 0 });
  assert.deepEqual(countPopulation({ ...base, spawning: [{ name: 'worker-E25S47-abc' }] }),
    { live: 0, spawning: 0, aging: 0, effective: 0 });
});

test('spawn metadata cannot override a conflicting partial live home, unsupported kind or operation', () => {
  for (const memory of [{ home: 'E1N1' }, { kind: 'unmanaged' }, { operationId: 'other-operation' },
    { operationId: null }]) {
    assert.deepEqual(countPopulation({ ...base, creeps: [{ name: 'both', memory, spawning: true }],
      spawning: [{ name: 'both', memory: identity }] }),
    { live: 0, spawning: 0, aging: 0, effective: 0 });
  }
});
