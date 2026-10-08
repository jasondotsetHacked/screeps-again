import assert from 'node:assert/strict';
import test from 'node:test';
import { planRoom } from '../../shared/roomPlan/planRoom';
import { readRoomPlan, storeRoomPlan } from '../../shared/roomPlan/intent';
import { reconcilePlan } from '../../shared/roomPlan/reconcile';
import { limitsAt } from '../../shared/roomPlan/limits';
import { roomFacts } from './fixtures';

for (const kind of ['open', 'swamp', 'all-swamp', 'walls', 'controller', 'sources', 'brownfield']) {
  test(`${kind}: compact intent preserves geometry, scheduling and identity through JSON reload`, () => {
    const facts = roomFacts(kind), full = planRoom(facts).roomPlan;
    const { assets: _assets, routes: _routes, ...intent } = full;
    const stored = storeRoomPlan(full);
    const bytes = Buffer.byteLength(JSON.stringify(stored));
    assert.ok(bytes < 8192, `Persisted intent exceeds 8 KiB regression budget: ${bytes}`);
    assert.ok(bytes < Buffer.byteLength(JSON.stringify(full)) / 4, 'At least 75% smaller than the full debug result');
    assert.deepEqual(Object.keys(stored).sort(), ['storageVersion', 'version', 'algorithm', 'id', 'anchorId', 'roomName', 'spawn1',
      'moduleIds', 'structures', 'roads', 'reservations', 'modules', 'core', 'sources', 'controller', 'score', 'feasibility', 'warnings'].sort());
    assert.ok(stored.structures.every(Array.isArray)); assert.ok(stored.reservations.every(Array.isArray));
    assert.equal(new Set(stored.roads).size, stored.roads.length);
    assert.equal(stored.roads.length, full.structures.filter((s) => s.type === 'road').length);
    assert.ok(!('assets' in stored) && !('routes' in stored) && !('terrain' in stored));
    const restored = readRoomPlan(JSON.parse(JSON.stringify(stored)));
    assert.deepEqual(restored, intent);
    assert.equal(JSON.stringify(storeRoomPlan(restored)), JSON.stringify(stored), 'Canonical codec round trip');
    for (let rcl = 1; rcl <= 8; rcl++) assert.deepEqual(
      reconcilePlan(restored, facts.assets, rcl, limitsAt(rcl)), reconcilePlan(full, facts.assets, rcl, limitsAt(rcl)));
  });
}
test('debug observations and duplicate logical traces cannot balloon persisted intent or leak into it', () => {
  const full = planRoom(roomFacts()).roomPlan;
  const expected = JSON.stringify(storeRoomPlan(full));
  const inflated = { ...full, assets: Array(1000).fill(full.assets[0]), routes: Array(1000).fill(full.routes[0]) };
  assert.equal(JSON.stringify(storeRoomPlan(inflated)), expected);
  const detached = storeRoomPlan(full), before = JSON.stringify(detached);
  full.core!.manager.x++; full.sources[0].miner.x++;
  assert.equal(JSON.stringify(detached), before, 'Stored intent must be detached from mutable preview data');
});
test('store and reconcile reject partial plans even when early structures are individually legal', () => {
  const full = planRoom(roomFacts()).roomPlan;
  for (const reason of ['labs:no-module-space', 'extensions:insufficient-space', 'core:no-safe-module', 'road:controller:unreachable']) {
    const partial = { ...full, feasibility: { complete: false, reasons: [reason] } };
    assert.throws(() => storeRoomPlan(partial), /incomplete/);
    assert.deepEqual(reconcilePlan(partial, [], 4, limitsAt(4)).missing, []);
  }
  assert.throws(() => storeRoomPlan({ ...full, feasibility: { complete: true, reasons: ['road:controller:unreachable'] } }), /incomplete/);
});
test('codec rejects unknown versions and malformed coordinate/metadata encodings', () => {
  const stored = storeRoomPlan(planRoom(roomFacts()).roomPlan);
  const corrupt = (mutate: (copy: typeof stored) => void) => { const copy = structuredClone(stored); mutate(copy); assert.throws(() => readRoomPlan(copy)); };
  corrupt((p) => { (p as unknown as { storageVersion: number }).storageVersion = 2; });
  corrupt((p) => { p.feasibility.complete = false; });
  corrupt((p) => { p.roads.push(p.roads[0]); });
  corrupt((p) => { p.structures[0][0] = -1; });
  corrupt((p) => { p.structures[0][1] = 100; });
  corrupt((p) => { p.structures[0][3] = 9; });
  corrupt((p) => { p.reservations[0][2] = 100; });
});
