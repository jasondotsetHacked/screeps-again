import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, position } from '../helpers/colony';
import { observeColony } from '../../src/colony/colonyState';
import { planSafety, type SafetyRequest } from '../../src/colony/planSafety';
import { prepareColony, runColony } from '../../src/colony/runColony';
import { arbitrateSafety } from '../../src/kernel/arbitrateSafety';
import { runKernel } from '../../src/kernel/runKernel';

function scene(roomName = 'E25S47') {
  const f = fixture({ roomName, count: 1 });
  const spawn = f.refill(roomName + '-spawn', 0);
  Object.assign(f.controller, { id: roomName + '-controller', safeModeAvailable: 1 });
  f.room.getTerrain = (() => ({ get: () => 0 })) as unknown as Room['getTerrain'];
  function hostile(parts: BodyPartConstant[], x = 12, y = 11) {
    const body = parts.map((type) => ({ type, hits: 100 } as BodyPartDefinition));
    const creep = { id: roomName + '-enemy-' + f.hostiles.length, pos: position(x, y, roomName),
      hits: body.length * 100, hitsMax: body.length * 100, body, fatigue: 0,
      getActiveBodyparts: (part: BodyPartConstant) => body.filter((p) => p.type === part && p.hits > 0).length
    } as Creep;
    f.hostiles.push(creep);
    return creep;
  }
  function rampart(hits: number) {
    const barrier = { id: 'barrier', pos: spawn.pos, my: true, isPublic: false,
      structureType: STRUCTURE_RAMPART, hits, hitsMax: 100000 } as StructureRampart;
    f.structures.push(barrier);
    return barrier;
  }
  function tower() {
    const result = f.refill(roomName + '-tower', 0, STRUCTURE_TOWER) as unknown as StructureTower;
    result.pos = position(10, 10, roomName);
    result.attack = () => OK;
    return result;
  }
  const plan = () => planSafety(observeColony(f.room));
  return { ...f, spawn, hostile, rampart, tower, plan };
}

test('safety observation includes controller, active CLAIM, boosted damage and barriers without additional finds', () => {
  const f = scene();
  const enemy = f.hostile([CLAIM, MOVE, ATTACK, WORK, RANGED_ATTACK, HEAL, TOUGH], 28, 30);
  enemy.body[2].boost = 'XUH2O';
  enemy.body[3].boost = 'XZH2O';
  enemy.body[4].hits = 0;
  enemy.body[5].boost = 'XLHO2';
  enemy.body[6].boost = 'XGHO2';
  f.rampart(10000);
  f.tower();
  const state = observeColony(f.room);
  assert.equal(state.hostileThreats[0].claim, 1);
  assert.equal(state.hostileThreats[0].controllerApproach, true);
  assert.equal(state.hostileThreats[0].melee, 120);
  assert.equal(state.hostileThreats[0].dismantle, 200);
  assert.equal(state.hostileThreats[0].ranged, 0);
  assert.equal(state.hostileThreats[0].heal, 48);
  assert.equal(state.hostileThreats[0].towerDamageFactor, 0.3);
  assert.equal(state.criticalTargets.find((target) => target.kind === 'spawn')?.rampartHits, 10000);
  assert.ok(state.criticalTargets.some((target) => target.kind === 'controller'));
  const calls = [...f.calls];
  planSafety(state);
  assert.deepEqual([...f.calls], calls);
  assert.ok([...f.calls.values()].every((count) => count === 1));
});

test('healthy structures and strong ramparts do not spend charges for proximity alone', () => {
  const f = scene();
  f.hostile([ATTACK, MOVE]);
  assert.equal(f.plan().reason, 'defenses-sufficient');
  f.spawn.hits = 150;
  f.rampart(10000);
  assert.equal(f.plan().reason, 'defenses-sufficient');
  (f.structures.find((s) => s.structureType === STRUCTURE_RAMPART)!).hits = 30;
  assert.equal(f.plan().request?.threat, 'critical-structure-threat');
});

test('a weak barrier cannot hide an imminent critical loss; harmless scouts never request protection', () => {
  const f = scene();
  f.spawn.hits = 100;
  f.rampart(1);
  f.hostile([WORK, MOVE]);
  assert.ok(f.plan().request);
  f.hostiles.length = 0;
  f.hostile([MOVE, CARRY]);
  assert.equal(f.plan().reason, 'no-immediate-threat');
});

test('structure policy accounts for ranged/melee/dismantle reach and one-tick approach', () => {
  for (const [part, range] of [[ATTACK, 2], [WORK, 2], [RANGED_ATTACK, 4]] as const) {
    const f = scene();
    f.spawn.hits = 100;
    const enemy = f.hostile([part, MOVE], 11 + range, 11);
    assert.ok(f.plan().request);
    enemy.fatigue = 1;
    assert.equal(f.plan().request, undefined);
    enemy.pos = position(enemy.pos.x - 1, 11);
    assert.ok(f.plan().request);
    enemy.pos = position(11 + range + 1, 11);
    enemy.fatigue = 0;
    assert.equal(f.plan().request, undefined);
  }
});

test('energized active towers can remove a weak threat after the structure survives the first burst', () => {
  const f = scene();
  f.spawn.hits = 300;
  f.hostile([ATTACK, MOVE]);
  f.tower();
  assert.equal(f.plan().reason, 'defenses-sufficient');
  f.spawn.hits = 20;
  assert.ok(f.plan().request, 'a same-tick kill does not erase the attacker intent');
});

test('tower depletion, inactive towers, power effects and range falloff are not optimistic defense', () => {
  const f = scene();
  f.spawn.hits = 300;
  f.hostile([ATTACK, MOVE]);
  const tower = f.tower();
  Object.assign(tower.store, { getUsedCapacity: () => 9 });
  assert.ok(f.plan().request);
  Object.assign(tower.store, { getUsedCapacity: () => 1000 });
  tower.isActive = () => false;
  assert.ok(f.plan().request);
  tower.isActive = () => true;
  tower.effects = [{ effect: 99, ticksRemaining: 5 }] as unknown as RoomObjectEffect[];
  assert.ok(f.plan().request);
  tower.effects = [];
  tower.pos = position(40, 40);
  assert.ok(f.plan().request);
});

test('tower kill estimates include healing, TOUGH, enemy shields and actual nearest-target contention', () => {
  const f = scene();
  f.spawn.hits = 300;
  const enemy = f.hostile([ATTACK, ...Array<BodyPartConstant>(5).fill(MOVE)]);
  enemy.hits = 590;
  f.tower();
  assert.equal(f.plan().reason, 'defenses-sufficient');
  const healer = f.hostile([HEAL, MOVE], 13, 11);
  assert.ok(f.plan().request);
  f.hostiles.pop();
  enemy.body.push({ type: TOUGH, hits: 100, boost: 'XGHO2' });
  assert.ok(f.plan().request);
  enemy.body.pop();
  f.structures.push({ id: 'enemy-shield', pos: enemy.pos, my: false, isPublic: false,
    structureType: STRUCTURE_RAMPART, hits: 100000 } as StructureRampart);
  assert.ok(f.plan().request);
  f.structures.pop();
  f.hostiles.push(healer);
  healer.pos = position(10, 11);
  healer.body = [{ type: MOVE, hits: 100 }];
  assert.ok(f.plan().request, 'a closer decoy receives tower fire instead of the attacker');
});

test('multiple attackers are aggregated and a tower cannot promise a kill on every target', () => {
  const f = scene();
  f.spawn.hits = 300;
  f.hostile([ATTACK, MOVE], 12, 11);
  f.hostile([ATTACK, MOVE], 11, 12);
  f.tower();
  assert.equal(f.plan().request?.deadline, 5);
});

test('CLAIM protection starts at a reachable range two and does not misclassify combat parts as controller attacks', () => {
  const f = scene();
  const claimer = f.hostile([CLAIM, MOVE], 28, 30);
  assert.equal(f.plan().request?.threat, 'controller-claim');
  assert.equal(f.plan().request?.deadline, 1);
  claimer.fatigue = 1;
  assert.equal(f.plan().request, undefined);
  claimer.fatigue = 0;
  claimer.body[1].hits = 0;
  assert.equal(f.plan().request, undefined);
  claimer.body[1].hits = 100;
  f.room.getTerrain = (() => ({ get: () => TERRAIN_MASK_WALL })) as unknown as Room['getTerrain'];
  assert.equal(f.plan().request, undefined);
  claimer.pos = position(29, 30);
  assert.equal(f.plan().request?.deadline, 0);
  claimer.body[0].hits = 0;
  assert.equal(f.plan().request, undefined);
  f.hostiles.length = 0;
  f.hostile([WORK, ATTACK, RANGED_ATTACK, MOVE], 29, 30);
  assert.equal(f.plan().request, undefined);
});

test('walls and private owned ramparts block the one-step CLAIM approach; public ramparts do not', () => {
  const f = scene();
  f.hostile([CLAIM, MOVE], 28, 30);
  for (const y of [29, 30, 31]) f.structures.push({ id: `r${y}`, pos: position(29, y),
    my: true, isPublic: false, hits: 10000, structureType: STRUCTURE_RAMPART } as StructureRampart);
  assert.equal(f.plan().request, undefined);
  (f.structures[1] as StructureRampart).isPublic = true;
  assert.ok(f.plan().request);
});

test('weak controller approach barriers cannot hide a claimer or its supporting dismantler', () => {
  const f = scene();
  const claimer = f.hostile([CLAIM, WORK, MOVE], 28, 30);
  for (const y of [29, 30, 31]) f.structures.push({ id: `r${y}`, pos: position(29, y),
    my: true, isPublic: false, hits: 50, structureType: STRUCTURE_RAMPART } as StructureRampart);
  assert.equal(f.plan().request?.threat, 'controller-claim');
  claimer.body[1].hits = 0;
  assert.equal(f.plan().request, undefined);
  f.hostile([WORK, MOVE], 28, 29);
  assert.equal(f.plan().request?.threat, 'controller-claim');
  for (const barrier of f.structures.slice(1)) barrier.hits = 51;
  assert.equal(f.plan().request, undefined);
});

test('safety retains availability, cooldown, blocking and exact downgrade eligibility', () => {
  const f = scene();
  f.hostile([CLAIM, MOVE], 28, 30);
  const state = observeColony(f.room);
  for (const [field, value, reason] of [['safeMode', 10, 'already-protected'],
    ['safeModeAvailable', 0, 'unavailable'], ['safeModeCooldown', 10, 'cooldown'],
    ['upgradeBlocked', 10, 'upgrade-blocked']] as const) {
    const original = state.controller![field];
    state.controller![field] = value;
    assert.equal(planSafety(state).reason, reason);
    state.controller![field] = original;
  }
  state.controller!.downgradeLimit = 40000;
  state.controller!.ticksToDowngrade = 14999;
  assert.equal(planSafety(state).reason, 'downgrade-blocked');
  state.controller!.ticksToDowngrade = 15000;
  assert.ok(planSafety(state).request);
  assert.equal(planSafety({ ...state, controller: undefined }).reason, 'no-controller');
});

test('colonies emit requests without activating safe mode or persisting decisions', () => {
  const f = scene();
  f.hostile([CLAIM, MOVE], 28, 30);
  const observation = prepareColony(f.room);
  const calls = [...f.calls];
  const colony = runColony(f.room, observation);
  assert.ok(colony.safety.request);
  assert.equal(colony.safety.attempted, false);
  assert.equal(f.actions.includes('safe-mode'), false);
  assert.equal(f.calls.get(FIND_STRUCTURES), new Map(calls).get(FIND_STRUCTURES));
  assert.equal('safety' in Memory, false);
});

test('global arbitration ranks deadline, asset value and RCL, then stable room/target IDs', () => {
  const request = (roomName: string, deadline: number, value = 3, rcl = 2): SafetyRequest => ({
    roomName, deadline, value, rcl, controllerId: roomName, targetId: roomName, threat: 'controller-claim' });
  const requests = [request('A', 10, 4), request('B', 1, 3), request('C', 1, 4), request('D', 1, 4, 3), request('E', 1, 4, 3)];
  assert.equal(arbitrateSafety(requests, false)?.roomName, 'D');
  assert.deepEqual(arbitrateSafety([...requests].reverse(), false), requests[3]);
  assert.equal(arbitrateSafety(requests, true), undefined);
  assert.equal(arbitrateSafety([], false), undefined);
});

function world(...rooms: ReturnType<typeof scene>[]) {
  Game.rooms = Object.fromEntries(rooms.map((f) => [f.room.name, f.room]));
  Game.creeps = Object.fromEntries(rooms.flatMap((f) => f.workers.map((w) => {
    w.name = f.room.name + '-worker';
    return [w.name, w];
  })));
  Game.spawns = Object.fromEntries(rooms.map((f) => [f.spawn.name, f.spawn]));
  Game.getObjectById = ((id: string) => rooms.flatMap((f) =>
    [f.controller, f.source, ...f.structures]).find((object) => object.id === id) ?? null) as typeof Game.getObjectById;
}

test('kernel chooses a later higher-severity colony, independently of room iteration order', (t) => {
  t.mock.method(console, 'log', () => {});
  for (const reverse of [false, true]) {
    const a = scene('E25S47'); a.spawn.hits = 300; a.hostile([ATTACK, MOVE]);
    const b = scene('E26S47'); b.hostile([CLAIM, MOVE], 28, 30);
    world(...(reverse ? [b, a] : [a, b]));
    runKernel();
    assert.equal(a.actions.includes('safe-mode'), false);
    assert.equal(b.actions.filter((action) => action === 'safe-mode').length, 1);
    assert.equal(Memory.ops?.snapshot?.rooms.find((room) => room.name === a.room.name)?.safety?.attempted, false);
  }
});

test('active protection prevents all new activations; rejected or throwing activation does not abort labor', (t) => {
  t.mock.method(console, 'log', () => {});
  const a = scene('E25S47'); a.hostile([CLAIM, MOVE], 28, 30);
  const b = scene('E26S47'); Object.assign(b.controller, { safeMode: 100 });
  world(a, b); runKernel();
  assert.equal(a.actions.includes('safe-mode'), false);
  assert.equal(Memory.ops?.snapshot?.rooms[0].safety?.reason, 'safe-mode-elsewhere');
  for (const activate of [() => ERR_NOT_ENOUGH_ENERGY, () => { throw new Error('private cooldown diagnostic'); }]) {
    const f = scene(); f.hostile([CLAIM, MOVE], 28, 30);
    f.controller.activateSafeMode = activate;
    world(f); runKernel();
    assert.ok(f.actions.includes('w0:upgrade'));
    assert.equal(Memory.ops?.snapshot?.rooms[0].safety?.attempted, true);
    assert.equal(Memory.ops?.snapshot?.rooms[0].safety?.accepted, false);
    assert.equal(JSON.stringify(Memory.ops).includes('private cooldown diagnostic'), false);
  }
});

test('a later colony execution exception cannot lose its pre-arbitrated protection request', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = scene(); f.hostile([CLAIM, MOVE], 28, 30);
  f.workers[0].ticksToLive = 1;
  f.spawn.spawnCreep = (() => { throw new Error('spawning exception'); }) as StructureSpawn['spawnCreep'];
  world(f); runKernel();
  assert.equal(f.actions.filter((action) => action === 'safe-mode').length, 1);
  assert.equal(Memory.ops?.recentErrors[0].scope, 'colony');
});

test('an observation exception in one colony does not block protection or labor in another', (t) => {
  t.mock.method(console, 'log', () => {});
  const a = scene('E25S47');
  const b = scene('E26S47'); b.hostile([CLAIM, MOVE], 28, 30);
  const find = a.room.find.bind(a.room);
  a.room.find = ((type: number) => {
    if (type === FIND_MY_CREEPS) throw new Error('observation failed');
    return find(type as FindConstant);
  }) as Room['find'];
  world(a, b); runKernel();
  assert.ok(b.actions.includes('safe-mode'));
  assert.ok(b.actions.includes('w0:upgrade'));
  assert.equal(Memory.ops?.recentErrors[0].subject, a.room.name + '/observation');
});

// These tests model the two relevant engine resolution rules, not a combat
// simulator: attacks use start-of-tick range and block pending activation.
function resolveClaimTick(f: ReturnType<typeof scene>, claimer: Creep, requested: boolean) {
  if (!f.controller.safeMode && claimer.pos.getRangeTo(f.controller) <= 1) {
    Object.assign(f.controller, { upgradeBlocked: 1000 });
  }
  if (requested && !f.controller.upgradeBlocked) Object.assign(f.controller, { safeMode: 20000 });
  claimer.pos = position(29, 30);
}

test('range-two CLAIM warning activates before movement permits the next controller attack', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = scene(); const claimer = f.hostile([CLAIM, MOVE], 28, 30);
  world(f); runKernel();
  assert.equal(Memory.ops?.snapshot?.rooms[0].safety?.accepted, true);
  resolveClaimTick(f, claimer, f.actions.includes('safe-mode'));
  assert.equal(f.controller.safeMode, 20000);
  resolveClaimTick(f, claimer, false);
  assert.equal(f.controller.upgradeBlocked, undefined);
});

test('already-adjacent CLAIM attack can cancel an accepted activation; OK does not mean protection', (t) => {
  t.mock.method(console, 'log', () => {});
  const f = scene(); const claimer = f.hostile([CLAIM, MOVE], 29, 30);
  world(f); runKernel();
  assert.equal(Memory.ops?.snapshot?.rooms[0].safety?.accepted, true);
  resolveClaimTick(f, claimer, f.actions.includes('safe-mode'));
  assert.equal(f.controller.safeMode, undefined);
  assert.equal(f.controller.upgradeBlocked, 1000);
  assert.equal(f.plan().reason, 'upgrade-blocked');
});
