import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  buildDynamoItems,
  decodeScreepsData,
  marshallItem,
  normalizeOpsMemory
} from '../../aws/collector/telemetry.mjs';

const rawOps = {
  version: 1,
  recentErrors: [
    {
      tick: 123,
      scope: 'colony',
      subject: 'E25S47/worker',
      message: 'example error'
    }
  ],
  snapshot: {
    tick: 12345,
    cpuUsed: 1.25,
    cpuLimit: 20,
    bucket: 9999,
    rooms: [
      {
        name: 'E25S47',
        rcl: 2,
        progress: 1000,
        progressTotal: 45000,
        ticksToDowngrade: 9000,
        safeMode: null,
        energyAvailable: 550,
        energyCapacityAvailable: 550,
        constructionSites: 3,
        hostiles: 0,
        workerPopulation: {
          live: 5,
          spawning: 0,
          aging: 1,
          effective: 4,
          target: 5,
          replacementLead: 68
        },
        infrastructure: {
          extensions: { built: 5, sites: 0, target: 5 },
          containers: { built: 2, sites: 0, target: 2 },
          towers: { built: 0, sites: 0, target: 0 },
          roads: { built: 39, sites: 3, target: null }
        },
        spawns: [
          {
            name: 'Spawn1',
            energy: 300,
            energyCapacity: 300,
            spawning: null
          }
        ]
      }
    ],
    creeps: [
      {
        name: 'worker-1',
        room: 'E25S47',
        x: 10,
        y: 20,
        ttl: 500,
        spawning: false,
        energy: 50,
        energyCapacity: 100,
        kind: 'worker',
        home: 'E25S47',
        working: true,
        sourceId: 'abc'
      }
    ]
  }
};

test('decodes normal and compressed Screeps memory responses', () => {
  const json = JSON.stringify(rawOps);
  assert.deepEqual(decodeScreepsData(json), rawOps);

  const compressed = 'gz:' + gzipSync(Buffer.from(json)).toString('base64');
  assert.deepEqual(decodeScreepsData(compressed), rawOps);
});

test('normalizes only the telemetry fields used by the private ops plane', () => {
  const telemetry = normalizeOpsMemory(rawOps);
  assert.ok(telemetry);
  assert.equal(telemetry.tick, 12345);
  assert.deepEqual(telemetry.cpu, { used: 1.25, limit: 20, bucket: 9999 });
  assert.equal(telemetry.rooms[0].workerPopulation.effective, 4);
  assert.equal(telemetry.rooms[0].infrastructure.roads.built, 39);
  assert.equal(telemetry.creeps[0].ttl, 500);
  assert.equal(telemetry.recentErrors[0].message, 'example error');

  assert.equal(normalizeOpsMemory({ version: 2, snapshot: {} }), null);
});

test('builds colony and room latest/history records with TTL only on history', () => {
  const telemetry = normalizeOpsMemory(rawOps);
  assert.ok(telemetry);

  const items = buildDynamoItems(telemetry, {
    shard: 'shard3',
    collectedAt: '2026-10-04T01:00:00.000Z',
    retentionDays: 30
  });

  assert.equal(items.length, 4);

  const colonyHistory = items.find(
    (item) => item.pk === 'COLONY#shard3' && item.sk.startsWith('SNAPSHOT#')
  );
  const colonyLatest = items.find(
    (item) => item.pk === 'COLONY#shard3' && item.sk === 'LATEST'
  );
  const roomHistory = items.find(
    (item) => item.pk === 'ROOM#shard3#E25S47' && item.sk.startsWith('SNAPSHOT#')
  );

  assert.ok(colonyHistory?.expiresAt);
  assert.equal(colonyLatest?.expiresAt, undefined);
  assert.equal(roomHistory?.telemetry.room.workerPopulation.target, 5);
  assert.equal(roomHistory?.telemetry.creeps.length, 1);
});

test('marshals compact records without serializing undefined values', () => {
  const item = marshallItem({
    pk: 'COLONY#shard3',
    sk: 'LATEST',
    count: 5,
    healthy: true,
    optional: undefined,
    nested: { value: null }
  });

  assert.deepEqual(item.pk, { S: 'COLONY#shard3' });
  assert.deepEqual(item.count, { N: '5' });
  assert.deepEqual(item.healthy, { BOOL: true });
  assert.equal(item.optional, undefined);
  assert.deepEqual(item.nested, { M: { value: { NULL: true } } });
});
