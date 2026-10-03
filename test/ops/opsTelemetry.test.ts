import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(globalThis, {
  WORK: 'work',
  CARRY: 'carry',
  MOVE: 'move',
  RESOURCE_ENERGY: 'energy',
  CREEP_SPAWN_TIME: 3,
  BODYPART_COST: {
    work: 100,
    carry: 50,
    move: 50
  },
  FIND_MY_SPAWNS: 1,
  FIND_STRUCTURES: 2,
  FIND_MY_CONSTRUCTION_SITES: 3,
  FIND_SOURCES: 4,
  FIND_HOSTILE_CREEPS: 5,
  STRUCTURE_EXTENSION: 'extension',
  STRUCTURE_CONTAINER: 'container',
  STRUCTURE_TOWER: 'tower',
  STRUCTURE_ROAD: 'road',
  CONTROLLER_STRUCTURES: {
    extension: { 2: 5 },
    container: { 2: 5 },
    tower: { 2: 0 },
    road: { 2: 2500 }
  }
});

const { publishOpsSnapshot } = await import('../../src/ops/opsTelemetry');

test('ops snapshot exposes colony progress without changing colony decisions', () => {
  const roomName = 'E25S47';

  const healthy = {
    name: 'healthy',
    memory: { kind: 'worker', home: roomName, working: true },
    spawning: false,
    ticksToLive: 1000,
    room: { name: roomName },
    pos: { x: 10, y: 10 },
    store: {
      getUsedCapacity: () => 50,
      getCapacity: () => 50
    }
  };

  const aging = {
    name: 'aging',
    memory: { kind: 'worker', home: roomName, working: false },
    spawning: false,
    ticksToLive: 50,
    room: { name: roomName },
    pos: { x: 11, y: 10 },
    store: {
      getUsedCapacity: () => 0,
      getCapacity: () => 50
    }
  };

  const spawn = {
    name: 'Spawn1',
    spawning: null,
    store: {
      getUsedCapacity: () => 300,
      getCapacity: () => 300
    }
  };

  const structures = [
    { structureType: STRUCTURE_EXTENSION },
    { structureType: STRUCTURE_EXTENSION },
    { structureType: STRUCTURE_CONTAINER },
    { structureType: STRUCTURE_ROAD }
  ];

  const sites = [
    { structureType: STRUCTURE_EXTENSION },
    { structureType: STRUCTURE_EXTENSION },
    { structureType: STRUCTURE_EXTENSION },
    { structureType: STRUCTURE_CONTAINER },
    { structureType: STRUCTURE_ROAD },
    { structureType: STRUCTURE_ROAD }
  ];

  const sources = [{ id: 'source-a' }, { id: 'source-b' }];

  const room = {
    name: roomName,
    energyAvailable: 400,
    energyCapacityAvailable: 550,
    controller: {
      level: 2,
      progress: 1234,
      progressTotal: 45000,
      ticksToDowngrade: 9876,
      safeMode: 12000
    },
    find: (type: number) => {
      if (type === FIND_MY_SPAWNS) return [spawn];
      if (type === FIND_STRUCTURES) return structures;
      if (type === FIND_MY_CONSTRUCTION_SITES) return sites;
      if (type === FIND_SOURCES) return sources;
      if (type === FIND_HOSTILE_CREEPS) return [];
      throw new Error('unexpected find constant: ' + type);
    }
  } as unknown as Room;

  Object.assign(globalThis, {
    Memory: { creeps: {} },
    Game: {
      time: 1000,
      creeps: { healthy, aging },
      cpu: {
        getUsed: () => 3.5,
        limit: 20,
        bucket: 10000
      }
    }
  });

  publishOpsSnapshot([room], 1);

  const snapshot = Memory.ops?.snapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.cpuUsed, 2.5);

  const observed = snapshot.rooms[0];
  assert.equal(observed.rcl, 2);
  assert.equal(observed.progress, 1234);
  assert.equal(observed.progressTotal, 45000);
  assert.equal(observed.ticksToDowngrade, 9876);

  assert.deepEqual(observed.workerPopulation, {
    live: 2,
    spawning: 0,
    aging: 1,
    effective: 1,
    target: 5,
    replacementLead: 68
  });

  assert.deepEqual(observed.infrastructure?.extensions, {
    built: 2,
    sites: 3,
    target: 5
  });
  assert.deepEqual(observed.infrastructure?.containers, {
    built: 1,
    sites: 1,
    target: 2
  });
  assert.deepEqual(observed.infrastructure?.towers, {
    built: 0,
    sites: 0,
    target: 0
  });
  assert.deepEqual(observed.infrastructure?.roads, {
    built: 1,
    sites: 2,
    target: null
  });
});
