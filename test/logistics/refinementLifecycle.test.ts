import assert from 'node:assert/strict';
import test from 'node:test';
import { simulation } from '../helpers/simulation';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { creepName } from '../../src/creeps/identity';
import { observeColony } from '../../src/colony/colonyState';
import { observeSourceOperations } from '../../src/operations/observeSources';

function economy() {
  logisticsFixture();
  const f = simulation({ count: 4, work: 1, carry: 2, move: 2, energy: 0 });
  f.room.getTerrain = (() => ({ get: () => 0 })) as unknown as Room['getTerrain'];
  f.room.energyAvailable = 800; f.room.energyCapacityAvailable = 800;
  f.source.pos = position(10, 10); f.controller.pos = position(15, 14);
  const spawn = f.refill('spawn'); spawn.pos = position(15, 10); f.store(spawn, 800, 800);
  const buffer = f.repair('source-buffer'); buffer.pos = position(11, 10); f.store(buffer, 0, 2000);
  const controllerBuffer = f.repair('controller-buffer'); controllerBuffer.pos = position(13, 12); f.store(controllerBuffer, 500, 2000);
  const storage = f.refill('storage', 0, STRUCTURE_STORAGE); storage.pos = position(15, 12); f.store(storage, 0, 1_000_000);
  for (const s of [buffer, controllerBuffer]) Object.assign(s, { hits: 2000, hitsMax: 2000 });
  f.room.lookForAt = ((kind: string, x: number, y: number) =>
    (kind === LOOK_STRUCTURES ? f.structures : f.sites).filter((s) => s.pos.x === x && s.pos.y === y)) as Room['lookForAt'];
  // Existing infrastructure is sufficient here; prevent incidental site changes
  // from introducing new labor into these focused flow scenarios.
  f.room.createConstructionSite = (() => ERR_INVALID_TARGET) as Room['createConstructionSite'];
  const operation = observeSourceOperations(observeColony(f.room))[0];
  function add(kind: 'miner' | 'hauler', body: BodyPartConstant[]) {
    const identity = { kind, home: f.room.name, operationId: operation.id };
    const c = { ...f.workers[0], name: creepName(identity, kind), memory: identity, spawning: false,
      getActiveBodyparts: (part: BodyPartConstant) => body.filter((p) => p === part).length } as Creep;
    Game.creeps[c.name] = c; f.workers.push(c); Memory.creeps[c.name] = c.memory; f.attachCreep(c, 0); return c;
  }
  const miner = add('miner', operation.minerBody), hauler = add('hauler', [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]);
  miner.pos = buffer.pos; hauler.pos = position(15, 10);
  const withdrawals: { name: string; target: string; amount: number }[] = [];
  const deliveries: { target: string; amount: number }[] = [];
  for (const c of f.workers) {
    const withdraw = c.withdraw;
    c.withdraw = ((target, resource, amount) => {
      const result = withdraw.call(c, target, resource, amount);
      if (result === OK) withdrawals.push({ name: c.name, target: target.id, amount: amount! });
      return result;
    }) as Creep['withdraw'];
  }
  const transfer = hauler.transfer;
  hauler.transfer = ((target, resource, amount) => {
    const result = transfer.call(hauler, target, resource, amount);
    if (result === OK) deliveries.push({ target: target.id, amount: amount! });
    return result;
  }) as Creep['transfer'];
  return { ...f, spawn, buffer, controllerBuffer, storage, miner, hauler, withdrawals, deliveries };
}

test('small miner deposits feed approaching hauler batches instead of a nearby worker; hauler loss restores access', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy(); const worker = f.workers[0]; worker.pos = f.buffer.pos;
  for (let tick = 0; tick < 40; tick++) f.tick();
  assert.ok(f.withdrawals.some((w) => w.name === f.hauler.name && w.target === f.buffer.id && w.amount < 50));
  assert.equal(f.withdrawals.some((w) => w.name !== f.hauler.name && w.target === f.buffer.id), false);
  assert.ok(f.withdrawals.some((w) => w.name === worker.name && w.target === f.controllerBuffer.id));
  assert.ok(f.deliveries.length > 0); assert.ok(f.deliveries[0].amount >= 200);
  assert.ok(f.controller.progress > 0);
  delete Game.creeps[f.hauler.name]; f.workers.splice(f.workers.indexOf(f.hauler), 1);
  f.setEnergy(worker, 0); worker.pos = f.buffer.pos; f.setEnergy(f.buffer, 100);
  f.tick();
  assert.ok(f.withdrawals.some((w) => w.name === worker.name && w.target === f.buffer.id));
});

test('full refill pools send a loaded hauler through controller reserve to storage, retaining delivery intent after partial drop', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = economy();
  for (const worker of f.workers.filter((c) => c.memory.kind === 'worker')) f.setEnergy(worker, 100);
  f.setEnergy(f.controllerBuffer, 480); f.setEnergy(f.hauler, 200); f.hauler.pos = position(14, 12);
  f.tick();
  assert.deepEqual(f.deliveries, [{ target: f.controllerBuffer.id, amount: 20 }]);
  assert.equal(f.amount(f.controllerBuffer), 500); assert.equal(f.hauler.memory.delivering, true);
  f.tick();
  assert.deepEqual(f.deliveries[1], { target: f.storage.id, amount: 180 });
  assert.equal(f.amount(f.storage), 180); assert.equal(f.amount(f.hauler), 0);
  f.tick(); assert.equal(f.hauler.memory.delivering, false);
});
