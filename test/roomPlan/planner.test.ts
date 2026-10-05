import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { planRoom, blockingType } from '../../shared/roomPlan/planRoom';
import { flood, key, neighbors, range } from '../../shared/roomPlan/grid';
import { reconcilePlan } from '../../shared/roomPlan/reconcile';
import { limitsAt } from '../../shared/roomPlan/limits';
import type { RoomFacts, RoomPlan } from '../../shared/roomPlan/types';
import { roomFacts } from './fixtures';

function assertGeometry(facts: RoomFacts, p: RoomPlan) {
  const occupied = new Map<number, string>();
  for (const s of p.structures) {
    assert.ok(s.x >= 1 && s.x <= 48 && s.y >= 1 && s.y <= 48);
    assert.equal(Number(facts.terrain[key(s)]) & 1, 0);
    assert.ok(![facts.controller, ...facts.sources, facts.mineral!].some((a) => a && key(a) === key(s)));
    const prior = occupied.get(key(s));
    assert.ok(!prior || ['road', 'container'].includes(prior) && ['road', 'container'].includes(s.type), `${prior}/${s.type} overlap`);
    occupied.set(key(s), s.type);
  }
  for (const type of ['extension', 'road']) {
    const coordinates = p.structures.filter((s) => s.type === type).map(key);
    assert.equal(new Set(coordinates).size, coordinates.length);
  }
  for (const r of p.reservations) {
    const type = occupied.get(key(r));
    assert.ok(!type || r.purpose === 'access' && type === 'road' || r.purpose === 'work' && type === 'container', `${r.module}:${r.purpose}/${type}`);
    assert.equal(Number(facts.terrain[key(r)]) & 1, 0);
  }
  if (p.core) {
    const walk = new Uint8Array(2500);
    for (let id = 0; id < 2500; id++) walk[id] = (Number(facts.terrain[id]) & 1) ? 0 : 1;
    for (const s of [...facts.assets, ...p.structures]) if (('blocking' in s ? s.blocking : undefined) ?? blockingType(s.type)) walk[key(s)] = 0;
    for (const r of p.reservations) if (r.purpose === 'future' || r.purpose === 'manager') walk[key(r)] = 0;
    for (const natural of [facts.controller, ...facts.sources, ...(facts.mineral ? [facts.mineral] : [])]) walk[key(natural)] = 0;
    const seen = flood(walk, neighbors(facts.spawn1));
    assert.ok(neighbors(p.core.storage).filter((n) => seen[key(n)]).length >= 2, 'Storage needs permanent independent access');
    for (const s of [p.core.storage, p.core.terminal, p.core.factory, p.core.link]) assert.equal(range(s, p.core.manager), 1);
    assert.ok(seen[key(p.core.entrance)], 'Core entrance must be reachable with manager blocked');
    for (const source of p.sources) assert.ok(seen[key(source.access)], 'Mature footprint must preserve source access');
    if (p.controller) assert.ok(seen[key(p.controller.access)]);
    assert.ok(p.routes.every((r) => r.tiles.every((t) => key(t) !== key(p.core!.manager))));
  }
}

for (const kind of ['open', 'swamp', 'all-swamp', 'walls', 'controller', 'sources', 'brownfield']) {
  test(`${kind}: deterministic serialized planning, terrain and mature geometry`, () => {
    const facts = roomFacts(kind);
    const original = structuredClone(facts);
    const p = planRoom(facts).roomPlan;
    assert.deepEqual(facts, original, 'Planner must not mutate normalized input');
    assert.equal(JSON.stringify(p), JSON.stringify(planRoom(structuredClone(facts)).roomPlan));
    assert.equal(JSON.stringify(p), JSON.stringify(planRoom({ ...facts, sources: [...facts.sources].reverse(), assets: [...facts.assets].reverse() }).roomPlan));
    assertGeometry(facts, p);
    assert.equal(p.structures.filter((s) => s.type === 'extension').length, 60);
    assert.equal(p.feasibility.complete, true, p.feasibility.reasons.join(';'));
  });
}
test('normal two-source RCL8 intent is complete, with coherent labs and mature capacity', () => {
  const p = planRoom(roomFacts()).roomPlan;
  for (const [type, count] of Object.entries({ storage: 1, terminal: 1, factory: 1, powerSpawn: 1, spawn: 3, extension: 60, tower: 6 }))
    assert.equal(p.structures.filter((s) => s.type === type).length, count);
  assert.equal(p.sources.length, 2); assert.ok(p.sources.every((s) => s.link && range(s.miner, s.link) === 1));
  assert.ok(p.controller?.link); assert.ok(p.core?.manager); assert.ok(p.core!.access.length >= 2);
  const labs = p.reservations.filter((r) => r.futureType === 'lab');
  assert.equal(labs.length, 10);
  const origin = p.modules.find((m) => m.kind === 'labs')!.origin;
  const reagents = [{ x: origin.x + 1, y: origin.y + 1 }, { x: origin.x + 2, y: origin.y + 1 }];
  assert.ok(labs.every((l) => reagents.every((r) => range(l, r) <= 2)));
});
test('swamp-closet regression: a usable plain core beats swamp near Spawn1', () => {
  const facts = roomFacts();
  const cells = facts.terrain.split('');
  for (let y = 13; y <= 31; y++) for (let x = 11; x <= 29; x++) cells[y * 50 + x] = '2';
  facts.terrain = cells.join('');
  const p = planRoom(facts).roomPlan;
  assert.ok(p.core); assert.equal(facts.terrain[key(p.core.storage)], '0'); assert.equal(p.score.coreTerrainPenalty, 0);
  assertGeometry(facts, p);
  const unavoidable = planRoom(roomFacts('all-swamp')).roomPlan;
  assert.ok(unavoidable.score.coreTerrainPenalty > 0); assert.ok(unavoidable.warnings.some((w) => w.includes('swamp')));
});
test('road network shares trunk segments and never routes through stationary work tiles', () => {
  const p = planRoom(roomFacts()).roomPlan;
  const routes = p.routes.filter((r) => r.id.startsWith('source:') || r.id === 'controller' || r.id === 'spawn1');
  const use = new Map<number, number>();
  for (const r of routes) for (const pos of r.tiles.slice(1)) use.set(key(pos), (use.get(key(pos)) ?? 0) + 1);
  assert.ok([...use.values()].some((count) => count > 1), 'Reuse more than just the common hub tile');
  const stationary = new Set(p.reservations.filter((r) => r.purpose === 'manager' || r.purpose === 'work').map(key));
  assert.ok(p.structures.filter((s) => s.type === 'road').every((s) => !stationary.has(key(s))));
  assert.ok(p.structures.filter((s) => s.type === 'road').length < 200, 'No unnecessary runway network');
});
test('early RCL reconciliation protects all reserved modules and never invents positions', () => {
  const facts = roomFacts(), p = planRoom(facts).roomPlan;
  for (let rcl = 1; rcl <= 8; rcl++) {
    const actions = reconcilePlan(p, facts.assets, rcl, limitsAt(rcl), 1000).missing;
    assert.ok(actions.every((a) => p.structures.some((s) => s.type === a.type && key(s) === key(a))));
    assert.ok(actions.filter((a) => a.type !== 'road' && a.type !== 'container').every((a) => !p.reservations.some((r) => key(r) === key(a))));
    assert.ok(actions.every((a) => a.minRcl <= rcl));
  }
});
test('brownfield adopts buffers, fixed spawn, extensions and transitional controller; no demolition actions', () => {
  const facts = roomFacts('brownfield'), p = planRoom(facts).roomPlan;
  assert.deepEqual(p.spawn1, facts.spawn1);
  assert.deepEqual(p.sources[0].container, { x: 9, y: 11 });
  assert.deepEqual(p.controller?.container, { x: 38, y: 34 });
  assert.equal(p.assets.find((a) => a.type === 'extension')?.disposition, 'adopted');
  assert.equal(p.assets.find((a) => a.type === 'container' && a.x === 38)?.disposition, 'transitional');
  assert.equal(p.feasibility.complete, true);
  const compromised = roomFacts('brownfield');
  compromised.assets.push({ type: 'storage', x: 4, y: 44, owned: true }, { type: 'terminal', x: 30, y: 30, owned: true });
  const legacy = planRoom(compromised).roomPlan;
  assert.ok(legacy.warnings.length); assert.ok(legacy.assets.some((a) => a.type === 'storage'));
  const result = reconcilePlan(legacy, compromised.assets, 8, limitsAt(8), 1000);
  assert.ok(result.missing.every((a) => a.type !== 'storage' && a.type !== 'terminal'));
  assert.deepEqual(Object.keys(result).sort(), ['conflicts', 'missing']);
});
test('isolated/unusable room returns explicit infeasibility without illegal geometry', () => {
  const facts = roomFacts(); facts.terrain = '1'.repeat(2500);
  const p = planRoom(facts).roomPlan;
  assert.equal(p.feasibility.complete, false); assert.equal(p.core, undefined);
  assert.equal(p.sources.length, 0); assert.equal(p.structures.length, 1, 'Only sacred existing spawn retained');
});
test('developed core adopts important assets and adapts circulation around a harmless legacy extension', () => {
  const facts = roomFacts(), original = planRoom(facts).roomPlan;
  for (const s of original.structures.filter((s) => s.module === 'core')) facts.assets.push({ type: s.type, x: s.x, y: s.y, owned: true });
  facts.assets.push({ type: 'extension', x: original.core!.manager.x - 2, y: original.core!.manager.y - 2, owned: true });
  const p = planRoom(facts).roomPlan;
  assert.equal(p.feasibility.complete, true, p.feasibility.reasons.join(';'));
  assert.deepEqual(p.core!.storage, original.core!.storage);
  assert.ok(p.assets.filter((a) => ['storage', 'terminal', 'factory'].includes(a.type)).every((a) => a.disposition === 'adopted'));
  assertGeometry(facts, p);
});
test('compatible road/container intent waits between construction sites on one tile', () => {
  const p = planRoom(roomFacts()).roomPlan;
  const pos = p.controller!.container;
  const candidate = { ...p, structures: [
    { ...pos, type: 'container' as const, module: 'controller', minRcl: 2, priority: 45, owner: 'colony' as const },
    { ...pos, type: 'road' as const, module: 'network', minRcl: 2, priority: 100, owner: 'colony' as const }
  ] };
  const limits = { container: 5, road: 2500 };
  assert.deepEqual(reconcilePlan(candidate, [], 2, limits).missing.map((s) => s.type), ['container']);
  assert.deepEqual(reconcilePlan(candidate, [{ ...pos, type: 'container', site: true }], 2, limits).missing, []);
  assert.deepEqual(reconcilePlan(candidate, [{ ...pos, type: 'container' }], 2, limits).missing.map((s) => s.type), ['road']);
});
test('planner compiles without Screeps types and has no runtime/API dependency graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roomplan-boundary-'));
  try {
    const config = path.join(dir, 'tsconfig.json');
    fs.writeFileSync(config, JSON.stringify({ compilerOptions: { noEmit: true, strict: true, types: [],
      target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler' },
      files: ['shared/roomPlan/planRoom.ts', 'shared/roomPlan/reconcile.ts'].map((f) => path.resolve(f)) }));
    const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', config], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const name of fs.readdirSync('shared/roomPlan').filter((f) => f.endsWith('.ts'))) {
      const source = fs.readFileSync(`shared/roomPlan/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      assert.ok(!/\b(Game|Room|Memory|RoomPosition)\b/.test(source), name);
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('./'), `${name}: ${match[1]}`);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('roomplan-boundary-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
