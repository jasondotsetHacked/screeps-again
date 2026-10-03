import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { planWork } from '../../src/colony/planWork';
import { scheduleWorkers } from '../../src/colony/scheduler';
import { runWorker, workerEnergyContext } from '../../src/creeps/runWorker';
import { isControllerUrgent } from '../../src/colony/controllerUrgency';

test('controller urgency retains the strict 3000-tick owned-controller threshold', () => {
  assert.equal(isControllerUrgent({ my: true, ticksToDowngrade: 2999 }), true);
  assert.equal(isControllerUrgent({ my: true, ticksToDowngrade: 3000 }), false);
  assert.equal(isControllerUrgent({ my: false, ticksToDowngrade: 1 }), false);
  assert.equal(isControllerUrgent(undefined), false);
});

for (const kind of ['refill', 'build', 'repair', 'upgrade'] as const) {
  for (const energy of [0, 50]) {
    test(`${kind} assignment with ${energy} energy ${energy ? 'executes' : 'acquires energy before visiting work target'}`, () => {
      const f = fixture({ count: 1, energy });
      if (kind === 'refill') f.refill();
      if (kind === 'build') f.build();
      if (kind === 'repair') f.repair();
      const state = observeColony(f.room);
      const demand = planWork(state).find((d) => d.kind === kind)!;
      const assignment = scheduleWorkers(state, [demand])[0];
      assert.ok(assignment);
      runWorker(f.workers[0], assignment, workerEnergyContext(state));
      assert.deepEqual(f.actions, [`w0:${energy ? kind : 'harvest'}`]);
      if (!energy) assert.equal(f.workers[0].memory.working, false);
    });
  }
}

test('empty assigned worker moves toward energy, never the controller', () => {
  const f = fixture({ count: 1, energy: 0 });
  f.workers[0].harvest = () => ERR_NOT_IN_RANGE;
  const state = observeColony(f.room);
  runWorker(f.workers[0], scheduleWorkers(state, planWork(state))[0], workerEnergyContext(state));
  assert.deepEqual(f.actions, ['w0:move:source-a']);
});

test('normal acquisition retains fill/use hysteresis and nearby dropped energy pickup', () => {
  const f = fixture({ count: 1, energy: 20 });
  f.workers[0].memory.working = false;
  f.drops.push({ id: 'drop', pos: position(11, 10), amount: 20, resourceType: RESOURCE_ENERGY } as Resource);
  const state = observeColony(f.room);
  runWorker(f.workers[0], scheduleWorkers(state, planWork(state))[0], workerEnergyContext(state));
  assert.deepEqual(f.actions, ['w0:pickup']);
});

test('source allocation balances new workers and reuses existing source memory', () => {
  const f = fixture({ count: 3, energy: 0 });
  const state = observeColony(f.room);
  const second = { id: 'source-b', pos: position(7, 7), energy: 3000 } as Source;
  const getObject = Game.getObjectById;
  Game.getObjectById = ((id: string) => id === second.id ? second : getObject(id as Id<Source>)) as typeof Game.getObjectById;
  const energy = workerEnergyContext({ ...state, energySupplies: [...state.energySupplies,
    { id: second.id, pos: second.pos, kind: 'harvest', amount: second.energy }] });
  for (const worker of f.workers) runWorker(worker, undefined, energy);
  assert.deepEqual(f.workers.map((w) => w.memory.sourceId), ['source-b', 'source-a', 'source-b']);
  runWorker(f.workers[0], undefined, energy);
  assert.equal(f.workers[0].memory.sourceId, 'source-b');
});

test('emergency assignment beats other demand, uses partial energy, and travels to controller', () => {
  const f = fixture({ ticks: 2999, energy: 10 });
  f.refill(); f.build(); f.build('road', STRUCTURE_ROAD); f.repair();
  const state = observeColony(f.room);
  const assignments = scheduleWorkers(state, planWork(state));
  assert.equal(assignments.length, 5);
  assert.ok(assignments.every((a) => a.kind === 'upgrade' && a.emergency));
  f.workers[0].memory.working = false;
  f.workers[0].upgradeController = () => ERR_NOT_IN_RANGE;
  const byName = new Map(assignments.map((a) => [a.creepName, a]));
  const energy = workerEnergyContext(state);
  for (const worker of f.workers) runWorker(worker, byName.get(worker.name), energy);
  assert.ok(f.actions.includes('w0:move:controller'));
  assert.equal(f.actions.filter((a) => a.endsWith(':upgrade')).length, 4);
  assert.equal(f.actions.some((a) => /refill|build|repair|harvest/.test(a)), false);
});

test('stale target and spawning worker are harmless; executor never searches for another task', () => {
  const f = fixture({ count: 1 });
  const state = observeColony(f.room);
  const assignment = scheduleWorkers(state, planWork(state))[0];
  assignment.targetId = 'gone';
  runWorker(f.workers[0], assignment, workerEnergyContext(state));
  f.workers[0].spawning = true;
  runWorker(f.workers[0], assignment, workerEnergyContext(state));
  assert.deepEqual(f.actions, []);
});
