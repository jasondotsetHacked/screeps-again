import assert from 'node:assert/strict';
import test from 'node:test';
import { logisticsFixture } from '../helpers/logistics';
import { position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { observeSourceOperations, chooseSourceTiles } from '../../src/operations/observeSources';
import { haulingRequirement, minerBody, haulerBody, requestSourcePopulation,
  specialistLead, selectSourceTile, planSourceOperation } from '../../src/operations/sourceOperation';
import { bodyCost } from '../../src/spawning/body';
import { ensureSourceContainers } from '../../src/construction/runConstruction';
import { countPopulation } from '../../src/spawning/population';
import { planSpawn } from '../../src/spawning/spawnPlan';
import { requestWorkerPopulation } from '../../src/spawning/workerPlan';

function operations(f: ReturnType<typeof logisticsFixture>) { return observeSourceOperations(observeColony(f.room)); }

test('one deterministic operation per source, independent of source iteration order', () => {
  const f = logisticsFixture(); const second = f.secondSource();
  const state = observeColony(f.room);
  const a = observeSourceOperations(state);
  const b = observeSourceOperations({ ...state, sources: [...state.sources].reverse() });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((o) => o.id), ['source:source-a', 'source:source-b']);
  assert.equal(a[1].source.id, second.id);
});

test('deterministic adjacent tile prefers built buffer, then site, then distance and coordinates', () => {
  logisticsFixture();
  const tiles = [5, 6, 7].map((x) => ({ ...position(x, 6), walkable: true, placeable: true }));
  assert.equal(selectSourceTile(tiles, position(10, 6))?.x, 7);
  assert.equal(selectSourceTile([...tiles].reverse(), position(10, 6))?.x, 7);
  const site = { ...tiles[0], siteId: 'site', placeable: false };
  const buffer = { ...tiles[1], containerId: 'buffer', placeable: false };
  assert.equal(selectSourceTile([...tiles, site, buffer], position(10, 10)), buffer);
  assert.equal(selectSourceTile([...tiles, site], position(10, 10)), site);
  assert.equal(selectSourceTile([{ ...buffer, walkable: false }], position()), undefined);
});

test('existing adjacent container is adopted as both mining position and buffer', () => {
  const f = logisticsFixture(); f.buffer.pos = position(4, 4);
  const o = operations(f)[0];
  assert.equal(o.bufferId, f.buffer.id);
  assert.deepEqual([o.tile?.x, o.tile?.y], [4, 4]);
  assert.equal(o.ready, true); assert.equal(o.enabled, true); assert.equal(o.income, 10);
});

test('construction never duplicates a built or site buffer, including unusable buffers', () => {
  const f = logisticsFixture(); const placements: number[][] = [];
  f.room.createConstructionSite = ((x: number, y: number) => { placements.push([x, y]); return OK; }) as unknown as Room['createConstructionSite'];
  assert.equal(ensureSourceContainers(f.room, f.spawn, 4), 0);
  const site = f.build('buffer-site', STRUCTURE_CONTAINER); site.pos = f.buffer.pos;
  f.structures.splice(f.structures.indexOf(f.buffer), 1);
  assert.equal(ensureSourceContainers(f.room, f.spawn, 4), 0);
  f.room.getTerrain = (() => ({ get: () => TERRAIN_MASK_WALL })) as unknown as Room['getTerrain'];
  assert.equal(ensureSourceContainers(f.room, f.spawn, 4), 0);
  assert.deepEqual(placements, []);
});

test('new construction places exactly the shared planned mining tile', () => {
  const f = logisticsFixture(); f.structures.splice(f.structures.indexOf(f.buffer), 1);
  const ops = operations(f); const placements: number[][] = [];
  f.room.createConstructionSite = ((x: number, y: number, type: StructureConstant) => {
    assert.equal(type, STRUCTURE_CONTAINER); placements.push([x, y]); return OK;
  }) as Room['createConstructionSite'];
  assert.equal(ensureSourceContainers(f.room, f.spawn, 4, ops), 1);
  assert.deepEqual(placements, [[ops[0].tile!.x, ops[0].tile!.y]]);
});

test('container site is recognized but remains generalist fallback', () => {
  const f = logisticsFixture(); f.structures.splice(f.structures.indexOf(f.buffer), 1);
  const site = f.build('buffer-site', STRUCTURE_CONTAINER); site.pos = position(4, 4);
  const o = operations(f)[0];
  assert.equal(o.tile?.siteId, site.id); assert.equal(o.reason, 'no-buffer');
  assert.equal(o.ready, false); assert.deepEqual(requestSourcePopulation([o], [], []), []);
});

test('walls, obstacles, private ramparts and source tiles cannot become mining positions', () => {
  const f = logisticsFixture();
  f.structures.push({ id: 'wall', structureType: STRUCTURE_WALL, pos: f.buffer.pos } as StructureWall);
  assert.notEqual(operations(f)[0].bufferId, f.buffer.id);
  f.structures.pop();
  f.structures.push({ id: 'r', structureType: STRUCTURE_RAMPART, pos: f.buffer.pos, my: false, isPublic: false } as StructureRampart);
  assert.notEqual(operations(f)[0].bufferId, f.buffer.id);
  f.structures.pop();
  f.room.getTerrain = (() => ({ get: () => TERRAIN_MASK_WALL })) as unknown as Room['getTerrain'];
  assert.equal(operations(f)[0].reason, 'no-tile');
});

test('two adjacent sources cannot share a buffer or mining tile', () => {
  const f = logisticsFixture(); const second = f.secondSource(); second.pos = position(7, 7);
  const tiles = chooseSourceTiles(f.room, [second, f.source], f.structures, [], f.spawn.pos);
  const a = tiles.get(f.source.id)!; const b = tiles.get(second.id)!;
  assert.notDeepEqual([a.x, a.y], [b.x, b.y]);
  assert.equal(a.containerId, f.buffer.id); assert.equal(b.containerId, undefined);
});

test('specialist bodies are affordable, saturate an owned source and have explicit mobility', () => {
  logisticsFixture();
  assert.equal(bodyCost(minerBody(10)), 700);
  assert.equal(minerBody(10).filter((p) => p === WORK).length * HARVEST_POWER, 10);
  assert.deepEqual(minerBody(5), [WORK, WORK, WORK, CARRY, MOVE, MOVE]);
  assert.equal(bodyCost(haulerBody(700)), 700);
  assert.equal(bodyCost(haulerBody(5000)), 800);
  assert.equal(haulerBody(800).includes(WORK), false);
});

test('hauling need responds to income, trip duration and carry rather than fixed source count', () => {
  logisticsFixture();
  assert.equal(haulingRequirement(10, 5, 400), 1);
  assert.equal(haulingRequirement(10, 20, 400), 2);
  assert.equal(haulingRequirement(10, 40, 400), 3);
  assert.ok(haulingRequirement(10, 20, 200) > haulingRequirement(10, 20, 400));
  assert.ok(haulingRequirement(5, 20, 400) < haulingRequirement(10, 20, 400));
});

test('readiness gates unavailable colonies, missing path, body capacity and bounded haul need', () => {
  const f = logisticsFixture();
  const base = { home: f.room.name, source: { id: f.source.id, pos: f.source.pos }, energyCapacity: 3000,
    tile: operations(f)[0].tile, travelTicks: 5, capacity: 800, functioning: true, workforceReady: true };
  for (const [change, reason] of [[{ functioning: false }, 'colony-unavailable'], [{ travelTicks: undefined }, 'no-path'],
    [{ capacity: 699 }, 'capacity'], [{ travelTicks: 100 }, 'haul-limit'], [{ workforceReady: false }, 'worker-recovery']] as const) {
    const o = planSourceOperation({ ...base, ...change }); assert.equal(o.reason, reason); assert.equal(o.enabled, false);
  }
});

test('miner and hauler requests have unique deterministic source scopes and normal worker precedence', () => {
  const f = logisticsFixture(); const second = f.secondSource();
  const secondBuffer = f.repair('buffer-b'); secondBuffer.pos = position(19, 19);
  const state = observeColony(f.room);
  // Explicitly satisfy the two-source target for this pure request composition.
  state.population.effectiveWorkers = state.population.target;
  const requests = requestSourcePopulation(observeSourceOperations(state), [], []);
  assert.equal(requests.length, 4); assert.equal(new Set(requests.map((r) => r.id)).size, 4);
  assert.deepEqual(new Set(requests.map((r) => r.identity.operationId)), new Set(['source:source-a', `source:${second.id}`]));
  const worker = requestWorkerPopulation({ home: f.room.name, population: { ...state.population, effectiveWorkers: 3 },
    replacementLead: 100, energyAvailable: 800, energyCapacity: 800 })!;
  assert.equal(planSpawn({ home: f.room.name, requests: [worker, ...requests], energyAvailable: 800, energyCapacity: 800 })?.request, worker);
  assert.equal(planSpawn({ home: f.room.name, requests: [worker, ...requests], energyAvailable: 700, energyCapacity: 800 }), null);
});

for (const kind of ['miner', 'hauler'] as const) {
  test(`${kind} aging replacement includes spawn and travel lead; live/spawning body counted once`, () => {
    const f = logisticsFixture(); const o = operations(f)[0]; const c = f.specialist(kind);
    c.ticksToLive = specialistLead(o, kind) + 1;
    const requests = () => requestSourcePopulation([o], Object.values(Game.creeps), []);
    assert.equal(requests().some((r) => r.identity.kind === kind), false);
    c.ticksToLive -= 1;
    assert.equal(requests().some((r) => r.identity.kind === kind && r.reason === 'replacement'), true);
    c.spawning = true;
    const spawning = [{ name: c.name, memory: c.memory }, { name: c.name, memory: c.memory }];
    const count = countPopulation({ identity: c.memory as Required<CreepIdentity>, creeps: [c], spawning, replacementLead: 500 });
    assert.deepEqual(count, { live: 0, spawning: 1, aging: 0, effective: 1 });
    assert.equal(requestSourcePopulation([o], [c], spawning).some((r) => r.identity.kind === kind), false);
  });
}

import type { CreepIdentity } from '../../src/creeps/identity';

test('specialists assigned to other operations/home never cover this source population', () => {
  const f = logisticsFixture(); const o = operations(f)[0]; const c = f.specialist('miner', 'abc', 'other');
  assert.equal(requestSourcePopulation([o], [c], []).some((r) => r.identity.kind === 'miner'), true);
  c.memory.operationId = o.id; c.memory.home = 'E1N1';
  assert.equal(requestSourcePopulation([o], [c], []).some((r) => r.identity.kind === 'miner'), true);
});

test('local observation reuses room scans and constrains pathfinding to this room', () => {
  const f = logisticsFixture(); const state = observeColony(f.room); const scans = [...f.calls];
  observeSourceOperations(state);
  assert.deepEqual([...f.calls], scans); assert.equal(f.paths.length, 1); assert.equal(f.paths[0].maxRooms, 1);
});

test('failed or incomplete paths keep specialists disabled and worker access unchanged', () => {
  const f = logisticsFixture();
  Object.assign(globalThis, { RoomPosition: class {
    constructor(public x: number, public y: number, public roomName: string) {}
    findPathTo() { return [{ x: 7, y: 7 }]; }
  } });
  const o = operations(f)[0];
  assert.equal(o.reason, 'no-path'); assert.equal(o.ready, false);
  assert.deepEqual(requestSourcePopulation([o], [], []), []);
});

test('swamp path and consumer detour raise hauling need deterministically', () => {
  const f = logisticsFixture(); const plain = operations(f)[0];
  f.room.getTerrain = (() => ({ get: () => TERRAIN_MASK_SWAMP })) as unknown as Room['getTerrain'];
  const swamp = operations(f)[0];
  assert.equal(swamp.travelTicks, plain.travelTicks * 5);
  assert.ok(bodyCost(swamp.haulerBody) >= bodyCost(plain.haulerBody));
  f.refill('far-tower', 100, STRUCTURE_TOWER).pos = position(25, 25);
  const far = operations(f)[0];
  assert.ok(far.travelTicks > swamp.travelTicks); assert.equal(far.reason, 'haul-limit');
});

test('explicit worker priority wins bootstrap, recovery and normal despite adversarial specialist IDs', () => {
  const f = logisticsFixture(); const requests = requestSourcePopulation(operations(f), [], []).map((r) => ({ ...r, id: `000:${r.id}` }));
  for (const effectiveWorkers of [0, 1, 3]) {
    const state = observeColony(f.room);
    const worker = requestWorkerPopulation({ home: f.room.name, population: { ...state.population,
      effectiveWorkers, liveWorkers: effectiveWorkers, spawningWorkers: 0 }, replacementLead: 100,
      energyAvailable: 800, energyCapacity: 800 })!;
    assert.equal(planSpawn({ home: f.room.name, requests: [...requests, worker], energyAvailable: 800, energyCapacity: 800 })?.request, worker);
  }
});
