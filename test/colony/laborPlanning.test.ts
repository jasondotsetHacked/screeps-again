import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { planWork } from '../../src/colony/planWork';
import { scheduleWorkers } from '../../src/colony/scheduler';
import { runColony } from '../../src/colony/runColony';
import { runTowers } from '../../src/structures/runTowers';
import { publishOpsSnapshot, summarizeLabor } from '../../src/ops/opsTelemetry';
import type { WorkDemand } from '../../src/work/demands';

test('normalized observation shares population policy and gathers each input once', () => {
  const f = fixture();
  f.refill(); f.build(); f.repair();
  f.workers[0].spawning = true;
  f.workers[1].ticksToLive = 1;
  (Game.creeps as Record<string, unknown>).foreign = {
    name: 'foreign', memory: { kind: 'worker', home: 'E1N1' }
  };
  const state = observeColony(f.room);
  assert.equal(state.sources.length, 1);
  assert.equal(state.spawns.length, 1);
  assert.equal(state.refillTargets[0].freeEnergy, 50);
  assert.equal(state.buildTargets[0].remaining, 1000);
  assert.equal(state.repairTargets[0].missingHits, 1);
  assert.deepEqual(state.energy, { available: 300, capacity: 300 });
  assert.equal(state.controller?.downgradeLimit, 10000);
  assert.equal(state.workers.length, 4);
  assert.equal(state.workerCreeps.length, 5);
  assert.deepEqual(state.population, {
    liveWorkers: 4, spawningWorkers: 1, agingWorkers: 1, effectiveWorkers: 4, target: 3
  });
  const before = [...f.calls];
  const demands = planWork(state);
  scheduleWorkers(state, demands);
  assert.deepEqual([...f.calls], before);
  assert.ok([...f.calls.values()].every((count) => count === 1));
  assert.equal('colonyState' in Memory, false);
});

test('healthy, declining, dangerous and emergency buffers allocate increasing WORK service', () => {
  const policies = [10000, 7000, 4000, 2999].map((ticks) => {
    const f = fixture({ ticks, count: 5, work: 4 }); f.build();
    const state = observeColony(f.room);
    const demands = planWork(state);
    return { upgrade: demands.find((d) => d.kind === 'upgrade')!, assignments: scheduleWorkers(state, demands) };
  });
  assert.deepEqual(policies.map((p) => p.upgrade.desired), [4, 6, 9, 20]);
  assert.deepEqual(policies.map((p) => p.upgrade.minimum), [1, 1, 6, 20]);
  assert.ok(policies[2].upgrade.priority > policies[1].upgrade.priority);
  for (const p of policies.slice(0, 3)) {
    assert.ok(p.upgrade.maximum! < 20);
    assert.ok(p.assignments.some((a) => a.kind === 'build'));
    assert.ok(p.assignments.filter((a) => a.kind === 'upgrade').length < 5);
  }
  assert.equal(policies[3].assignments.filter((a) => a.kind === 'upgrade').length, 5);
});

test('observation normalizes readiness at empty/full boundaries before scheduling', () => {
  const full = fixture({ count: 1 });
  full.workers[0].memory.working = false;
  assert.equal(observeColony(full.room).workers[0].working, true);
  const empty = fixture({ count: 1, energy: 0 });
  empty.workers[0].memory.working = true;
  assert.equal(observeColony(empty.room).workers[0].working, false);
});

test('bands scale with RCL and strict emergency threshold stays independent of RCL', () => {
  for (const level of [1, 2, 3, 8]) {
    const f = fixture({ level });
    const state = observeColony(f.room);
    state.controller!.ticksToDowngrade = state.controller!.downgradeLimit;
    assert.equal(planWork(state).find((d) => d.kind === 'upgrade')?.desired, 1);
    state.controller!.ticksToDowngrade = 2999;
    assert.equal(planWork(state).find((d) => d.kind === 'upgrade')?.emergency, true);
  }
});

test('five workers execute mixed demands with healthy controller despite construction and roads', () => {
  const f = fixture();
  f.refill(); f.build('extension', STRUCTURE_EXTENSION, 5); f.repair(); f.build('road', STRUCTURE_ROAD, 5);
  const colony = runColony(f.room);
  assert.equal(new Set(colony.assignments.map((a) => a.creepName)).size, 5);
  assert.deepEqual(colony.assignments.map((a) => a.kind).sort(), ['build', 'build', 'refill', 'repair', 'upgrade']);
  assert.equal(f.actions.filter((a) => a.endsWith(':upgrade')).length, 1);
  assert.equal(f.actions.filter((a) => a.endsWith(':build')).length, 2);
  assert.equal(f.actions.filter((a) => a.endsWith(':repair')).length, 1);
  assert.equal(f.actions.filter((a) => a.endsWith(':refill')).length, 1);
  for (const type of [FIND_SOURCES, FIND_STRUCTURES, FIND_MY_CONSTRUCTION_SITES, FIND_MY_CREEPS, FIND_HOSTILE_CREEPS, FIND_DROPPED_RESOURCES]) {
    assert.equal(f.calls.get(type), 1);
  }
  const calls = [...f.calls];
  publishOpsSnapshot([f.room], 0, new Map([[f.room.name, colony]]));
  assert.deepEqual([...f.calls], calls);
  assert.equal(Memory.ops?.snapshot?.rooms[0].labor?.totalDemands, 5);
  assert.deepEqual(Memory.ops?.snapshot?.rooms[0].workerPopulation, {
    live: 5, spawning: 0, aging: 0, effective: 5, target: 3, replacementLead: 59
  });
  assert.ok(!JSON.stringify(Memory.ops?.snapshot?.rooms[0].labor).includes('targetId'));
});

function demand(id: string, overrides: Partial<WorkDemand> = {}): WorkDemand {
  return { id, kind: 'build', target: { id, pos: { x: 10, y: 10, roomName: 'E25S47' } },
    priority: 50, minimum: 0, desired: 1, capability: 'work', ...overrides };
}

test('urgency, hard maximum and whole-worker desired stop prevent duplicate or excessive assignments', () => {
  const state = observeColony(fixture().room);
  const demands = [demand('low', { priority: 1, desired: 20 }), demand('high', { priority: 99, desired: 1, maximum: 1 })];
  const assignments = scheduleWorkers(state, demands);
  assert.equal(assignments[0].demandId, 'high');
  assert.equal(assignments.filter((a) => a.demandId === 'high').length, 1);
  assert.equal(new Set(assignments.map((a) => a.creepName)).size, assignments.length);
  const oversized = { ...state.workers[0], work: 4 };
  assert.deepEqual(scheduleWorkers({ workers: [oversized] }, [demand('cap', { maximum: 3 })]), []);
  assert.equal(scheduleWorkers(state, [demand('small')]).length, 1);
});

test('capability, readiness, distance and name ties select sensible deterministic workers', () => {
  const state = observeColony(fixture({ count: 1 }).room);
  const base = state.workers[0];
  const workers = [
    { ...base, name: 'z', pos: { ...base.pos, x: 12 } },
    { ...base, name: 'a', pos: { ...base.pos, x: 12 } },
    { ...base, name: 'near-empty', energy: 0 },
    { ...base, name: 'no-work', work: 0 },
    { ...base, name: 'no-carry', carry: 0 },
    { ...base, name: 'oversized', work: 6 },
    { ...base, name: 'far', pos: { ...base.pos, x: 40 } }
  ];
  const demands = [demand('one')];
  const result = scheduleWorkers({ workers }, demands);
  assert.equal(result[0].creepName, 'a');
  assert.deepEqual(scheduleWorkers({ workers: [...workers].reverse() }, [...demands].reverse()), result);
  assert.equal(scheduleWorkers({ workers }, [demand('big', { desired: 6 })])[0].creepName, 'oversized');
});

test('minimum upgrade reservation precedes optional refill/build throughput', () => {
  const f = fixture(); f.refill('spawn', 1000); f.build();
  const state = observeColony(f.room);
  const assignments = scheduleWorkers(state, planWork(state));
  assert.equal(assignments.filter((a) => a.kind === 'upgrade').length, 1);
  assert.equal(assignments.filter((a) => a.kind === 'refill').length, 4);
});

test('one-worker recovery prioritizes spawn energy while emergency prioritizes controller', () => {
  const f = fixture({ count: 1 }); f.refill(); f.build();
  const state = observeColony(f.room);
  assert.equal(scheduleWorkers(state, planWork(state))[0].kind, 'refill');
  state.controller!.ticksToDowngrade = 2999;
  assert.equal(scheduleWorkers(state, planWork(state))[0].kind, 'upgrade');
});

test('labor telemetry measures unsatisfied demands separately and uses four bounded kinds', () => {
  const f = fixture({ count: 1 }); f.build(); f.refill();
  const state = observeColony(f.room);
  const demands = planWork(state);
  const assignments = scheduleWorkers(state, demands);
  const summary = summarizeLabor({ demands, assignments, executions: [] });
  assert.equal(summary.kinds.length, 4);
  assert.equal(summary.kinds.find((k) => k.kind === 'upgrade')?.unsatisfiedMinimum, 1);
  assert.equal(summary.kinds.find((k) => k.kind === 'refill')?.workers, 1);
});

test('long-lived construction and road demands leave healthy controller service and productive builders', () => {
  const f = fixture(); f.build(); f.build('road', STRUCTURE_ROAD);
  const colony = runColony(f.room);
  assert.equal(colony.assignments.filter((a) => a.kind === 'upgrade').length, 1);
  assert.equal(colony.assignments.filter((a) => a.kind === 'build').length, 4);
  assert.equal(f.actions.length, 5);
});

test('mixed worker bodies leave normal upgrade room for other labor and unavailable capabilities are excluded', () => {
  const f = fixture({ count: 3 }); f.build();
  const state = observeColony(f.room);
  const workers = state.workers.map((worker, index) => ({ ...worker, work: [6, 2, 1][index] }));
  const normalized = { ...state, workers };
  const assignments = scheduleWorkers(normalized, planWork(normalized));
  assert.ok(assignments.some((a) => a.kind === 'upgrade'));
  assert.ok(assignments.some((a) => a.kind === 'build'));
  assert.ok(assignments.filter((a) => a.kind === 'upgrade').length < workers.length);
  const immobile = { ...workers[0], move: 0, energy: 0 };
  assert.deepEqual(scheduleWorkers({ workers: [immobile] }, [demand('build')]), []);
  const stationary = { ...immobile, energy: 50, working: true };
  assert.equal(scheduleWorkers({ workers: [stationary] }, [demand('build')]).length, 1);
});


test('observation preserves asymmetric WORK, CARRY and MOVE capability', () => {
  const f = fixture({ count: 1, work: 4, carry: 2, move: 1 });
  const state = observeColony(f.room);
  assert.deepEqual(
    {
      work: state.workers[0].work,
      carry: state.workers[0].carry,
      move: state.workers[0].move
    },
    { work: 4, carry: 2, move: 1 }
  );

  const buildAssignment = scheduleWorkers(
    state,
    [demand('asymmetric-build', { desired: 4, maximum: 4 })]
  )[0];
  assert.equal(buildAssignment.contribution, 4);

  const refillAssignment = scheduleWorkers(
    state,
    [
      demand('asymmetric-refill', {
        kind: 'refill',
        capability: 'carry',
        desired: 2,
        maximum: 2
      })
    ]
  )[0];
  assert.equal(refillAssignment.contribution, 2);
});

test('otherwise-idle healthy workers become explicit low-priority controller surplus', () => {
  const f = fixture({ count: 5 });
  const state = observeColony(f.room);
  const demands = planWork(state);
  const upgrade = demands.find((entry) => entry.kind === 'upgrade')!;

  assert.equal(upgrade.desired, 1);
  assert.equal(upgrade.maximum, 1);
  assert.equal(upgrade.surplusPriority, 1);
  assert.equal(upgrade.surplusMaximum, 5);

  const assignments = scheduleWorkers(state, demands);
  assert.equal(assignments.length, 5);
  assert.ok(assignments.every((assignment) => assignment.kind === 'upgrade'));
});

test('surplus controller service waits until bounded colony work has had its chance', () => {
  const f = fixture({ count: 5 });
  f.build();
  f.build('road', STRUCTURE_ROAD);
  const state = observeColony(f.room);
  const assignments = scheduleWorkers(state, planWork(state));

  assert.equal(
    assignments.filter((assignment) => assignment.kind === 'build').length,
    4
  );
  assert.equal(
    assignments.filter((assignment) => assignment.kind === 'upgrade').length,
    1
  );
});

test('normalized spawning representations are deduplicated and never scheduled as live labor', () => {
  const f = fixture({ count: 2 });
  const spawn = f.refill();
  Object.assign(spawn, { spawning: { name: 'w1' } });
  // A live-looking Game representation is still spawning according to the spawn.
  f.workers[1].spawning = false;
  Memory.creeps.w1 = { kind: 'worker', home: f.room.name };
  const state = observeColony(f.room);
  assert.equal(state.population.liveWorkers, 1);
  assert.equal(state.population.spawningWorkers, 1);
  assert.equal(state.population.effectiveWorkers, 2);
  assert.deepEqual(state.workers.map((w) => w.name), ['w0']);
  assert.ok(scheduleWorkers(state, planWork(state)).every((a) => a.creepName === 'w0'));
});

test('worker execution failure is isolated and recorded while other assignments continue', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture({ ticks: 2999 });
  f.workers[0].upgradeController = () => { throw new Error('action failed'); };
  const colony = runColony(f.room);
  assert.equal(colony.assignments.length, 5);
  assert.equal(f.actions.filter((a) => a.endsWith(':upgrade')).length, 4);
  assert.equal(Memory.ops?.recentErrors[0].scope, 'creep');
  assert.equal(Memory.ops?.recentErrors[0].subject, 'w0');
});

test('tower attack, healing and emergency repairs remain outside the labor scheduler', () => {
  const f = fixture();
  const target = f.refill('tower', 0, STRUCTURE_TOWER);
  Object.assign(target, {
    store: { getUsedCapacity: () => 1000, getFreeCapacity: () => 0, getCapacity: () => 1000 },
    attack: () => { f.actions.push('tower:attack'); return OK; },
    heal: () => { f.actions.push('tower:heal'); return OK; },
    repair: () => { f.actions.push('tower:repair'); return OK; }
  });
  f.hostiles.push(f.workers[0]);
  f.workers[1].hits = 50;
  f.repair().hits = 10;
  runTowers(observeColony(f.room));
  assert.deepEqual(f.actions, ['tower:attack']);
  f.hostiles.length = 0;
  runTowers(observeColony(f.room));
  assert.equal(f.actions[1], 'tower:heal');
  f.workers[1].hits = f.workers[1].hitsMax;
  runTowers(observeColony(f.room));
  assert.equal(f.actions[2], 'tower:repair');
  Object.assign(target, { store: { getUsedCapacity: () => 499, getFreeCapacity: () => 501 } });
  runTowers(observeColony(f.room));
  assert.equal(f.actions.length, 3);
});
