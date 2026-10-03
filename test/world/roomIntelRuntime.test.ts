import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, position } from '../helpers/colony';
import { runKernel } from '../../src/kernel/runKernel';
import { initializeMemory } from '../../src/memory/lifecycle';
import { initializeWorldIntel, observeRoom, updateVisibleRoomIntel } from '../../src/world/roomIntel';
import { intelFreshness, projectRoomIntel, readRoomIntel } from '../../shared/world/intel';

function roomIntel(roomName: string) {
  const intel = readRoomIntel(Memory.world, roomName);
  assert.ok(intel);
  return intel;
}

const malformedWorldVersions: unknown[] = ['broken', '2', -1, 1.5, NaN, Infinity, -Infinity, null, false, {}, []];

test('optional world namespace initializes on existing v1 Memory without changing unrelated data', () => {
  fixture();
  initializeMemory();
  const before = JSON.stringify(Memory);
  const meta = Memory.meta;
  const creeps = Memory.creeps;
  const world = initializeWorldIntel(Memory)!;
  assert.deepEqual(world, { version: 1, rooms: {} });
  assert.equal(initializeWorldIntel(Memory), world);
  assert.equal(Memory.meta, meta);
  assert.equal(Memory.creeps, creeps);
  const { world: ignored, ...rest } = Memory;
  assert.equal(JSON.stringify(rest), before);
});

test('older namespace headers preserve unseen records and extension fields', () => {
  for (const version of [undefined, 0]) {
    const old = { lastSeen: 12, sources: [] };
    const memory = { world: { version, rooms: { E22S31: old }, extension: 'keep' }, other: { keep: true } };
    const original = memory.world;
    const world = initializeWorldIntel(memory)!;
    assert.equal(world.version, 1);
    assert.equal(memory.world, original);
    assert.equal(world.rooms.E22S31, old);
    assert.equal(memory.world.extension, 'keep');
    assert.deepEqual(memory.other, { keep: true });
    assert.equal(intelFreshness(old, 100, 100), 'unknown');
  }
});

test('missing or damaged intel containers recover without wiping unrelated namespaces', () => {
  for (const input of [undefined, null, [], 'broken', { version: 1 }, { version: 1, rooms: [] }]) {
    const memory = { world: input, unrelated: { durable: 1 } };
    assert.deepEqual(initializeWorldIntel(memory), { version: 1, rooms: {} });
    assert.deepEqual(memory.unrelated, { durable: 1 });
  }
});

test('malformed namespace versions recover in place while retained room data stays validated', () => {
  const f = fixture();
  const valid = projectRoomIntel(observeRoom(f.room, 1));
  const legacy = { lastSeen: 12, sources: [] };
  for (const version of malformedWorldVersions) {
    const rooms = { [f.room.name]: valid, E22S31: legacy };
    const memory = { world: { version, rooms, extension: 'keep' }, other: { durable: 1 } };
    const original = memory.world;
    const world = initializeWorldIntel(memory)!;
    assert.equal(world, original);
    assert.equal(world.version, 1);
    assert.equal(world.rooms, rooms);
    assert.equal(readRoomIntel(world, f.room.name), valid);
    assert.equal(world.rooms.E22S31, legacy);
    assert.equal(readRoomIntel(world, 'E22S31'), undefined);
    assert.equal(memory.world.extension, 'keep');
    assert.deepEqual(memory.other, { durable: 1 });
    assert.equal(initializeWorldIntel(memory), world);
  }
});

test('kernel resumes intel writes after malformed versions without changing unrelated Memory', () => {
  for (const version of malformedWorldVersions) {
    const f = fixture();
    initializeMemory();
    const meta = Memory.meta;
    const creeps = Memory.creeps;
    const unseen = { version: 0, lastSeen: 0 };
    Object.assign(Memory, { world: { version, rooms: { E22S31: unseen }, extension: 'keep' } });
    runKernel();
    assert.equal(Memory.world!.version, 1);
    assert.equal(roomIntel(f.room.name).lastSeen, Game.time);
    assert.deepEqual(roomIntel(f.room.name).presence, { foreignCreeps: 0, foreignTowers: 0, invaderCores: 0 });
    assert.equal(Memory.world!.rooms.E22S31, unseen);
    assert.equal((Memory.world as unknown as { extension: string }).extension, 'keep');
    assert.equal(Memory.meta, meta);
    assert.equal(Memory.creeps, creeps);
    assert.ok(f.actions.includes('w0:upgrade'));
  }
});

test('future namespace version is preserved during rollback and colony execution continues', (t) => {
  t.mock.method(console, 'log', () => {});
  for (const version of [2, 3, 1000000]) {
    const f = fixture();
    const memory = Memory as unknown as { world: unknown };
    const future = { version, rooms: { secret: { futureFact: true } } };
    memory.world = future;
    const before = JSON.stringify(future);
    assert.equal(initializeWorldIntel(memory), undefined);
    runKernel();
    assert.equal(memory.world, future);
    assert.equal(JSON.stringify(future), before);
    assert.ok(f.actions.includes('w0:upgrade'));
  }
});

test('runtime adapter projects ownership, reservation, mineral and neutral foreign presence', () => {
  const f = fixture();
  Object.assign(f.controller, { my: false, owner: { username: 'owner' }, level: 4,
    reservation: { username: 'reserver', ticksToEnd: 25 } });
  f.hostiles.push({} as Creep);
  const tower = f.refill('foreign-tower', 0, STRUCTURE_TOWER);
  tower.my = false;
  f.structures.push({ structureType: STRUCTURE_INVADER_CORE } as Structure);
  const mineral = { id: 'mineral', pos: position(6, 7), mineralType: 'O' } as Mineral;
  const find = f.room.find.bind(f.room);
  f.room.find = ((type: FindConstant) => type === FIND_MINERALS ? [mineral] : find(type)) as Room['find'];
  const intel = projectRoomIntel(observeRoom(f.room, 100));
  assert.equal(intel.controller?.owner, 'owner');
  assert.equal(intel.controller?.level, 4);
  assert.equal(intel.controller?.reservation?.expiresAt, 125);
  assert.deepEqual(intel.mineral, { id: 'mineral', x: 6, y: 7, type: 'O' });
  assert.deepEqual(intel.presence, { foreignCreeps: 1, foreignTowers: 1, invaderCores: 1 });
});

test('new sightings replace old facts and clear vanished ownership, reservation and foreign presence', () => {
  const f = fixture();
  Object.assign(f.controller, { owner: { username: 'old-owner' },
    reservation: { username: 'old-reserver', ticksToEnd: 10 } });
  f.hostiles.push({} as Creep);
  updateVisibleRoomIntel([f.room]);
  const old = roomIntel(f.room.name);
  delete f.controller.owner;
  delete f.controller.reservation;
  f.hostiles.length = 0;
  Game.time = 2;
  updateVisibleRoomIntel([f.room]);
  const next = roomIntel(f.room.name);
  assert.notEqual(next, old);
  assert.equal(old.controller?.owner, 'old-owner');
  assert.equal(next.lastSeen, 2);
  assert.equal(next.controller?.owner, null);
  assert.equal(next.controller?.reservation, null);
  assert.equal(next.presence.foreignCreeps, 0);
  delete f.room.controller;
  Game.time = 3;
  updateVisibleRoomIntel([f.room]);
  assert.equal(roomIntel(f.room.name).controller, null);
});

test('unseen intel remains untouched and ages; returning vision refreshes it', () => {
  const f = fixture();
  updateVisibleRoomIntel([f.room]);
  const previous = roomIntel(f.room.name);
  Game.time = 100;
  updateVisibleRoomIntel([]);
  assert.equal(Memory.world!.rooms[f.room.name], previous);
  assert.equal(previous.lastSeen, 1);
  assert.equal(intelFreshness(previous, Game.time, 10), 'stale');
  updateVisibleRoomIntel([f.room]);
  assert.equal(intelFreshness(Memory.world!.rooms[f.room.name], Game.time, 10), 'fresh');
});

test('visible older or malformed records rebuild; unseen and future records remain untouched', () => {
  const f = fixture();
  const world = initializeWorldIntel(Memory)!;
  const records = world.rooms as unknown as Record<string, unknown>;
  const unseen = { version: 0, lastSeen: 0 };
  records.E22S31 = unseen;
  const { presence, ...oldFields } = projectRoomIntel(observeRoom(f.room, 1));
  const oldNaming = { ...oldFields, hostiles: { creeps: 0, towers: 0, invaderCores: 0 } };
  for (const previous of [{ version: 0 }, { version: 1, sources: null }, oldNaming, null]) {
    records[f.room.name] = previous;
    updateVisibleRoomIntel([f.room]);
    assert.equal(intelFreshness(records[f.room.name], 1, 0), 'fresh');
    assert.equal(records.E22S31, unseen);
  }
  const future = { version: 2, extraFact: true };
  records[f.room.name] = future;
  updateVisibleRoomIntel([f.room]);
  assert.equal(records[f.room.name], future);
});

test('intel observation failure retains last sighting and does not block other rooms or local labor', (t) => {
  t.mock.method(console, 'log', () => {});
  const failed = fixture({ roomName: 'E21S31' });
  updateVisibleRoomIntel([failed.room]);
  const previous = Memory.world!.rooms[failed.room.name];
  const working = fixture();
  initializeWorldIntel(Memory)!.rooms[failed.room.name] = previous;
  Game.rooms[failed.room.name] = failed.room;
  const find = failed.room.find.bind(failed.room);
  failed.room.find = ((type: FindConstant) => {
    if (type === FIND_MINERALS) throw new Error('private strategic detail');
    return find(type);
  }) as Room['find'];
  Game.time = 2;
  runKernel();
  assert.equal(Memory.world!.rooms[failed.room.name], previous);
  assert.equal(roomIntel(working.room.name).lastSeen, 2);
  assert.ok(working.actions.includes('w0:upgrade'));
  assert.equal(JSON.stringify(Memory.ops).includes('private strategic detail'), false);
});

test('kernel reuses colony scans and keeps world intel outside public ops snapshots', () => {
  const f = fixture();
  runKernel();
  assert.equal(roomIntel(f.room.name).lastSeen, 1);
  for (const find of [FIND_SOURCES, FIND_STRUCTURES, FIND_HOSTILE_CREEPS, FIND_MINERALS]) {
    assert.equal(f.calls.get(find), 1);
  }
  assert.ok(f.actions.includes('w0:upgrade'));
  const publicMemory = JSON.stringify(Memory.ops);
  for (const key of ['lastSeen', 'roomClass', 'presence', 'foreignCreeps', 'foreignTowers', 'invaderCores', 'expiresAt', 'world']) {
    assert.equal(publicMemory.includes(key), false);
  }
});

test('kernel observes non-owned visible rooms without giving them colony ownership', () => {
  const external = fixture({ roomName: 'E21S31' });
  external.controller.my = false;
  const owned = fixture();
  Game.rooms[external.room.name] = external.room;
  runKernel();
  assert.equal(roomIntel(external.room.name).sources.length, 1);
  assert.equal(roomIntel(owned.room.name).lastSeen, 1);
  assert.deepEqual(Memory.ops!.snapshot!.rooms.map((room) => room.name), [owned.room.name]);
  assert.equal(external.actions.length, 0);
});

test('empty account and total Memory reset require no migration; worker bootstrap remains available', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 0 });
  Object.assign(globalThis, { Memory: {} });
  Game.rooms = {};
  runKernel();
  assert.deepEqual(Memory.world, { version: 1, rooms: {} });
  assert.deepEqual(Memory.creeps, {});
  const spawn = f.refill();
  let body: BodyPartConstant[] | undefined;
  spawn.spawnCreep = ((parts: BodyPartConstant[]) => { body = parts; return OK; }) as StructureSpawn['spawnCreep'];
  Game.rooms[f.room.name] = f.room;
  Game.spawns[spawn.name] = spawn;
  Game.time = 2;
  runKernel();
  assert.deepEqual(body, [WORK, CARRY, MOVE]);
  assert.equal(roomIntel(f.room.name).lastSeen, 2);
  Object.assign(globalThis, { Memory: {} });
  Game.time = 3;
  runKernel();
  assert.equal(Memory.meta?.schemaVersion, 1);
  assert.equal(roomIntel(f.room.name).lastSeen, 3);
});
