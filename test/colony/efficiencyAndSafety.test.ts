import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { selectEnergySupply, type EnergySupply } from '../../src/colony/planEnergy';
import { planSafety } from '../../src/colony/planSafety';
import { scheduleWorkers } from '../../src/colony/scheduler';
import { runColony } from '../../src/colony/runColony';
import { runKernel } from '../../src/kernel/runKernel';
import { runWorker, workerEnergyContext } from '../../src/creeps/runWorker';
import { summarizeLabor, publishOpsSnapshot } from '../../src/ops/opsTelemetry';
import type { WorkDemand } from '../../src/work/demands';

function demand(id: string, x: number, priority = 90): WorkDemand {
  return { id, target: { id, pos: position(x, x) }, kind: 'refill', capability: 'carry',
    priority, minimum: 0, desired: 1, maximum: 1 };
}

test('peer demands compare worker-target pairs before IDs, independently of input ordering', () => {
  const state = observeColony(fixture({ count: 2 }).room);
  state.workers[1].pos = position(40, 40);
  const demands = [demand('a-far', 39), demand('z-near', 11)];
  const assignments = scheduleWorkers(state, demands);
  assert.deepEqual(assignments.map((a) => [a.creepName, a.demandId]).sort(),
    [['w0', 'z-near'], ['w1', 'a-far']]);
  assert.deepEqual(scheduleWorkers({ workers: [...state.workers].reverse() }, [...demands].reverse()), assignments);
  assert.equal(scheduleWorkers({ workers: [state.workers[0]] }, demands)[0].demandId, 'z-near');
  demands[0].priority = 91;
  assert.equal(scheduleWorkers({ workers: [state.workers[0]] }, demands)[0].demandId, 'a-far');
});

function stored(id: string, amount: number, x = 10) {
  return { id, pos: position(x, 10), store: { getUsedCapacity: () => amount } };
}

test('observation projects recovered energy once and protects spawn/extension/tower energy', () => {
  const f = fixture();
  f.refill('spawn'); f.refill('extension', 0, STRUCTURE_EXTENSION); f.refill('tower', 0, STRUCTURE_TOWER);
  const container = f.repair();
  Object.assign(container, stored('container', 100));
  f.tombstones.push(stored('tombstone', 80) as Tombstone);
  f.ruins.push(stored('ruin', 60) as Ruin);
  f.drops.push({ id: 'drop', pos: position(), resourceType: RESOURCE_ENERGY, amount: 30 } as Resource);
  const state = observeColony(f.room);
  assert.deepEqual(state.energySupplies.map((s) => [s.id, s.kind, s.amount]), [
    ['source-a', 'harvest', 3000], ['drop', 'pickup', 30], ['container', 'withdraw', 100],
    ['tombstone', 'withdraw', 80], ['ruin', 'withdraw', 60]
  ]);
  const calls = [...f.calls];
  const context = workerEnergyContext(state);
  selectEnergySupply({ pos: position(), work: 1, move: 1, freeCapacity: 50 }, context.supplies, context.sourceWork);
  assert.deepEqual([...f.calls], calls);
  assert.equal(f.calls.get(FIND_TOMBSTONES), 1);
  assert.equal(f.calls.get(FIND_RUINS), 1);
  context.supplies[0].amount = 0;
  assert.equal(state.energySupplies[0].amount, 3000);
});

test('supplies under private hostile ramparts are excluded', () => {
  const f = fixture();
  f.ruins.push(stored('ruin', 100) as Ruin);
  f.structures.push({ id: 'rampart', pos: position(), structureType: STRUCTURE_RAMPART,
    my: false, isPublic: false } as StructureRampart);
  assert.equal(observeColony(f.room).energySupplies.some((s) => s.id === 'ruin'), false);
});

test('energy selection weighs usable energy, distance, capability, source load and regeneration', () => {
  fixture();
  const worker = { pos: position(), work: 1, move: 1, freeCapacity: 50 };
  const supplies: EnergySupply[] = [
    { id: 'source', pos: position(11, 10), kind: 'harvest', amount: 3000 },
    { id: 'store', pos: position(13, 10), kind: 'withdraw', amount: 50 },
    { id: 'tiny', pos: position(), kind: 'pickup', amount: 1 }
  ];
  assert.equal(selectEnergySupply(worker, supplies, new Map())?.id, 'store');
  assert.equal(selectEnergySupply({ ...worker, work: 0 }, supplies, new Map())?.id, 'store');
  assert.equal(selectEnergySupply({ ...worker, move: 0 }, supplies, new Map())?.id, 'source');
  assert.equal(selectEnergySupply({ ...worker, work: 0, move: 0 }, supplies.slice(0, 2), new Map()), undefined);
  assert.equal(selectEnergySupply({ ...worker, freeCapacity: 0 }, supplies, new Map()), undefined);
  const sources: EnergySupply[] = [
    { id: 'a', kind: 'harvest', amount: 3000, pos: position(11, 10) },
    { id: 'b', kind: 'harvest', amount: 3000, pos: position(12, 10) }
  ];
  assert.equal(selectEnergySupply(worker, sources, new Map([['a', 4]]))?.id, 'b');
  sources.forEach((s, index) => { s.amount = 0; s.regeneration = index ? 2 : 20; });
  assert.equal(selectEnergySupply(worker, sources, new Map())?.id, 'b');
  assert.deepEqual(selectEnergySupply(worker, [...sources].reverse(), new Map()), sources[1]);
});

test('empty workers travel toward the regenerating source even when harvest rejects zero source energy', () => {
  const f = fixture({ count: 1, energy: 0 });
  f.source.energy = 0;
  f.source.ticksToRegeneration = 5;
  f.workers[0].harvest = () => ERR_NOT_ENOUGH_ENERGY;
  const state = observeColony(f.room);
  const execution = runWorker(f.workers[0], undefined, workerEnergyContext(state));
  assert.equal(execution.phase, 'travel');
  assert.equal(execution.accepted, false);
  assert.deepEqual(f.actions, ['w0:move:source-a']);
});

for (const kind of ['container', 'tombstone', 'ruin'] as const) {
  test(`empty assigned workers withdraw ${kind} energy and reserve it once within a tick`, () => {
    const f = fixture({ count: 2, energy: 0 });
    const store = stored(kind, 50);
    if (kind === 'container') Object.assign(f.repair(), store);
    else if (kind === 'tombstone') f.tombstones.push(store as Tombstone);
    else f.ruins.push(store as Ruin);
    const colony = runColony(f.room);
    assert.equal(f.actions.filter((a) => a.endsWith(':withdraw')).length, 1);
    assert.equal(f.actions.filter((a) => a.endsWith(':harvest')).length, 1);
    assert.ok(colony.executions.every((e) => e.phase === 'acquire' && e.accepted));
    const summary = summarizeLabor(colony);
    assert.equal(summary.kinds.reduce((sum, k) => sum + k.acquiringWorkers!, 0), 2);
    assert.equal(summary.kinds.reduce((sum, k) => sum + k.acceptedWorkIntents!, 0), 0);
  });
}

test('telemetry separates bounded/surplus capacity from travel, acquisition, accepted work and blocked execution', () => {
  const f = fixture({ count: 5 });
  f.workers[0].upgradeController = () => ERR_NOT_IN_RANGE;
  f.workers[1].upgradeController = () => ERR_INVALID_TARGET;
  Object.assign(f.workers[2].store, { getUsedCapacity: () => 0, getFreeCapacity: () => 50 });
  const colony = runColony(f.room);
  const upgrade = summarizeLabor(colony).kinds.find((k) => k.kind === 'upgrade')!;
  assert.equal(upgrade.boundedAssigned, 1);
  assert.equal(upgrade.surplusAssigned, 4);
  assert.equal(upgrade.acquiringWorkers, 1);
  assert.equal(upgrade.travelingWorkers, 1);
  assert.equal(upgrade.blockedWorkers, 1);
  assert.equal(upgrade.workingWorkers, 2);
  assert.equal(upgrade.acceptedWorkIntents, 2);
  assert.equal(upgrade.assigned, 5);
  publishOpsSnapshot([f.room], 0, new Map([[f.room.name, colony]]));
  assert.equal(Memory.ops!.snapshot!.rooms[0].safety?.reason, 'no-immediate-threat');
  assert.equal(JSON.stringify(Memory.ops!.snapshot!.rooms[0].labor).includes('creepName'), false);
});

test('construction exceptions are recorded without aborting population recovery or worker execution', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ count: 1 });
  const spawn = f.refill();
  let spawned = false;
  spawn.spawnCreep = (() => { spawned = true; return OK; }) as typeof spawn.spawnCreep;
  const find = f.room.find.bind(f.room);
  f.room.find = ((type: number) => {
    if (type === FIND_MY_STRUCTURES) throw new Error('site planning failed');
    return find(type as FindConstant);
  }) as typeof f.room.find;
  const colony = runColony(f.room);
  assert.equal(spawned, true);
  assert.equal(colony.executions.length, 1);
  assert.ok(f.actions.includes('w0:refill'));
  assert.equal(Memory.ops?.recentErrors[0].subject, f.room.name + '/construction');
});

function threatFixture(part: BodyPartConstant = ATTACK, range = 1) {
  const f = fixture();
  const spawn = f.refill();
  Object.assign(f.controller, { safeModeAvailable: 1 });
  f.hostiles.push({ id: 'hostile', pos: position(spawn.pos.x + range, spawn.pos.y),
    getActiveBodyparts: (type: BodyPartConstant) => type === part ? 1 : 0 } as Creep);
  return f;
}

test('safety requests protection for immediate melee, ranged and dismantle threats only', () => {
  for (const [part, range] of [[ATTACK, 1], [RANGED_ATTACK, 3], [WORK, 1]] as const) {
    const f = threatFixture(part, range);
    const colony = runColony(f.room);
    assert.equal(colony.safety.activateSafeMode, true);
    assert.equal(colony.safety.accepted, true);
    assert.ok(f.actions.includes('safe-mode'));
  }
  for (const [part, range] of [[MOVE, 1], [ATTACK, 2], [RANGED_ATTACK, 4], [WORK, 2]] as const) {
    const f = threatFixture(part, range);
    assert.equal(planSafety(observeColony(f.room)).reason, 'no-immediate-threat');
  }
});

test('safety respects availability, active protection, cooldown, blocking and the global gate', () => {
  const f = threatFixture();
  const state = observeColony(f.room);
  for (const [field, value, reason] of [
    ['safeMode', 10, 'already-protected'], ['safeModeAvailable', 0, 'unavailable'],
    ['safeModeCooldown', 10, 'cooldown'], ['upgradeBlocked', 10, 'upgrade-blocked']
  ] as const) {
    const original = state.controller![field];
    state.controller![field] = value;
    assert.equal(planSafety(state).reason, reason);
    state.controller![field] = original;
  }
  state.controller!.downgradeLimit = 40000;
  state.controller!.ticksToDowngrade = 14999;
  assert.equal(planSafety(state).reason, 'downgrade-blocked');
  state.controller!.ticksToDowngrade = 15000;
  assert.equal(planSafety(state).activateSafeMode, true);
  assert.equal(planSafety(state, false).reason, 'safe-mode-elsewhere');
  assert.equal(planSafety({ ...state, controller: undefined }).reason, 'no-controller');
});

test('safety API rejection or exception leaves labor running', () => {
  for (const activate of [() => ERR_NOT_ENOUGH_ENERGY, () => { throw new Error('safety failed'); }]) {
    const f = threatFixture();
    f.controller.activateSafeMode = activate;
    const colony = runColony(f.room);
    assert.equal(colony.safety.accepted, false);
    assert.equal(colony.executions.length, 5);
  }
});

test('kernel admits one safe-mode intent even when the first colony later fails', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = threatFixture();
  const room = { ...f.room, name: 'E26S47', controller: { ...f.controller, id: 'other-controller' } } as Room;
  const attempts: string[] = [];
  f.controller.activateSafeMode = () => { attempts.push('first'); return OK; };
  room.controller!.activateSafeMode = () => { attempts.push('second'); return OK; };
  (f.structures[0] as StructureSpawn).spawnCreep = (() => { throw new Error('later failure'); }) as StructureSpawn['spawnCreep'];
  const otherSpawn = { ...f.structures[0], spawnCreep: () => ERR_NOT_ENOUGH_ENERGY } as unknown as StructureSpawn;
  const find = room.find.bind(room);
  room.find = ((type: number) => type === FIND_STRUCTURES ? [otherSpawn] : find(type as FindConstant)) as typeof room.find;
  // Trigger population recovery in the first colony after safe-mode acceptance.
  f.workers.forEach((w) => { w.ticksToLive = 1; });
  Game.rooms = { [f.room.name]: f.room, [room.name]: room };
  runKernel();
  assert.deepEqual(attempts, ['first']);
  assert.equal(Memory.ops?.recentErrors[0].scope, 'colony');
  assert.equal(Memory.ops?.snapshot?.rooms[1].safety?.reason, 'safe-mode-elsewhere');
});

test('kernel respects active safe mode in another owned room', () => {
  const f = threatFixture();
  const protectedRoom = { ...f.room, name: 'E26S47',
    controller: { ...f.controller, safeMode: 100 } } as Room;
  Game.rooms = { [f.room.name]: f.room, [protectedRoom.name]: protectedRoom };
  runKernel();
  assert.equal(f.actions.includes('safe-mode'), false);
  assert.equal(Memory.ops?.snapshot?.rooms[0].safety?.reason, 'safe-mode-elsewhere');
});
