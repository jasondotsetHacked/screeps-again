import assert from 'node:assert/strict';
import test from 'node:test';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { observeSourceOperations } from '../../src/operations/observeSources';
import { runMiner } from '../../src/creeps/runMiner';
import { runHauler } from '../../src/creeps/runHauler';
import { planHauling } from '../../src/logistics/planHauling';
import { runColony } from '../../src/colony/runColony';
import { runSourceLogistics } from '../../src/colony/runSourceLogistics';
import { workerEnergyContext, runWorker } from '../../src/creeps/runWorker';
import { planWork } from '../../src/colony/planWork';
import { creepName, identityFromName, recoverCreepIdentity } from '../../src/creeps/identity';
import { recoverColonyCreepMemory, cleanupDeadCreepMemory } from '../../src/memory/lifecycle';
import { requestSourcePopulation } from '../../src/operations/sourceOperation';

function operation(f: ReturnType<typeof logisticsFixture>) { return observeSourceOperations(observeColony(f.room))[0]; }

test('miner travels to exact local tile, then stays and harvests only its source', () => {
  const f = logisticsFixture(); const c = f.specialist('miner'); const o = operation(f);
  c.pos = position(10, 10);
  assert.equal(runMiner(c, o, true), false);
  assert.deepEqual(f.moves, [{ reusePath: 10, maxRooms: 1, range: 0 }]);
  assert.deepEqual(f.actions, []);
  c.pos = f.buffer.pos;
  assert.equal(runMiner(c, o, true), true);
  assert.deepEqual(f.actions, [`${c.name}:harvest:${f.source.id}`]);
  assert.equal(f.moves.length, 1);
});

test('miner deposits into assigned buffer while harvesting, never selects other sources', () => {
  const f = logisticsFixture(); f.secondSource(); const c = f.specialist('miner');
  Object.assign(c.store, { getUsedCapacity: () => 10, getFreeCapacity: () => 40 });
  runMiner(c, operation(f), true);
  assert.deepEqual(f.actions, [`${c.name}:transfer:${f.buffer.id}:undefined`, `${c.name}:harvest:${f.source.id}`]);
});

test('replacement miner waits beside incumbent without harvesting or stealing tile', () => {
  const f = logisticsFixture(); const old = f.specialist('miner'); const next = f.specialist('miner', 'def');
  next.pos = position(7, 6); old.ticksToLive = 5;
  const state = observeColony(f.room);
  runSourceLogistics(state, [operation(f)], workerEnergyContext(state), planWork(state));
  assert.deepEqual(f.actions, [`${old.name}:harvest:${f.source.id}`]);
  assert.equal(f.moves.length, 0);
});

test('spawning/damaged/invalid/away miners do not issue harvesting or cross-room movement', () => {
  const f = logisticsFixture(); const o = operation(f); const c = f.specialist('miner');
  c.spawning = true; runMiner(c, o, true);
  c.spawning = false; runMiner(c, undefined, true);
  c.room = { name: 'E1N1' } as Room; c.pos = position(6, 6, 'E1N1'); runMiner(c, o, true);
  assert.deepEqual(f.actions, []); assert.deepEqual(f.moves, []);
});

test('miner with destroyed buffer stops safely; source depletion remains a usable chain', () => {
  const f = logisticsFixture(); const o = operation(f); const c = f.specialist('miner');
  f.source.energy = 0; c.harvest = () => ERR_NOT_ENOUGH_RESOURCES;
  assert.equal(runMiner(c, o, true), true);
  f.structures.splice(f.structures.indexOf(f.buffer), 1);
  assert.equal(runMiner(c, o, true), false);
});

test('hauler acquisition selects only its operation buffer', () => {
  const f = logisticsFixture(); const c = f.specialist('hauler'); const o = operation(f);
  const state = observeColony(f.room);
  const assignment = planHauling({ pos: c.pos, energy: 0, freeCapacity: 400 }, o,
    [...state.energySupplies, { id: 'foreign', pos: c.pos, amount: 2000, kind: 'withdraw' }], []);
  assert.equal(assignment?.target.id, f.buffer.id);
  assert.equal(runHauler(c, o, assignment), 'resource');
  assert.deepEqual(f.actions, [`${c.name}:withdraw:${f.buffer.id}:400`]);
});

test('hauler delivery uses valid shared refill consumers with priority then proximity', () => {
  const f = logisticsFixture(); const c = f.specialist('hauler'); const o = operation(f);
  Object.assign(c.store, { getUsedCapacity: () => 200, getFreeCapacity: () => 200 });
  const assignment = planHauling({ pos: c.pos, energy: 200, freeCapacity: 200 }, o, [], [
    { id: 'near', pos: c.pos, amount: 1000, priority: 10 },
    { id: f.spawn.id, pos: f.spawn.pos, amount: 50, priority: 90 },
    { id: 'foreign', pos: position(6, 6, 'E1N1'), amount: 1000, priority: 100 }
  ]);
  assert.equal(assignment?.target.id, f.spawn.id); assert.equal(assignment?.amount, 50);
  runHauler(c, o, assignment);
  assert.deepEqual(f.actions, [`${c.name}:transfer:${f.spawn.id}:50`]);
});

test('haulers cannot double-promise container energy and workers share the remaining supply', () => {
  const f = logisticsFixture(); const a = f.specialist('hauler', 'a'); const b = f.specialist('hauler', 'b');
  Object.assign(f.buffer.store, { getUsedCapacity: () => 500 });
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, [operation(f)], energy, planWork(state));
  assert.ok(f.actions.includes(`${a.name}:withdraw:${f.buffer.id}:400`));
  assert.ok(f.actions.includes(`${b.name}:withdraw:${f.buffer.id}:100`));
  assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 0);
  runWorker(f.workers[0], undefined, energy);
  assert.ok(f.actions.includes('w0:harvest'));
});

test('haulers and workers cannot overpromise the same refill consumer', () => {
  const f = logisticsFixture({ energy: 50 }); const a = f.specialist('hauler', 'a'); const b = f.specialist('hauler', 'b');
  for (const c of [a, b]) Object.assign(c.store, { getUsedCapacity: () => 200, getFreeCapacity: () => 200 });
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, [operation(f)], energy, planWork(state));
  assert.ok(f.actions.includes(`${a.name}:transfer:${f.spawn.id}:200`));
  assert.ok(f.actions.includes(`${b.name}:transfer:${f.spawn.id}:100`));
  runWorker(f.workers[0], { creepName: 'w0', kind: 'refill', targetId: f.spawn.id,
    demandId: 'refill:spawn', capability: 'carry', contribution: 1, emergency: false, service: 'desired' }, energy);
  assert.equal(f.actions.includes('w0:refill'), false);
  assert.equal(energy.consumers?.[0].amount, 0);
});

test('partial hauler refill leaves worker demand and bounded worker transfers', () => {
  const f = logisticsFixture({ energy: 50 }); const c = f.specialist('hauler');
  Object.assign(c.store, { getUsedCapacity: () => 280, getFreeCapacity: () => 120 });
  const colony = runColony(f.room);
  assert.equal(colony.demands.find((d) => d.kind === 'refill')?.desired, 1);
  const refill = colony.assignments.find((a) => a.kind === 'refill'); assert.ok(refill);
  const worker = f.workers.find((w) => w.name === refill.creepName)!;
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  energy.consumers = [{ id: f.spawn.id, pos: f.spawn.pos, amount: 20, priority: 90 }];
  const amounts: (number | undefined)[] = [];
  worker.transfer = ((_target, _resource, amount) => { amounts.push(amount); return OK; }) as Creep['transfer'];
  runWorker(worker, refill, energy);
  assert.deepEqual(amounts, [20]);
});

test('healthy chain leaves buffers to general labor and avoids direct source contention', () => {
  const f = logisticsFixture(); f.specialist('miner'); f.specialist('hauler');
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, [operation(f)], energy, planWork(state));
  assert.equal(energy.supplies.some((s) => s.id === f.source.id), false);
  assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 600);
  runWorker(f.workers[0], undefined, energy);
  assert.ok(f.actions.includes('w0:withdraw'));
});

for (const loss of ['miner', 'hauler', 'buffer', 'full-buffer', 'empty-buffer', 'worker', 'damaged-miner', 'damaged-hauler', 'blocked-hauler'] as const) {
  test(`${loss} degradation immediately releases direct harvesting to generalists`, () => {
    const f = logisticsFixture(); const miner = f.specialist('miner'); const hauler = f.specialist('hauler');
    if (loss === 'miner') delete Game.creeps[miner.name];
    if (loss === 'hauler') delete Game.creeps[hauler.name];
    if (loss === 'buffer') f.structures.splice(f.structures.indexOf(f.buffer), 1);
    if (loss === 'full-buffer') {
      Object.assign(f.buffer.store, { getFreeCapacity: () => 0 });
      Object.assign(miner.store, { getUsedCapacity: () => 50, getFreeCapacity: () => 0 });
    }
    if (loss === 'empty-buffer') Object.assign(f.buffer.store, { getUsedCapacity: () => 0 });
    if (loss === 'worker') delete Game.creeps[f.workers[0].name];
    if (loss === 'damaged-miner') miner.getActiveBodyparts = () => 1;
    if (loss === 'damaged-hauler') hauler.getActiveBodyparts = () => 1;
    if (loss === 'blocked-hauler') { hauler.withdraw = () => ERR_NOT_IN_RANGE; hauler.moveTo = (() => -2) as Creep['moveTo']; }
    const state = observeColony(f.room); const energy = workerEnergyContext(state);
    runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
    assert.equal(energy.supplies.some((s) => s.id === f.source.id), true);
  });
}

test('failed hauler intents do not reserve energy or refill capacity', () => {
  const f = logisticsFixture(); const a = f.specialist('hauler', 'a'); const b = f.specialist('hauler', 'b');
  a.withdraw = () => ERR_INVALID_TARGET;
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, [operation(f)], energy, planWork(state));
  assert.ok(f.actions.includes(`${b.name}:withdraw:${f.buffer.id}:400`));
  assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 600);
});

test('specialist exceptions isolate per creep and leave worker execution running', () => {
  const f = logisticsFixture(); const miner = f.specialist('miner'); const hauler = f.specialist('hauler');
  miner.harvest = () => { throw new Error('miner intent failed'); };
  hauler.withdraw = () => { throw new Error('hauler intent failed'); };
  const colony = runColony(f.room);
  assert.equal(colony.executions.length, 4);
  assert.equal(Memory.ops?.recentErrors.filter((e) => e.scope === 'creep').length, 2);
  assert.ok(f.actions.some((a) => a.startsWith('w')));
});

test('source planning failure preserves worker spawning and labor', () => {
  const f = logisticsFixture({ count: 0 });
  f.room.getTerrain = () => { throw new Error('terrain unavailable'); };
  const kinds: string[] = [];
  f.spawn.spawnCreep = ((_body, _name, opts) => { kinds.push(opts!.memory!.kind!); return OK; }) as StructureSpawn['spawnCreep'];
  runColony(f.room);
  assert.deepEqual(kinds, ['worker']); assert.equal(Memory.ops?.recentErrors[0].subject, f.room.name + '/source-planning');
});

test('hauler travel and away specialist execution never permit cross-room movement', () => {
  const f = logisticsFixture(); const c = f.specialist('hauler'); const o = operation(f);
  c.withdraw = () => ERR_NOT_IN_RANGE;
  runHauler(c, o, { kind: 'withdraw', target: { id: f.buffer.id, pos: f.buffer.pos }, amount: 50 });
  assert.equal(f.moves[0].maxRooms, 1);
  c.room = { name: 'E1N1' } as Room; c.pos = position(10, 10, 'E1N1');
  assert.equal(planHauling({ pos: c.pos, energy: 0, freeCapacity: 400 }, o, [], []), undefined);
  assert.equal(runHauler(c, o, undefined), 'blocked'); assert.equal(f.moves.length, 1);
});

test('corrupted specialist metadata cannot reassign a body to another operation or worker population', () => {
  const f = logisticsFixture(); const second = f.secondSource();
  const otherBuffer = f.repair('buffer-b'); otherBuffer.pos = position(19, 19);
  const c = f.specialist('miner');
  c.memory.operationId = `source:${second.id}`;
  const state = observeColony(f.room); const ops = observeSourceOperations(state);
  runSourceLogistics(state, ops, workerEnergyContext(state), planWork(state));
  assert.deepEqual(f.actions, []);
  assert.equal(requestSourcePopulation(ops, [c], []).filter((r) => r.identity.kind === 'miner').length, 2);
  c.memory.kind = 'worker'; delete c.memory.operationId;
  assert.equal(observeColony(f.room).workerCreeps.includes(c), false);
});

test('executors reject a mismatched operation assignment even with otherwise valid objects', () => {
  const f = logisticsFixture(); const o = operation(f);
  const miner = f.specialist('miner', 'a', 'other'); const hauler = f.specialist('hauler', 'b', 'other');
  assert.equal(runMiner(miner, o, true), false);
  assert.equal(runHauler(hauler, o, { kind: 'withdraw', target: { id: f.buffer.id, pos: f.buffer.pos }, amount: 50 }), 'blocked');
  assert.deepEqual(f.actions, []); assert.deepEqual(f.moves, []);
});

test('two source-bound haulers share refill reservations but never withdraw each other buffers', () => {
  const f = logisticsFixture(); const second = f.secondSource();
  const other = f.repair('buffer-b'); other.pos = position(19, 19);
  Object.assign(other.store, { getUsedCapacity: () => 100, getFreeCapacity: () => 1900 });
  const a = f.specialist('hauler', 'a'); const b = f.specialist('hauler', 'b', second.id);
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
  assert.ok(f.actions.includes(`${a.name}:withdraw:${f.buffer.id}:400`));
  assert.ok(f.actions.includes(`${b.name}:withdraw:${other.id}:100`));
  assert.equal(energy.supplies.find((s) => s.id === other.id)?.amount, 0);
});

test('one specialist executes once despite duplicate physical/spawning representations', () => {
  const f = logisticsFixture(); const c = f.specialist('hauler');
  // Room.find and global Game share one physical object; dispatch consumes Game
  // once. Population counting separately treats the spawn flag as one body.
  f.workers.push(c);
  runColony(f.room);
  assert.equal(f.actions.filter((a) => a.startsWith(`${c.name}:withdraw`)).length, 1);
  c.spawning = true; Object.assign(f.spawn, { spawning: { name: c.name } });
  const before = f.actions.length; runColony(f.room);
  assert.equal(f.actions.length - before, 4); // Four general workers only.
});

test('miner deposit failure releases source access even if harvest intent succeeds', () => {
  const f = logisticsFixture(); const c = f.specialist('miner'); f.specialist('hauler');
  Object.assign(c.store, { getUsedCapacity: () => 10, getFreeCapacity: () => 40 });
  c.transfer = () => ERR_INVALID_TARGET;
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
  assert.equal(energy.supplies.some((s) => s.id === f.source.id), true);
});

test('loaded hauler salvages delivery after its buffer disappears', () => {
  const f = logisticsFixture(); const c = f.specialist('hauler');
  Object.assign(c.store, { getUsedCapacity: () => 200, getFreeCapacity: () => 200 });
  f.structures.splice(f.structures.indexOf(f.buffer), 1);
  const state = observeColony(f.room); const ops = observeSourceOperations(state);
  assert.equal(ops[0].ready, false);
  runSourceLogistics(state, ops, workerEnergyContext(state), planWork(state));
  assert.ok(f.actions.includes(`${c.name}:transfer:${f.spawn.id}:200`));
});

test('damaged MOVE throughput keeps direct source fallback available', () => {
  const f = logisticsFixture(); f.specialist('miner'); const c = f.specialist('hauler');
  c.getActiveBodyparts = (part) => part === CARRY ? 8 : part === MOVE ? 1 : 0;
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
  assert.equal(energy.supplies.some((s) => s.id === f.source.id), true);
});

test('failed worker travel releases shared supply/refill reservations', () => {
  const f = logisticsFixture({ energy: 0 }); const c = f.workers[0];
  c.withdraw = () => ERR_NOT_IN_RANGE; c.moveTo = (() => -2) as Creep['moveTo'];
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runWorker(c, undefined, energy);
  assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 1000);
  Object.assign(c.store, { getUsedCapacity: () => 50, getFreeCapacity: () => 0 }); c.memory.working = true;
  c.transfer = () => ERR_NOT_IN_RANGE;
  energy.consumers = [{ id: f.spawn.id, pos: f.spawn.pos, amount: 20, priority: 90 }];
  runWorker(c, { creepName: c.name, kind: 'refill', targetId: f.spawn.id, demandId: 'refill:spawn',
    capability: 'carry', contribution: 1, emergency: false, service: 'desired' }, energy);
  assert.equal(energy.consumers[0].amount, 20);
});

test('haulers can refill towers/extensions and failed transfers leave capacity to workers', () => {
  const f = logisticsFixture({ energy: 50 }); const tower = f.refill('tower', 80, STRUCTURE_TOWER);
  f.refill('extension', 50, STRUCTURE_EXTENSION);
  const c = f.specialist('hauler'); Object.assign(c.store, { getUsedCapacity: () => 400, getFreeCapacity: () => 0 });
  f.hostiles.push({} as Creep);
  // Reuse already observed safety projections; this test concerns refill demand,
  // not hostile body parsing, which the existing safety suite covers.
  const state = observeColony({ ...f.room, find: ((type: number) => type === FIND_HOSTILE_CREEPS ? [] : f.room.find(type as FindConstant)) } as Room);
  state.hostiles = f.hostiles;
  const energy = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
  assert.ok(f.actions.includes(`${c.name}:transfer:${tower.id}:80`));
  c.transfer = () => ERR_INVALID_TARGET;
  const next = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), next, planWork(state));
  assert.equal(next.consumers?.find((s) => s.id === tower.id)?.amount, 80);
  state.hostiles = [];
  state.refillTargets = state.refillTargets.filter((target) => target.structureType === STRUCTURE_EXTENSION);
  const extensions = workerEnergyContext(state); c.transfer = ((_target, _resource, amount) => {
    assert.equal(amount, 50); return OK;
  }) as Creep['transfer'];
  runSourceLogistics(state, observeSourceOperations(state), extensions, planWork(state));
  assert.equal(extensions.consumers?.find((target) => target.id === 'extension')?.amount, 0);
});

for (const kind of ['miner', 'hauler'] as const) {
  test(`${kind} name recovers complete operation identity, rejects conflicting/malformed metadata`, () => {
    const f = logisticsFixture(); const identity = { kind, home: f.room.name, operationId: 'source:a~b/%' };
    const name = creepName(identity, 'abc');
    assert.deepEqual(identityFromName(name), identity);
    for (const memory of [undefined, {}, { kind }, { home: f.room.name }]) assert.deepEqual(recoverCreepIdentity(name, memory), identity);
    for (const memory of [{ operationId: 'other' }, { operationId: 5 }, { home: 'E1N1' }, { kind: 'worker' }]) {
      assert.equal(recoverCreepIdentity(name, memory), null);
    }
    assert.equal(identityFromName(`${kind}-${f.room.name}~%oops~abc`), null);
  });

  test(`${kind} live and spawn-only Memory reset recover without wiping unrelated Memory`, (t) => {
    t.mock.method(console, 'log', () => {});
    const f = logisticsFixture(); const c = f.specialist(kind); const identity = { ...c.memory };
    c.memory = {};
    Object.assign(Memory, { custom: 'retained' });
    recoverColonyCreepMemory(f.room);
    assert.deepEqual(c.memory, { ...identity, born: Game.time });
    delete Game.creeps[c.name]; delete Memory.creeps[c.name];
    Object.assign(f.spawn, { spawning: { name: c.name } }); Game.spawns = { Spawn1: f.spawn };
    cleanupDeadCreepMemory(); recoverColonyCreepMemory(f.room); cleanupDeadCreepMemory();
    assert.deepEqual(Memory.creeps[c.name], { ...identity, born: Game.time });
    assert.equal((Memory as unknown as { custom: string }).custom, 'retained');
  });
}
