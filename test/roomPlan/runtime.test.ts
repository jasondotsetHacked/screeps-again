import assert from 'node:assert/strict';
import test from 'node:test';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { runConstruction, ensureLayoutSite } from '../../src/construction/runConstruction';
import { committedRoomPlan, ensureRoomPlan, replanRoom } from '../../src/construction/roomPlanRuntime';
import { renderRoomPlan } from '../../src/construction/roomPlanVisual';
import { observeSourceOperations } from '../../src/operations/observeSources';
import { observeColony } from '../../src/colony/colonyState';
import { structureLimits } from '../../shared/roomPlan/limits';

function fixture() {
  const f = logisticsFixture(); f.secondSource();
  const placed: { x: number; y: number; type: string }[] = [];
  for (const [type, values] of Object.entries(structureLimits)) (CONTROLLER_STRUCTURES as unknown as Record<string, Record<number, number>>)[type] =
    Object.fromEntries(values.map((value, rcl) => [rcl, value]));
  f.room.createConstructionSite = ((x: number, y: number, type: BuildableStructureConstant) => {
    const plan = committedRoomPlan(f.room.name)!;
    assert.ok(plan.structures.some((s) => s.type === type && s.x === x && s.y === y), 'Every live site must match committed intent');
    assert.ok(!f.sites.some((s) => s.pos.x === x && s.pos.y === y));
    assert.ok(!f.structures.some((s) => s.pos.x === x && s.pos.y === y &&
      !(s.structureType === STRUCTURE_CONTAINER && type === STRUCTURE_ROAD)));
    placed.push({ x, y, type }); f.build(`site:${placed.length}`, type).pos = position(x, y); return OK;
  }) as Room['createConstructionSite'];
  const complete = () => { for (const s of f.sites.splice(0)) f.structures.push({ ...s, my: true,
    hits: 1000, hitsMax: 1000, isActive: () => true,
    store: { getUsedCapacity: () => 0, getFreeCapacity: () => 300, getCapacity: () => 300 }
  } as unknown as Structure); };
  return { ...f, placed, complete };
}
test('live RCL2..8 construction uses one committed plan, preserves future space and respects site budget', () => {
  const f = fixture();
  let identity = '';
  for (let rcl = 2; rcl <= 8; rcl++) {
    f.controller.level = rcl;
    for (let pass = 1; pass <= 70; pass++) {
      Game.time = pass * 100;
      const before = f.placed.length;
      runConstruction(f.room, observeSourceOperations(observeColony(f.room)));
      assert.ok(f.placed.length - before <= 4);
      const p = committedRoomPlan(f.room.name)!;
      identity ||= p.id; assert.equal(p.id, identity);
      for (const site of f.placed.filter((s) => s.type === 'extension')) assert.ok(!p.reservations.some((r) => r.x === site.x && r.y === site.y));
      f.complete();
    }
  }
  for (const [type, count] of Object.entries({ extension: 60, storage: 1, terminal: 1, factory: 1, spawn: 3, tower: 6, link: 4, container: 3 }))
    assert.equal(f.structures.filter((s) => s.structureType === type).length, count, type);
  assert.ok(f.placed.some((s) => s.type === 'road'));
});
test('plan survives JSON Memory/global reload, missing assets and changing RCL without re-layout', () => {
  const f = fixture(), p = ensureRoomPlan(f.room, f.spawn)!;
  const bytes = JSON.stringify(p);
  Object.assign(globalThis, { Memory: JSON.parse(JSON.stringify(Memory)) });
  f.structures.splice(f.structures.indexOf(f.buffer), 1); f.controller.level = 8;
  const beforeFinds = [...f.calls];
  assert.equal(JSON.stringify(ensureRoomPlan(f.room, f.spawn)), bytes);
  assert.deepEqual([...f.calls], beforeFinds, 'Persisted intent does not rescan/replan each construction interval');
  const ops = observeSourceOperations(observeColony(f.room));
  assert.deepEqual([ops[0].tile!.x, ops[0].tile!.y], [p.sources[0].miner.x, p.sources[0].miner.y]);
});
test('unplanned important asset blocks new storage without destroy, unsafe site conflicts remain reported', () => {
  const f = fixture(), p = ensureRoomPlan(f.room, f.spawn)!;
  const original = JSON.stringify(p);
  const storage = f.refill('legacy-storage', 0, STRUCTURE_STORAGE); storage.pos = position(43, 43);
  Object.assign(storage, { destroy: () => { throw new Error('RoomPlan must never demolish'); } });
  const conflict = f.build('manual-site', STRUCTURE_TOWER); conflict.pos = position(p.core!.storage.x, p.core!.storage.y);
  Object.assign(conflict, { remove: () => { throw new Error('Site removal requires a specific safe policy'); } });
  f.controller.level = 4; Game.time = 100; runConstruction(f.room);
  assert.ok(!f.placed.some((s) => s.type === 'storage'));
  assert.equal(JSON.stringify(committedRoomPlan(f.room.name)), original);
  assert.equal(ensureLayoutSite(f.room, position(12, 12), STRUCTURE_STORAGE), 0);
});
test('unsupported version and changed Spawn1 pause construction; explicit preview does not commit', () => {
  const f = fixture(), p = ensureRoomPlan(f.room, f.spawn)!;
  Game.time = 100; f.controller.level = 8;
  (p as unknown as { version: number }).version = 2;
  runConstruction(f.room); assert.equal(f.placed.length, 0);
  p.version = 1; f.spawn.pos = position(12, 11);
  runConstruction(f.room); assert.equal(f.placed.length, 0);
  const preview = replanRoom(f.room.name);
  assert.notEqual(preview.id, p.id); assert.equal(committedRoomPlan(f.room.name)!.id, p.id);
  assert.equal(replanRoom(f.room.name, true).id, committedRoomPlan(f.room.name)!.id);
});
test('blocked committed source tile suspends source operation instead of choosing a competing position', () => {
  const f = fixture(), p = ensureRoomPlan(f.room, f.spawn)!;
  f.structures.push({ id: 'block', structureType: STRUCTURE_WALL, pos: position(p.sources[0].miner.x, p.sources[0].miner.y) } as StructureWall);
  const ops = observeSourceOperations(observeColony(f.room));
  assert.equal(ops[0].tile, undefined); assert.equal(ops[0].enabled, false);
  assert.equal(committedRoomPlan(f.room.name)!.id, p.id);
});
test('low CPU reserve defers first planning while preserving an already committed plan', () => {
  const f = fixture();
  Object.assign(Game, { cpu: { bucket: 2000 } }); Game.time = 25;
  runConstruction(f.room); assert.equal(committedRoomPlan(f.room.name), undefined); assert.equal(f.placed.length, 0);
  Game.cpu.bucket = 5000;
  const p = ensureRoomPlan(f.room, f.spawn)!; assert.ok(p);
  Game.cpu.bucket = 0;
  assert.equal(ensureRoomPlan(f.room, f.spawn), p);
});
test('future RoomVisual distinguishes core manager roads extensions source controller and reserved labs', () => {
  const f = fixture(), p = ensureRoomPlan(f.room, f.spawn)!;
  const text: string[] = [], circles: number[] = [], rectangles: number[] = [];
  const visual = { text: (s: string) => { text.push(s); }, circle: (_x: number, _y: number, style: { radius: number }) => { circles.push(style.radius); },
    rect: (_x: number, _y: number, width: number) => { rectangles.push(width); }, line: () => {} } as unknown as RoomVisual;
  renderRoomPlan(visual, p);
  for (const label of ['M', 'S', 'T', 'F', 'L', 'E', 'SP', 'TW', 'C', 'MIN', 'U', 'LAB']) assert.ok(text.includes(label), label);
  assert.ok(circles.includes(0.12)); assert.ok(rectangles.length >= 10);
  f.room.visual = visual; Memory.roomPlanVisuals = { [f.room.name]: true }; Game.time = 1;
  runConstruction(f.room); assert.equal(f.placed.length, 0);
});
