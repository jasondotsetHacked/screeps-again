import assert from 'node:assert/strict';
import test from 'node:test';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { observeSourceOperations } from '../../src/operations/observeSources';
import { localMinerBody, localMinerIngress, requestSourcePopulation, specialistLead, distance } from '../../src/operations/sourceOperation';
import { bodyCost } from '../../src/spawning/body';
import { planHauling, haulerDeliveryMode } from '../../src/logistics/planHauling';
import { observeLogisticsSinks, CONTROLLER_RESERVE } from '../../src/logistics/observeSinks';
import { runSourceLogistics } from '../../src/colony/runSourceLogistics';
import { planWork } from '../../src/colony/planWork';
import { runWorker, workerEnergyContext } from '../../src/creeps/runWorker';
import { observeLocalLayout, ensureLayoutSite, runConstruction } from '../../src/construction/runConstruction';
import { layoutReservations } from '../../src/construction/localLayout';
import { recoverColonyCreepMemory } from '../../src/memory/lifecycle';

function stored(target: Structure, energy: number, capacity = 2000) {
  Object.assign(target, { store: { getUsedCapacity: () => energy, getFreeCapacity: () => capacity - energy,
    getCapacity: () => capacity } });
}
function downstream(f: ReturnType<typeof logisticsFixture>, energy = 500) {
  const buffer = f.repair('controller-buffer'); buffer.pos = position(28, 28);
  stored(buffer, energy); return buffer;
}
function storage(f: ReturnType<typeof logisticsFixture>, energy = 0, capacity = 1_000_000) {
  const target = f.refill('storage', 0, STRUCTURE_STORAGE); target.pos = position(13, 13);
  stored(target, energy, capacity); return target;
}
function run(f: ReturnType<typeof logisticsFixture>) {
  const state = observeColony(f.room); const operations = observeSourceOperations(state);
  const energy = workerEnergyContext(state);
  runSourceLogistics(state, operations, energy, planWork(state));
  return { state, operations, energy };
}
function construction(f: ReturnType<typeof logisticsFixture>) {
  const placed: { x: number; y: number; type: BuildableStructureConstant }[] = [];
  f.room.lookForAt = ((type: string, x: number, y: number) =>
    (type === LOOK_STRUCTURES ? f.structures : f.sites).filter((s) => s.pos.x === x && s.pos.y === y)) as Room['lookForAt'];
  f.room.createConstructionSite = ((x: number, y: number, type: BuildableStructureConstant) => {
    if (f.sites.some((s) => s.pos.x === x && s.pos.y === y)) return ERR_INVALID_TARGET;
    placed.push({ x, y, type }); f.build(`site-${placed.length}`, type).pos = position(x, y); return OK;
  }) as Room['createConstructionSite'];
  return placed;
}

test('explicit local miner policy is 5W 1C 1M and does not supply a universal miner template', () => {
  const f = logisticsFixture(); const o = observeSourceOperations(observeColony(f.room))[0];
  assert.deepEqual(localMinerBody(10), [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]);
  assert.deepEqual(o.minerBody, localMinerBody(10)); assert.equal(bodyCost(o.minerBody), 600);
  assert.equal(localMinerIngress([WORK, WORK, WORK, WORK, WORK, CARRY, MOVE], 10), 90);
  assert.equal(localMinerIngress([WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE], 10), 30);
});

test('slow local miner replacement uses source ingress, not refill detour, with full spawn and safety lead', () => {
  const f = logisticsFixture(); const state = observeColony(f.room); const o = observeSourceOperations(state)[0];
  assert.equal(o.minerIngressTicks, (o.tile!.routeTicks! + 5) * 6);
  assert.equal(specialistLead(o, 'miner'), 21 + o.minerIngressTicks + 50);
  const old = f.specialist('miner'); old.ticksToLive = specialistLead(o, 'miner');
  assert.ok(requestSourcePopulation([o], [old], []).some((r) => r.identity.kind === 'miner' && r.reason === 'replacement'));
  const far = f.refill('tower', 100, STRUCTURE_TOWER); far.pos = position(14, 14);
  const detour = observeSourceOperations(observeColony(f.room))[0];
  assert.equal(detour.minerIngressTicks, o.minerIngressTicks); assert.ok(detour.haulTripTicks > o.haulTripTicks);
  f.room.getTerrain = (() => ({ get: () => TERRAIN_MASK_SWAMP })) as unknown as Room['getTerrain'];
  assert.ok(observeSourceOperations(observeColony(f.room))[0].minerIngressTicks > o.minerIngressTicks);
});

test('partially loaded hauler keeps loading, including 10-energy increments despite normal refill demand', () => {
  const f = logisticsFixture(); const { operations } = run(f); const o = operations[0];
  for (const energy of [10, 100, 199]) {
    const load = { pos: f.buffer.pos, energy, freeCapacity: 400 - energy };
    const plan = planHauling(load, o, [{ id: f.buffer.id, pos: f.buffer.pos, kind: 'withdraw', amount: 10 }],
      [{ id: f.spawn.id, pos: f.spawn.pos, amount: 300, priority: 90 }]);
    assert.equal(plan?.kind, 'withdraw'); assert.equal(plan?.amount, 10);
  }
});

test('half-load dispatch persists until empty, survives partial delivery, and resets after unloading', () => {
  const f = logisticsFixture(); const o = observeSourceOperations(observeColony(f.room))[0];
  const consumers = [{ id: f.spawn.id, pos: f.spawn.pos, amount: 50, priority: 90 }];
  const load = { pos: f.buffer.pos, energy: 200, freeCapacity: 200 };
  assert.equal(haulerDeliveryMode(load, o, consumers), true);
  assert.equal(planHauling({ ...load, energy: 10, freeCapacity: 390, delivering: true }, o, [], consumers)?.kind, 'transfer');
  assert.equal(haulerDeliveryMode({ ...load, energy: 0, freeCapacity: 400, delivering: true }, o, consumers), false);
});

test('tiny loads dispatch only for actual critical demand; stale fulfilled critical demand cannot trigger dispatch', () => {
  const f = logisticsFixture(); const o = observeSourceOperations(observeColony(f.room))[0];
  const load = { pos: f.buffer.pos, energy: 10, freeCapacity: 390 };
  const critical = { id: f.spawn.id, pos: f.spawn.pos, amount: 300, priority: 99, critical: true };
  assert.equal(planHauling(load, o, [], [critical])?.amount, 10);
  assert.equal(planHauling(load, o, [], [{ ...critical, amount: 0 }]), undefined);
  assert.equal(planHauling(load, o, [], [{ ...critical, critical: false }]), undefined);
});

test('worker recovery and hostile tower minimum demands explicitly dispatch a tiny load', () => {
  for (const kind of ['recovery', 'tower'] as const) {
    const f = logisticsFixture({ count: kind === 'recovery' ? 1 : 4 });
    const c = f.specialist('hauler'); stored(c as unknown as Structure, 10, 400);
    const state = observeColony(f.room);
    if (kind === 'tower') { state.hostiles = [{} as Creep]; state.refillTargets = [
      { id: f.refill('tower', 100, STRUCTURE_TOWER).id, pos: f.spawn.pos, freeEnergy: 100, structureType: STRUCTURE_TOWER } ]; }
    runSourceLogistics(state, observeSourceOperations(state), workerEnergyContext(state), planWork(state));
    assert.ok(f.actions.includes(`${c.name}:transfer:${kind === 'recovery' ? f.spawn.id : 'tower'}:10`));
  }
});

test('partial haulers share accepted buffer withdrawals without double-promising energy', () => {
  const f = logisticsFixture(); const a = f.specialist('hauler', 'a'), b = f.specialist('hauler', 'b');
  stored(a as unknown as Structure, 10, 400); stored(b as unknown as Structure, 10, 400); stored(f.buffer, 30);
  const { energy } = run(f);
  assert.ok(f.actions.includes(`${a.name}:withdraw:${f.buffer.id}:30`));
  assert.equal(f.actions.some((action) => action.startsWith(`${b.name}:withdraw`)), false);
  assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 0);
});

test('loading travel and failed movement never reserve buffer energy', () => {
  for (const movement of [OK, ERR_INVALID_TARGET]) {
    const f = logisticsFixture(); const c = f.specialist('hauler'); stored(c as unknown as Structure, 10, 400);
    c.withdraw = () => ERR_NOT_IN_RANGE; c.moveTo = (() => movement) as Creep['moveTo'];
    const { energy } = run(f); assert.equal(energy.supplies.find((s) => s.id === f.buffer.id)?.amount, 1000);
  }
});

test('healthy chain owns even tiny source deposits while workers acquire from reachable downstream reserve', () => {
  const f = logisticsFixture(); const buffer = downstream(f); f.specialist('miner'); const h = f.specialist('hauler');
  h.pos = position(10, 10); h.withdraw = () => ERR_NOT_IN_RANGE; stored(f.buffer, 10);
  f.workers[0].pos = f.buffer.pos;
  const { energy } = run(f);
  assert.equal(energy.supplies.some((s) => s.id === f.buffer.id || s.id === f.source.id), false);
  const acquired: string[] = []; f.workers[0].withdraw = ((target) => { acquired.push(target.id); return OK; }) as Creep['withdraw'];
  runWorker(f.workers[0], undefined, energy);
  assert.deepEqual(acquired, [buffer.id]); assert.equal(energy.fallbackSupplies?.find((s) => s.id === f.buffer.id)?.amount, 10);
});

for (const loss of ['miner', 'hauler', 'damaged-hauler', 'damaged-miner', 'buffer', 'downstream', 'empty-downstream', 'recovery', 'path', 'blocked-hauler', 'urgent-controller'] as const) {
  test(`${loss} releases soft buffer ownership immediately`, () => {
    const f = logisticsFixture(); const d = downstream(f); const miner = f.specialist('miner'), h = f.specialist('hauler');
    if (loss === 'miner') delete Game.creeps[miner.name];
    if (loss === 'hauler') delete Game.creeps[h.name];
    if (loss === 'damaged-hauler') h.getActiveBodyparts = (p) => p === CARRY ? 8 : p === MOVE ? 1 : 0;
    if (loss === 'damaged-miner') miner.getActiveBodyparts = (p) => p === WORK || p === CARRY || p === MOVE ? 1 : 0;
    if (loss === 'buffer') f.structures.splice(f.structures.indexOf(f.buffer), 1);
    if (loss === 'downstream') f.structures.splice(f.structures.indexOf(d), 1);
    if (loss === 'empty-downstream') stored(d, 0);
    if (loss === 'recovery') for (const c of f.workers.slice(1)) delete Game.creeps[c.name];
    if (loss === 'blocked-hauler') h.moveTo = (() => ERR_INVALID_TARGET) as Creep['moveTo'], h.withdraw = () => ERR_NOT_IN_RANGE;
    if (loss === 'urgent-controller') f.controller.ticksToDowngrade = 1000;
    if (loss === 'path') Object.assign(globalThis, { RoomPosition: class { findPathTo() { return []; } } });
    const { energy } = run(f);
    if (loss !== 'buffer') assert.ok(energy.supplies.some((s) => s.id === f.buffer.id));
    if (['miner', 'hauler', 'damaged-hauler', 'damaged-miner', 'buffer', 'recovery', 'path', 'blocked-hauler', 'urgent-controller'].includes(loss)) {
      assert.ok(energy.supplies.some((s) => s.id === f.source.id));
    }
  });
}

test('workers reopen source buffers in the same tick when peers exhaust downstream supply', () => {
  const f = logisticsFixture(); downstream(f, 50); f.specialist('miner'); f.specialist('hauler');
  const { energy } = run(f);
  runWorker(f.workers[0], undefined, energy); assert.equal(energy.fallbackSupplies?.length, 2);
  runWorker(f.workers[1], undefined, energy); assert.equal(energy.fallbackSupplies?.length, 0);
  assert.ok(energy.supplies.some((s) => s.id === f.buffer.id));
});

test('immobile worker cannot be stranded by global buffer ownership', () => {
  const f = logisticsFixture(); downstream(f); f.specialist('miner'); f.specialist('hauler');
  const worker = f.workers[0]; worker.pos = f.buffer.pos;
  worker.getActiveBodyparts = (p) => p === WORK || p === CARRY ? 1 : 0;
  const { energy } = run(f);
  assert.equal(runWorker(worker, undefined, energy).accepted, true);
  assert.ok(f.actions.includes(`${worker.name}:withdraw`));
});

test('controller working reserve comes after refills and before storage; reserve is bounded', () => {
  const f = logisticsFixture(); const d = downstream(f, 400); const s = storage(f);
  const c = f.specialist('hauler'); stored(c as unknown as Structure, 400, 400);
  const state = observeColony(f.room), ops = observeSourceOperations(state);
  const sinks = observeLogisticsSinks(state, ops, planWork(state)).consumers;
  const load = { pos: c.pos, energy: 400, freeCapacity: 0 };
  assert.equal(planHauling(load, ops[0], state.energySupplies, sinks)?.target.id, f.spawn.id);
  sinks.find((sink) => sink.id === f.spawn.id)!.amount = 0;
  assert.equal(planHauling(load, ops[0], state.energySupplies, sinks)?.target.id, d.id);
  assert.equal(sinks.find((sink) => sink.id === d.id)?.amount, CONTROLLER_RESERVE - 400);
  sinks.find((sink) => sink.id === d.id)!.amount = 0;
  assert.equal(planHauling(load, ops[0], state.energySupplies, sinks)?.target.id, s.id);
});

test('controller reserve contention cannot be overpromised by multiple haulers', () => {
  const f = logisticsFixture(); const d = downstream(f, 480); stored(f.spawn, 300, 300); storage(f);
  const a = f.specialist('hauler', 'a'), b = f.specialist('hauler', 'b');
  stored(a as unknown as Structure, 400, 400); stored(b as unknown as Structure, 400, 400);
  const { energy } = run(f);
  assert.ok(f.actions.includes(`${a.name}:transfer:${d.id}:20`));
  assert.ok(f.actions.includes(`${b.name}:transfer:storage:400`));
  assert.equal(energy.consumers?.find((sink) => sink.id === d.id)?.amount, 0);
});

test('delivery travel does not hide controller reserve or storage capacity', () => {
  const f = logisticsFixture(); const d = downstream(f, 0); stored(f.spawn, 300, 300);
  const c = f.specialist('hauler'); stored(c as unknown as Structure, 400, 400); c.transfer = () => ERR_NOT_IN_RANGE;
  const { energy } = run(f); assert.equal(energy.consumers?.find((s) => s.id === d.id)?.amount, 500);
});

test('built owned active storage is a general supply, while inactive/hostile storage is excluded', () => {
  const f = logisticsFixture(); const s = storage(f, 1000);
  assert.ok(observeColony(f.room).energySupplies.some((supply) => supply.id === s.id));
  s.isActive = () => false;
  assert.equal(observeColony(f.room).energySupplies.some((supply) => supply.id === s.id), false);
  s.isActive = () => true; Object.assign(s, { my: false });
  assert.equal(observeColony(f.room).energySupplies.some((supply) => supply.id === s.id), false);
});

test('surplus sinks do not make source haulers withdraw storage or downstream energy', () => {
  const f = logisticsFixture(); storage(f, 1000); downstream(f, 500); const c = f.specialist('hauler');
  stored(f.buffer, 0); const { energy } = run(f);
  assert.equal(f.actions.some((a) => a.startsWith(`${c.name}:withdraw`)), false);
  assert.ok(energy.supplies.some((s) => s.id === 'storage'));
});

test('full/unavailable storage and missing controller buffer leave safe worker fallback and no invalid transfer', () => {
  const f = logisticsFixture(); const s = storage(f, 100, 100); stored(f.spawn, 300, 300);
  const c = f.specialist('hauler'); stored(c as unknown as Structure, 400, 400);
  run(f); assert.equal(f.actions.some((a) => a.startsWith(`${c.name}:transfer`)), false);
  f.structures.splice(f.structures.indexOf(s), 1); f.specialist('miner');
  const { energy } = run(f); assert.ok(energy.supplies.some((supply) => supply.id === f.buffer.id));
});

test('unreachable or privately ramparted downstream stores never justify ownership or delivery', () => {
  for (const inaccessible of ['route', 'rampart']) {
    const f = logisticsFixture(); const d = downstream(f); f.specialist('miner'); f.specialist('hauler');
    if (inaccessible === 'route') Object.assign(globalThis, { RoomPosition: class {
      constructor(public x: number, public y: number) {}
      findPathTo(target: RoomPosition) { return this.x === d.pos.x ? [] : [{ x: target.x - 1, y: target.y - 1 }]; }
    } });
    else f.structures.push({ id: 'rampart', pos: d.pos, structureType: STRUCTURE_RAMPART, my: false, isPublic: false } as StructureRampart);
    const { energy } = run(f); assert.ok(energy.supplies.some((s) => s.id === f.buffer.id));
    assert.equal(energy.consumers?.some((s) => s.id === d.id), false);
  }
});

test('layout has deterministic reachable distinct slots and controller upgrade space', () => {
  const f = logisticsFixture(); const ops = observeSourceOperations(observeColony(f.room));
  const layout = observeLocalLayout(f.room, f.spawn, ops);
  assert.deepEqual(observeLocalLayout(f.room, f.spawn, ops), layout);
  assert.ok(layout.storage && layout.coreLink && layout.terminal && layout.coreAccess);
  assert.ok(layout.controllerBuffer && layout.controllerLink && layout.controllerWork);
  assert.equal(distance(layout.controllerBuffer!, f.controller.pos), 2);
  assert.ok(distance(layout.controllerWork!, f.controller.pos) <= 3);
  const slots = layoutReservations(layout); assert.equal(new Set(slots.map((p) => `${p.x},${p.y}`)).size, slots.length);
  assert.ok(slots.every((p) => p.x >= 3 && p.x <= 46 && p.y >= 3 && p.y <= 46));
  assert.ok(slots.every((p) => !ops.some((o) => distance(p, o.tile!) === 0)));
});

test('controller container/site is adopted and never duplicated, and storage site is adopted too', () => {
  for (const type of ['built', 'site']) {
    const f = logisticsFixture(); construction(f);
    const planned = observeLocalLayout(f.room, f.spawn);
    if (type === 'built') f.repair('controller-buffer').pos = position(planned.controllerBuffer!.x, planned.controllerBuffer!.y);
    else f.build('controller-site', STRUCTURE_CONTAINER).pos = position(planned.controllerBuffer!.x, planned.controllerBuffer!.y);
    const adopted = observeLocalLayout(f.room, f.spawn);
    assert.deepEqual(adopted.controllerBuffer, planned.controllerBuffer);
    assert.equal(ensureLayoutSite(f.room, adopted.controllerBuffer, STRUCTURE_CONTAINER), 0);
    assert.equal(ensureLayoutSite(f.room, planned.storage, STRUCTURE_STORAGE), 1);
    assert.deepEqual(observeLocalLayout(f.room, f.spawn).storage, planned.storage);
    assert.equal(ensureLayoutSite(f.room, planned.storage, STRUCTURE_STORAGE), 0);
  }
});

test('generic RCL3 expansion preserves core and controller reservations across planning passes', () => {
  const f = logisticsFixture({ level: 3 }); const placed = construction(f);
  Object.assign(CONTROLLER_STRUCTURES, { extension: { 2: 5, 3: 10, 4: 20 }, tower: { 2: 0, 3: 1, 4: 1 } });
  const ops = observeSourceOperations(observeColony(f.room)); const layout = observeLocalLayout(f.room, f.spawn, ops);
  for (let i = 0; i < 4; i++) { Game.time = 25 * (i + 1); runConstruction(f.room, ops); }
  assert.equal(placed.some((s) => s.type === STRUCTURE_STORAGE), false);
  const reserved = layoutReservations(layout);
  assert.ok(placed.filter((s) => s.type === STRUCTURE_EXTENSION || s.type === STRUCTURE_TOWER).every((s) =>
    !reserved.some((p) => p.x === s.x && p.y === s.y)));
  assert.deepEqual(observeLocalLayout(f.room, f.spawn, ops), layout);
});

test('RCL4 establishes one storage site before extension limit without exceeding existing four-site budget', () => {
  const f = logisticsFixture({ level: 4 }); const placed = construction(f);
  Object.assign(CONTROLLER_STRUCTURES, { extension: { 4: 20 }, tower: { 4: 1 } });
  const ops = observeSourceOperations(observeColony(f.room));
  Game.time = 25; runConstruction(f.room, ops);
  assert.equal(placed.length, 4); assert.equal(placed[0].type, STRUCTURE_STORAGE);
  assert.equal(placed.filter((s) => s.type === STRUCTURE_EXTENSION).length, 3);
  Game.time = 50; runConstruction(f.room, ops);
  assert.equal(placed.filter((s) => s.type === STRUCTURE_STORAGE).length, 1);
  assert.equal(planWork(observeColony(f.room)).filter((d) => d.kind === 'build').sort((a, b) => b.priority - a.priority)[0].target.id,
    f.sites.find((s) => s.structureType === STRUCTURE_EXTENSION)!.id);
});

test('enclosed controller area and walls never acquire unreachable controller sites', () => {
  const f = logisticsFixture();
  f.room.getTerrain = (() => ({ get: (x: number, y: number) => Math.max(Math.abs(x - 30), Math.abs(y - 30)) === 4 ? TERRAIN_MASK_WALL : 0 })) as unknown as Room['getTerrain'];
  const layout = observeLocalLayout(f.room, f.spawn);
  assert.equal(layout.controllerBuffer, undefined); assert.ok(layout.storage);
});

test('reset specialist Memory recovers scope and reconstructs safe batching intent from observed load', () => {
  const f = logisticsFixture(); const c = f.specialist('hauler'); const identity = { ...c.memory };
  stored(c as unknown as Structure, 10, 400); c.memory = {}; Memory.creeps = {};
  recoverColonyCreepMemory(f.room); assert.equal(c.memory.operationId, identity.operationId);
  run(f); assert.equal(c.memory.delivering, false);
  assert.ok(f.actions.includes(`${c.name}:withdraw:${f.buffer.id}:390`));
  assert.equal(JSON.stringify(Memory).includes('reservation'), false);
});

test('miner failure with an empty buffer flushes a partial hauler load instead of waiting for nonexistent production', () => {
  const f = logisticsFixture(); const h = f.specialist('hauler'); stored(h as unknown as Structure, 10, 400);
  stored(f.buffer, 0); run(f);
  assert.ok(f.actions.includes(`${h.name}:transfer:${f.spawn.id}:10`));
});

test('optional downstream route failure keeps critical recovery refill and worker supply available', () => {
  const f = logisticsFixture({ count: 1 }); downstream(f); const h = f.specialist('hauler');
  stored(h as unknown as Structure, 10, 400);
  Object.assign(globalThis, { RoomPosition: class {
    constructor(public x: number, public y: number) {}
    findPathTo(target: RoomPosition) {
      if (this.x === 28) throw new Error('downstream path failed');
      return [{ x: target.x - 1, y: target.y - 1 }];
    }
  } });
  const { energy } = run(f);
  assert.ok(f.actions.includes(`${h.name}:transfer:${f.spawn.id}:10`));
  assert.ok(energy.supplies.some((s) => s.id === f.buffer.id));
  assert.equal(Memory.ops?.recentErrors.at(-1)?.subject, `${f.room.name}/logistics-sinks`);
});

test('controller site follows essential source sites, with exactly one adopted controller buffer', () => {
  const f = logisticsFixture({ level: 3 }); const placed = construction(f);
  Object.assign(CONTROLLER_STRUCTURES, { extension: { 3: 0 }, tower: { 3: 0 } });
  f.structures.splice(f.structures.indexOf(f.buffer), 1);
  const ops = observeSourceOperations(observeColony(f.room));
  const layout = observeLocalLayout(f.room, f.spawn, ops);
  Game.time = 25; runConstruction(f.room, ops);
  assert.deepEqual(placed.map((s) => [s.x, s.y, s.type]), [
    [ops[0].tile!.x, ops[0].tile!.y, STRUCTURE_CONTAINER],
    [layout.controllerBuffer!.x, layout.controllerBuffer!.y, STRUCTURE_CONTAINER]
  ]);
  Game.time = 50; runConstruction(f.room, observeSourceOperations(observeColony(f.room)));
  assert.equal(placed.length, 2);
});

test('core footprint leaves narrow source access open when future storage/link/terminal block movement', () => {
  const f = logisticsFixture(); const second = f.secondSource(); f.repair('source-b-buffer').pos = position(19, 19);
  f.room.getTerrain = (() => ({ get: (x: number, y: number) => x === 14 && y !== 11 ? TERRAIN_MASK_WALL : 0 })) as unknown as Room['getTerrain'];
  const ops = observeSourceOperations(observeColony(f.room));
  const layout = observeLocalLayout(f.room, f.spawn, ops);
  assert.ok(layout.storage); assert.ok(layout.controllerBuffer);
  assert.ok([layout.storage, layout.coreLink, layout.terminal, layout.controllerLink].every((p) => !p || p.x !== 14 || p.y !== 11));
  for (const [pos, type] of [[layout.storage!, STRUCTURE_STORAGE], [layout.coreLink!, STRUCTURE_LINK],
    [layout.terminal!, STRUCTURE_TERMINAL]] as const) {
    f.build(type, type).pos = position(pos.x, pos.y);
  }
  const future = observeLocalLayout(f.room, f.spawn, ops);
  assert.ok(future.controllerBuffer); assert.equal(second.pos.x, 20);
});

test('downstream observation adds no room finds and at most two bounded local routes', () => {
  const f = logisticsFixture(); downstream(f); storage(f);
  const state = observeColony(f.room), ops = observeSourceOperations(state), scans = [...f.calls], paths = f.paths.length;
  observeLogisticsSinks(state, ops, planWork(state));
  assert.deepEqual([...f.calls], scans); assert.equal(f.paths.length - paths, 2);
  assert.ok(f.paths.slice(paths).every((p) => p.maxRooms === 1 && p.maxOps === 2000 && p.ignoreCreeps));
});
