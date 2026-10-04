import assert from 'node:assert/strict';
import test from 'node:test';
import { simulation } from '../helpers/simulation';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { creepName, type CreepIdentity } from '../../src/creeps/identity';
import { bodyCost } from '../../src/spawning/body';
import { observeColony } from '../../src/colony/colonyState';
import { observeSourceOperations } from '../../src/operations/observeSources';
import { requestSourcePopulation } from '../../src/operations/sourceOperation';
import { cleanupDeadCreepMemory, initializeMemory } from '../../src/memory/lifecycle';

function economy() {
  logisticsFixture(); // Install RoomPosition's deterministic local path adapter.
  const f = simulation({ count: 4, energy: 50 });
  f.room.energyAvailable = 800; f.room.energyCapacityAvailable = 800;
  f.room.getTerrain = (() => ({ get: () => 0 })) as unknown as Room['getTerrain'];
  f.source.pos = position(10, 10); f.controller.pos = position(13, 13);
  const spawn = f.refill('spawn', 300); spawn.pos = position(15, 10);
  // This fixture models the room's spawn/extension energy pool as a single
  // refill store, rather than emulating all engine extension consumption rules.
  f.store(spawn, 800, 800);
  const buffer = f.repair('buffer'); buffer.pos = position(11, 10);
  Object.assign(buffer, { hits: 2000, hitsMax: 2000 }); f.store(buffer, 0, 2000);
  const produced = new Map<string, number>();
  const gathered = new Map<string, number>();
  const delivered = new Map<string, number>();
  let serial = 0;
  function add(identity: CreepIdentity, body: readonly BodyPartConstant[], name = creepName(identity, (++serial).toString(36))) {
    const c = { ...f.workers[0], name, memory: { ...identity }, room: f.room, pos: position(15, 10),
      ticksToLive: 1500, spawning: false,
      getActiveBodyparts: (part: BodyPartConstant) => body.filter((p) => p === part).length
    } as Creep;
    f.workers.push(c); Game.creeps[name] = c; Memory.creeps[name] = c.memory;
    f.attachCreep(c, 0);
    const transfer = c.transfer; const withdraw = c.withdraw; const harvest = c.harvest;
    c.transfer = ((target, resource, amount) => {
      const result = transfer.call(c, target, resource, amount);
      if (result === OK) delivered.set(c.name, (delivered.get(c.name) ?? 0) + 1);
      return result;
    }) as Creep['transfer'];
    c.withdraw = ((target, resource, amount) => {
      const result = withdraw.call(c, target, resource, amount);
      if (result === OK) gathered.set(c.name, (gathered.get(c.name) ?? 0) + 1);
      return result;
    }) as Creep['withdraw'];
    c.harvest = ((source) => {
      const result = harvest.call(c, source);
      if (result === OK) produced.set(c.name, (produced.get(c.name) ?? 0) + 1);
      return result;
    }) as Creep['harvest'];
    return c;
  }
  function specialists() {
    const o = observeSourceOperations(observeColony(f.room))[0];
    return { miner: add({ kind: 'miner', home: f.room.name, operationId: o.id }, o.minerBody),
      hauler: add({ kind: 'hauler', home: f.room.name, operationId: o.id }, o.haulerBody) };
  }
  function kill(c: Creep) {
    delete Game.creeps[c.name]; f.workers.splice(f.workers.indexOf(c), 1); cleanupDeadCreepMemory();
  }
  const births: CreepIdentity[] = [];
  let pending: { name: string; memory: CreepMemory; body: BodyPartConstant[]; remaining: number } | undefined;
  spawn.spawnCreep = ((body, name, opts) => {
    if (pending) throw new Error('duplicate spawn');
    const cost = bodyCost(body); assert.ok(f.room.energyAvailable >= cost);
    f.setEnergy(spawn, f.amount(spawn) - cost);
    pending = { name, memory: opts!.memory!, body, remaining: body.length * CREEP_SPAWN_TIME };
    Memory.creeps[name] = opts!.memory!;
    Object.assign(spawn, { spawning: { name, remainingTime: pending.remaining } });
    return OK;
  }) as StructureSpawn['spawnCreep'];
  Game.spawns = { Spawn1: spawn };
  function tick(drain = 5) {
    f.setEnergy(spawn, Math.max(0, f.amount(spawn) - drain));
    f.room.energyAvailable = f.amount(spawn);
    cleanupDeadCreepMemory();
    const colony = f.tick();
    for (const c of [...f.workers]) if (c.ticksToLive! <= 0) kill(c);
    if (pending && --pending.remaining === 0) {
      const born = pending; pending = undefined; Object.assign(spawn, { spawning: null });
      births.push(born.memory as CreepIdentity); add(born.memory as CreepIdentity, born.body, born.name);
    }
    return colony;
  }
  return { ...f, spawn, buffer, add, specialists, kill, tick, births, produced, gathered, delivered };
}

test('multi-tick miner/buffer/hauler cycles deliver energy and general labor upgrades', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); const { miner, hauler } = f.specialists();
  for (let i = 0; i < 180; i++) f.tick();
  assert.ok((f.produced.get(miner.name) ?? 0) > 100);
  assert.ok((f.delivered.get(miner.name) ?? 0) > 100);
  assert.ok((f.gathered.get(hauler.name) ?? 0) > 5);
  assert.ok((f.delivered.get(hauler.name) ?? 0) > 5);
  assert.ok(f.controller.progress > 100);
  assert.deepEqual([miner.pos.x, miner.pos.y], [f.buffer.pos.x, f.buffer.pos.y]);
});

for (const kind of ['miner', 'hauler'] as const) {
  test(`multi-tick ${kind} death leaves productive generalists and rebuilds lost specialist`, (t) => {
    t.mock.method(console, 'log', () => {});
    const f = economy(); const chain = f.specialists();
    for (let i = 0; i < 60; i++) f.tick();
    const progress = f.controller.progress;
    f.kill(chain[kind]);
    for (let i = 0; i < 300; i++) f.tick();
    assert.ok(f.controller.progress > progress + 100);
    assert.ok(f.births.some((identity) => identity.kind === kind && identity.operationId === 'source:source-a'), JSON.stringify({ births:f.births, energy:f.amount(f.spawn), buffer:f.amount(f.buffer), population:observeColony(f.room).population, operations:observeSourceOperations(observeColony(f.room)) }));
    assert.ok(Object.values(Game.creeps).some((c) => c.memory.kind === kind));
  });
}

test('multi-tick destroyed buffer releases self-harvest; rebuilding it resumes specialist delivery', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); const chain = f.specialists();
  for (let i = 0; i < 40; i++) f.tick();
  f.structures.splice(f.structures.indexOf(f.buffer), 1);
  const harvested = f.fulfilled.harvest; const progress = f.controller.progress;
  for (let i = 0; i < 100; i++) f.tick();
  assert.ok(f.fulfilled.harvest > harvested + 10); assert.ok(f.controller.progress > progress);
  const deliveries = f.delivered.get(chain.hauler.name) ?? 0;
  f.structures.push(f.buffer); f.store(f.buffer, 0, 2000);
  for (let i = 0; i < 150; i++) f.tick();
  assert.ok((f.delivered.get(chain.hauler.name) ?? 0) > deliveries);
});

test('multi-tick specialist wipe keeps workers productive and reestablishes both specialists', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); const chain = f.specialists(); f.kill(chain.miner); f.kill(chain.hauler);
  for (let i = 0; i < 500; i++) f.tick(1);
  assert.ok(f.controller.progress > 100);
  assert.ok(f.births.some((c) => c.kind === 'miner'), JSON.stringify({ births:f.births, energy:f.amount(f.spawn), population:observeColony(f.room).population })); assert.ok(f.births.some((c) => c.kind === 'hauler'));
});

test('multi-tick total colony wipe at 200 energy bootstraps workers before rebuilding logistics', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); f.specialists();
  for (const c of [...f.workers]) f.kill(c);
  f.setEnergy(f.spawn, 200);
  for (let i = 0; i < 2200; i++) f.tick(0);
  assert.ok(f.births.length >= 6, JSON.stringify({ births:f.births, energy:f.amount(f.spawn), population:observeColony(f.room).population, fulfilled:f.fulfilled }));
  assert.deepEqual(f.births.slice(0, 4).map((c) => c.kind), ['worker', 'worker', 'worker', 'worker']);
  assert.ok(f.births.some((c) => c.kind === 'miner'), JSON.stringify({ births:f.births, energy:f.amount(f.spawn), population:observeColony(f.room).population })); assert.ok(f.births.some((c) => c.kind === 'hauler'));
  assert.ok(f.controller.progress > 0);
});

test('low-energy worker collapse reserves affordable generalist recovery over specialists', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); f.specialists();
  for (const c of [...f.workers].filter((c) => c.memory.kind === 'worker').slice(1)) f.kill(c);
  f.setEnergy(f.spawn, 200);
  const colony = f.tick(0);
  assert.equal(colony.state.population.effectiveWorkers, 1);
  const spawning = Object.values(Memory.creeps).filter((m) => m.born === Game.time - 1);
  assert.ok(spawning.some((m) => m.kind === 'worker'));
  const o = observeSourceOperations(observeColony(f.room))[0];
  assert.equal(o.enabled, false); assert.deepEqual(requestSourcePopulation([o], Object.values(Game.creeps), []), []);
});

test('total Memory reset recovers specialist scope and avoids duplicate population', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); const chain = f.specialists();
  for (const c of f.workers) {
    if (c.memory.kind === 'worker') {
      delete Game.creeps[c.name]; c.name = creepName({ kind: 'worker', home: f.room.name }, (++Game.time).toString(36));
      Game.creeps[c.name] = c;
    }
    c.memory = {};
  }
  Object.assign(globalThis, { Memory: {} }); initializeMemory();
  f.tick(0);
  assert.equal(chain.miner.memory.operationId, 'source:source-a'); assert.equal(chain.hauler.memory.operationId, 'source:source-a');
  const ops = observeSourceOperations(observeColony(f.room));
  assert.deepEqual(requestSourcePopulation(ops, Object.values(Game.creeps), []), []);
});
