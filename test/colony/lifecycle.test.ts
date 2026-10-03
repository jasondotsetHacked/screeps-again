import assert from 'node:assert/strict';
import test from 'node:test';
import { simulation } from '../helpers/simulation';
import { position } from '../helpers/colony';

test('multi-tick energy and travel cycles keep construction progressing and controller protected', () => {
  const f = simulation({ count: 5, energy: 0, ticks: 8000 });
  const site = f.build('long-build', STRUCTURE_EXTENSION, 100000);
  const road = f.build('long-road', STRUCTURE_ROAD, 100000);
  f.source.pos = position(10, 10);
  f.controller.pos = position(18, 10);
  site.pos = position(10, 18);
  road.pos = position(18, 18);
  let minBuffer = f.controller.ticksToDowngrade;
  let acquiring = 0;
  let traveling = 0;
  for (let tick = 0; tick < 400; tick += 1) {
    const colony = f.tick();
    assert.equal(colony.demands.some((d) => d.emergency), false);
    acquiring += colony.executions.filter((e) => e.phase === 'acquire').length;
    traveling += colony.executions.filter((e) => e.phase === 'travel').length;
    minBuffer = Math.min(minBuffer, f.controller.ticksToDowngrade);
  }
  assert.ok(acquiring > 50 && traveling > 50);
  assert.ok(f.fulfilled.upgrade > 50);
  assert.ok(f.fulfilled.build > 100);
  assert.ok(site.progress > 100 && road.progress > 100);
  assert.ok(f.controller.progress > 50);
  assert.ok(minBuffer >= 7800);
  assert.ok(f.controller.ticksToDowngrade >= 8000);
});

test('multi-tick source depletion regenerates and workers resume their assignments', () => {
  const f = simulation({ count: 1, energy: 0, ticks: 7000 });
  f.source.pos = position(10, 10);
  f.controller.pos = position(12, 10);
  f.source.energy = 4;
  f.source.ticksToRegeneration = 5;
  let sawBlocked = false;
  for (let tick = 0; tick < 120; tick += 1) {
    const colony = f.tick();
    sawBlocked ||= colony.executions.some((e) => e.phase === 'blocked');
  }
  assert.ok(sawBlocked);
  assert.equal(f.regenerated(), 1);
  assert.ok(f.fulfilled.harvest > 2);
  assert.ok(f.fulfilled.upgrade > 10);
  assert.ok(f.controller.progress > 10);
});

test('multi-tick recovered energy supports emergency service before depleted sources regenerate', () => {
  const f = simulation({ count: 1, energy: 0, ticks: 2900 });
  f.source.energy = 0;
  f.source.ticksToRegeneration = 300;
  f.controller.pos = position(12, 10);
  const recovered = { id: 'recovered', pos: position(11, 10) } as Tombstone;
  f.store(recovered, 100, 100);
  f.tombstones.push(recovered);
  for (let tick = 0; tick < 20; tick += 1) f.tick();
  assert.equal(f.fulfilled.withdraw, 1);
  assert.equal(f.fulfilled.harvest, 0);
  assert.ok(f.fulfilled.upgrade > 10);
  assert.ok(f.controller.ticksToDowngrade > 3000);
});

test('multi-tick completed construction leaves no stale assignment and new sites receive work', () => {
  const f = simulation({ count: 3 });
  f.controller.pos = position(12, 10);
  const first = f.build('first', STRUCTURE_EXTENSION, 5);
  first.pos = position(10, 11);
  f.tick();
  assert.equal(first.progress, 5);
  assert.equal(f.sites.includes(first), false);
  const second = f.build('second', STRUCTURE_CONTAINER, 100);
  second.pos = position(10, 11);
  const colony = f.tick();
  assert.ok(colony.assignments.some((a) => a.targetId === second.id));
  assert.ok(colony.assignments.every((a) => a.targetId !== first.id));
  assert.ok(second.progress > 0);
  assert.ok(f.controller.progress > 0);
});
