import assert from 'node:assert/strict';
import test from 'node:test';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { observeSourceOperations } from '../../src/operations/observeSources';
import { requestSourcePopulation, specialistLead } from '../../src/operations/sourceOperation';
import { runSourceLogistics } from '../../src/colony/runSourceLogistics';
import { runColony } from '../../src/colony/runColony';
import { workerEnergyContext, runWorker } from '../../src/creeps/runWorker';
import { planWork } from '../../src/colony/planWork';
import { ensureSourceContainers } from '../../src/construction/runConstruction';
import { planSpawn } from '../../src/spawning/spawnPlan';
import { requestWorkerPopulation } from '../../src/spawning/workerPlan';

for (const [type, free, recovery] of [
  ['spawn', 300, true], ['spawn', 50, true], ['extension', 50, false], ['tower', 100, false]
] as const) {
  test(`traveling loaded hauler preserves ${type} refill demand (${free} free, recovery=${recovery})`, () => {
    const f = logisticsFixture({ count: recovery ? 1 : 4, energy: 50 });
    f.room.energyAvailable = 0;
    Object.assign(f.spawn.store, { getFreeCapacity: () => type === 'spawn' ? free : 0 });
    const target = type === 'spawn' ? f.spawn : f.refill(type, free, type as StructureConstant);
    const hauler = f.specialist('hauler'); hauler.pos = position(40, 40);
    Object.assign(hauler.store, { getUsedCapacity: () => 400, getFreeCapacity: () => 0 });
    hauler.transfer = () => ERR_NOT_IN_RANGE;
    const transferred: number[] = [];
    for (const c of f.workers) {
      c.transfer = ((sink, _resource, amount) => {
        if (c.pos.getRangeTo(sink) > 1) return ERR_NOT_IN_RANGE;
        assert.equal(sink.id, target.id); transferred.push(amount!); return OK;
      }) as Creep['transfer'];
    }
    const colony = runColony(f.room);
    assert.equal(colony.state.population.effectiveWorkers, recovery ? 1 : 4);
    const demand = colony.demands.find((d) => d.kind === 'refill' && d.target.id === target.id);
    assert.ok(demand); assert.equal(demand.desired, Math.ceil(free / 50));
    assert.ok(colony.assignments.some((a) => a.kind === 'refill' && a.targetId === target.id));
    assert.ok(transferred.length > 0); assert.ok(transferred.reduce((a, b) => a + b, 0) <= free);
    assert.ok(f.moves.some((move) => move.maxRooms === 1));
  });
}

test('traveling hauler leaves buffer energy for an in-range hauler this tick', () => {
  const f = logisticsFixture(); const far = f.specialist('hauler', 'a'); const near = f.specialist('hauler', 'b');
  far.pos = position(40, 40); far.withdraw = () => ERR_NOT_IN_RANGE;
  Object.assign(f.buffer.store, { getUsedCapacity: () => 300 });
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
  assert.ok(f.actions.includes(`${near.name}:withdraw:${f.buffer.id}:300`));
  assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 0);
});

test('earlier traveling worker cannot consume refill capacity before an in-range worker', () => {
  const f = logisticsFixture({ count: 2, energy: 50 }); const [far, near] = f.workers;
  far.pos = position(40, 40); near.pos = f.spawn.pos;
  far.transfer = () => ERR_NOT_IN_RANGE;
  const amounts: number[] = [];
  near.transfer = ((_target, _resource, amount) => { amounts.push(amount!); return OK; }) as Creep['transfer'];
  const energy = workerEnergyContext(observeColony(f.room));
  energy.consumers = [{ id: f.spawn.id, pos: f.spawn.pos, amount: 50, priority: 99 }];
  const assignment = { kind: 'refill', targetId: f.spawn.id, demandId: 'refill:spawn', capability: 'carry',
    contribution: 1, emergency: false, service: 'desired' } as const;
  assert.equal(runWorker(far, { ...assignment, creepName: far.name }, energy).phase, 'travel');
  assert.equal(energy.consumers[0].amount, 50);
  assert.equal(runWorker(near, { ...assignment, creepName: near.name }, energy).accepted, true);
  assert.deepEqual(amounts, [50]); assert.equal(energy.consumers[0].amount, 0);
});

test('earlier traveling worker leaves stored energy for an in-range worker', () => {
  const f = logisticsFixture({ count: 2, energy: 0 }); const [far, near] = f.workers;
  far.pos = position(40, 40); near.pos = f.buffer.pos; far.withdraw = () => ERR_NOT_IN_RANGE;
  const energy = workerEnergyContext(observeColony(f.room));
  energy.supplies = energy.supplies.filter((s) => s.id === f.buffer.id);
  energy.supplies[0].amount = 50;
  assert.equal(runWorker(far, undefined, energy).phase, 'travel');
  assert.equal(energy.supplies[0].amount, 50);
  assert.equal(runWorker(near, undefined, energy).accepted, true);
  assert.equal(energy.supplies[0].amount, 0);
});

for (const existing of ['container', 'site'] as const) {
  test(`shared adjacent ${existing} belongs to one source; construction builds the other's assigned tile`, () => {
    const f = logisticsFixture(); const second = f.secondSource(); second.pos = position(7, 7);
    if (existing === 'site') {
      f.structures.splice(f.structures.indexOf(f.buffer), 1);
      f.build('shared-site', STRUCTURE_CONTAINER).pos = f.buffer.pos;
    }
    const ops = observeSourceOperations(observeColony(f.room));
    const [first, other] = ops;
    assert.equal(first.tile?.[existing === 'container' ? 'containerId' : 'siteId'], existing === 'container' ? f.buffer.id : 'shared-site');
    assert.notDeepEqual([first.tile!.x, first.tile!.y], [other.tile!.x, other.tile!.y]);
    const placed: number[][] = [];
    f.room.createConstructionSite = ((x: number, y: number) => {
      placed.push([x, y]); f.build('second-site', STRUCTURE_CONTAINER).pos = position(x, y); return OK;
    }) as unknown as Room['createConstructionSite'];
    assert.equal(ensureSourceContainers(f.room, f.spawn, 4, ops), 1);
    assert.deepEqual(placed, [[other.tile!.x, other.tile!.y]]);
    assert.equal(ensureSourceContainers(f.room, f.spawn, 4, ops), 0);
    assert.equal(ensureSourceContainers(f.room, f.spawn, 4), 0);
    assert.equal(placed.length, 1);
  });
}

test('new buffer skips unreachable geometrically preferred tile and places a reachable alternative', () => {
  const f = logisticsFixture(); f.structures.splice(f.structures.indexOf(f.buffer), 1);
  const calls: { x: number; y: number; options: FindPathOpts }[] = [];
  Object.assign(globalThis, { RoomPosition: class {
    constructor(public x: number, public y: number, public roomName: string) {}
    findPathTo(target: RoomPosition, options: FindPathOpts) {
      calls.push({ x: this.x, y: this.y, options });
      return this.x === 6 && this.y === 6 ? [] : [{ x: target.x - 1, y: target.y - 1 }];
    }
  } });
  const ops = observeSourceOperations(observeColony(f.room));
  assert.deepEqual([ops[0].tile!.x, ops[0].tile!.y], [6, 5]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.options.maxRooms === 1 && c.options.maxOps === 2000));
  const placed: number[][] = [];
  f.room.createConstructionSite = ((x: number, y: number) => { placed.push([x, y]); return OK; }) as unknown as Room['createConstructionSite'];
  assert.equal(ensureSourceContainers(f.room, f.spawn, 4, ops), 1);
  assert.deepEqual(placed, [[6, 5]]); assert.equal(calls.length, 2); // Reuse this tick's viability result.
});

test('no reachable adjacent tile means no new container placement', () => {
  const f = logisticsFixture(); f.structures.splice(f.structures.indexOf(f.buffer), 1);
  Object.assign(globalThis, { RoomPosition: class { findPathTo() { return []; } } });
  f.room.createConstructionSite = (() => { throw new Error('unreachable placement'); }) as Room['createConstructionSite'];
  const ops = observeSourceOperations(observeColony(f.room));
  assert.equal(ops[0].tile, undefined);
  assert.equal(ensureSourceContainers(f.room, f.spawn, 4, ops), 0);
});

test('off-tile miner without MOVE cannot hold primary assignment over healthy replacement', () => {
  const f = logisticsFixture(); const old = f.specialist('miner', 'a'); const next = f.specialist('miner', 'b');
  old.pos = position(40, 40); old.getActiveBodyparts = (part) => part === WORK ? 5 : part === CARRY ? 1 : 0;
  old.ticksToLive = 10;
  const state = observeColony(f.room);
  runSourceLogistics(state, observeSourceOperations(state), workerEnergyContext(state), planWork(state));
  assert.deepEqual(f.actions, [`${next.name}:harvest:${f.source.id}`]); assert.equal(f.moves.length, 0);
});

test('stationary miner with damaged MOVE stays productive while healthy replacement waits', () => {
  const f = logisticsFixture(); const old = f.specialist('miner', 'a'); const next = f.specialist('miner', 'b');
  next.pos = position(7, 6); old.getActiveBodyparts = (part) => part === WORK ? 5 : part === CARRY ? 1 : 0;
  const state = observeColony(f.room);
  runSourceLogistics(state, observeSourceOperations(state), workerEnergyContext(state), planWork(state));
  assert.deepEqual(f.actions, [`${old.name}:harvest:${f.source.id}`]); assert.equal(f.moves.length, 0);
});

test('movable incumbent with insufficient WORK vacates for healthy replacement over two ticks', () => {
  const f = logisticsFixture(); const old = f.specialist('miner', 'a'); const next = f.specialist('miner', 'b');
  next.pos = position(7, 6); old.getActiveBodyparts = (part) => part === WORK || part === CARRY ? 1 : part === MOVE ? 3 : 0;
  const destinations = new Map<string, RoomPosition>();
  for (const c of [old, next]) c.moveTo = ((target: RoomPosition, options: MoveToOpts) => {
    assert.equal(options.maxRooms, 1); assert.equal(options.range, 0); destinations.set(c.name, target); return OK;
  }) as Creep['moveTo'];
  const tick = () => {
    const state = observeColony(f.room);
    runSourceLogistics(state, observeSourceOperations(state), workerEnergyContext(state), planWork(state));
  };
  tick(); assert.deepEqual(f.actions, []);
  assert.notDeepEqual([destinations.get(old.name)!.x, destinations.get(old.name)!.y], [6, 6]);
  assert.deepEqual([destinations.get(next.name)!.x, destinations.get(next.name)!.y], [6, 6]);
  for (const c of [old, next]) {
    const to = destinations.get(c.name)!; c.pos = position(to.x, to.y);
  }
  Game.time++; tick();
  assert.deepEqual(f.actions, [`${next.name}:harvest:${f.source.id}`]);
});

test('immobile underpowered tile occupant keeps useful mining and generalist fallback until expiry', () => {
  const f = logisticsFixture(); const old = f.specialist('miner', 'a'); const next = f.specialist('miner', 'b');
  f.specialist('hauler'); next.pos = position(7, 6);
  old.getActiveBodyparts = (part) => part === WORK || part === CARRY ? 1 : 0;
  const state = observeColony(f.room); const energy = workerEnergyContext(state);
  runSourceLogistics(state, observeSourceOperations(state), energy, planWork(state));
  assert.ok(f.actions.includes(`${old.name}:harvest:${f.source.id}`));
  assert.equal(f.actions.some((a) => a.startsWith(`${next.name}:harvest`)), false);
  assert.ok(energy.supplies.some((s) => s.id === f.source.id));
});

for (const damagedPart of [WORK, CARRY]) {
  test(`movable miner with no active ${damagedPart} vacates for its replacement`, () => {
    const f = logisticsFixture(); const old = f.specialist('miner', 'a'); const next = f.specialist('miner', 'b');
    next.pos = position(7, 6);
    old.getActiveBodyparts = (part) => part === damagedPart ? 0 : part === WORK ? 5 : part === CARRY ? 1 : part === MOVE ? 3 : 0;
    let vacated = false;
    old.moveTo = (() => { vacated = true; return OK; }) as Creep['moveTo'];
    const state = observeColony(f.room);
    runSourceLogistics(state, observeSourceOperations(state), workerEnergyContext(state), planWork(state));
    assert.equal(vacated, true); assert.deepEqual(f.actions, []);
  });
}

test('damaged incumbent waits for a safe yield tile rather than stranding its replacement', () => {
  const f = logisticsFixture(); const old = f.specialist('miner', 'a'); const next = f.specialist('miner', 'b');
  next.pos = position(7, 6);
  old.getActiveBodyparts = (part) => part === WORK || part === CARRY ? 1 : part === MOVE ? 3 : 0;
  const state = observeColony(f.room); const ops = observeSourceOperations(state);
  // All alternate adjacent tiles are now blocked; retain useful mining until a
  // safe handoff is possible instead of sending two bodies into an occupied tile.
  f.room.getTerrain = (() => ({ get: (x: number, y: number) => x === 6 && y === 6 ? 0 : TERRAIN_MASK_WALL })) as unknown as Room['getTerrain'];
  runSourceLogistics(state, ops, workerEnergyContext(state), planWork(state));
  assert.deepEqual(f.actions, [`${old.name}:harvest:${f.source.id}`]); assert.equal(f.moves.length, 0);
});

test('startup requests miner first, then permits hauling when miner is spawning or effective', () => {
  const f = logisticsFixture(); const ops = observeSourceOperations(observeColony(f.room));
  assert.deepEqual(requestSourcePopulation(ops, [], []).map((r) => r.identity.kind), ['miner']);
  const miner = f.specialist('miner'); miner.spawning = true;
  const spawning = [{ name: miner.name, memory: miner.memory }];
  assert.deepEqual(requestSourcePopulation(ops, [miner], spawning).map((r) => r.identity.kind), ['hauler']);
  assert.deepEqual(requestSourcePopulation(ops, [], spawning).map((r) => r.identity.kind), ['hauler']);
  miner.spawning = false;
  assert.deepEqual(requestSourcePopulation(ops, [miner], []).map((r) => r.identity.kind), ['hauler']);
  delete Game.creeps[miner.name];
  assert.deepEqual(requestSourcePopulation(ops, [], []).map((r) => r.identity.kind), ['miner']);
});

for (const kind of ['miner', 'hauler'] as const) {
  test(`aging ${kind} replacement precedes new source expansion regardless of lexical ID`, () => {
    const f = logisticsFixture(); const second = f.secondSource(); f.repair('buffer-b').pos = position(19, 19);
    const ops = observeSourceOperations(observeColony(f.room));
    const old = f.specialist(kind, 'old', second.id);
    if (kind === 'hauler') f.specialist('miner', 'support', second.id);
    old.ticksToLive = specialistLead(ops[1], kind);
    const requests = requestSourcePopulation(ops, Object.values(Game.creeps), []);
    assert.equal(requests.length, 1); assert.equal(requests[0].identity.kind, kind);
    assert.equal(requests[0].identity.operationId, ops[1].id); assert.equal(requests[0].reason, 'replacement');
    assert.deepEqual(requestSourcePopulation([...ops].reverse(), Object.values(Game.creeps), []), requests);
    const worker = requestWorkerPopulation({ home: f.room.name, population: { ...observeColony(f.room).population, effectiveWorkers: 3 },
      replacementLead: 100, energyAvailable: 800, energyCapacity: 800 })!;
    assert.equal(planSpawn({ home: f.room.name, requests: [...requests, worker], energyAvailable: 800, energyCapacity: 800 })?.request, worker);
  });
}
