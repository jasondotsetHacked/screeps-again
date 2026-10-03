import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(globalThis, {
  WORK: 'work', CARRY: 'carry', MOVE: 'move', CREEP_SPAWN_TIME: 3,
  BODYPART_COST: { work: 100, carry: 50, move: 50 },
  FIND_MY_STRUCTURES: 1, FIND_SOURCES: 2, STRUCTURE_SPAWN: 'spawn',
  OK: 0, ERR_NOT_ENOUGH_ENERGY: -6
});

const { planWorkerPopulation, planWorkerSpawn, workerTarget } =
  await import('../../src/spawning/workerPlan');
const { bodyCost, buildWorkerBody, replacementLeadTicks } =
  await import('../../src/spawning/workerBody');
const { runSpawning } = await import('../../src/spawning/runSpawning');
const roomName = 'E25S47';
const memory = { kind: 'worker', home: roomName };
const capacity = 800;
const lead = replacementLeadTicks(buildWorkerBody(capacity));

function worker(name: string, ticksToLive: number | undefined = 1000, spawning = false) {
  return { name, memory, ticksToLive, spawning };
}

function population(effective: number, target = 4) {
  return planWorkerPopulation({
    roomName,
    workers: Array.from({ length: effective }, (_, index) => worker(`w${index}`)),
    spawning: [], replacementLead: lead, target
  });
}

test('population counts each worker name once across both spawning representations', () => {
  const workers = [worker('live'), worker('both', undefined, true)];
  const spawning = [
    { name: 'both', memory }, { name: 'spawn-only', memory },
    { name: 'spawn-only', memory }, { name: 'unknown' },
    { name: 'foreign', memory: { ...memory, home: 'E1N1' } }
  ];
  const input = { roomName, workers, spawning, replacementLead: lead, target: 4 };
  const expected = {
    liveWorkers: 1, spawningWorkers: 2, agingWorkers: 0,
    effectiveWorkers: 3, target: 4
  };
  assert.deepEqual(planWorkerPopulation(input), expected);
  assert.deepEqual(planWorkerPopulation({
    ...input, workers: [...workers].reverse(), spawning: [...spawning].reverse()
  }), expected);
});

test('existing worker identity can establish spawning status without a Memory entry', () => {
  assert.equal(planWorkerPopulation({
    roomName, workers: [worker('both')], spawning: [{ name: 'both' }],
    replacementLead: lead, target: 4
  }).spawningWorkers, 1);
});

test('replacement lead excludes aging workers and retains undefined TTL workers', () => {
  assert.deepEqual(planWorkerPopulation({
    roomName,
    workers: [worker('at-lead', lead), worker('below', lead - 1),
      worker('above', lead + 1), { ...worker('unknown-ttl'), ticksToLive: undefined },
      { ...worker('foreign'), memory: { ...memory, home: 'E1N1' } }],
    spawning: [], replacementLead: lead, target: 4
  }), {
    liveWorkers: 4, spawningWorkers: 0, agingWorkers: 2,
    effectiveWorkers: 2, target: 4
  });
});

test('zero effective workers bootstrap with the smallest useful affordable body', () => {
  const plan = planWorkerSpawn(population(0), 200, capacity);
  assert.equal(plan?.reason, 'bootstrap');
  assert.deepEqual(plan?.body, [WORK, CARRY, MOVE]);
  assert.equal(plan?.cost, 200);
  assert.equal(planWorkerSpawn(population(0), 199, capacity), null);
});

test('critical depletion uses max(1, floor(target / 3)) and waits below 200 energy', () => {
  for (const target of [3, 4, 5, 6, 7]) {
    const threshold = Math.max(1, Math.floor(target / 3));
    const plan = planWorkerSpawn(population(threshold, target), 250, capacity);
    assert.equal(plan?.reason, 'critical-depletion');
    assert.equal(plan?.cost, 200);
    assert.equal(plan?.energyBudget, 250);
    assert.equal(planWorkerSpawn(population(threshold + 1, target), 250, capacity), null);
    assert.equal(planWorkerSpawn(population(threshold, target), 199, capacity), null);
  }
});

test('normal body is preferred whenever affordable, including during recovery', () => {
  for (const effective of [0, 1, 2, 3]) {
    const plan = planWorkerSpawn(population(effective), capacity, capacity);
    assert.deepEqual(plan?.body, buildWorkerBody(capacity));
    assert.equal(plan?.cost, capacity);
  }
  assert.equal(planWorkerSpawn(population(4), capacity, capacity), null);
});

test('one aging worker in an otherwise healthy colony does not trigger an undersized replacement', () => {
  const state = planWorkerPopulation({
    roomName, workers: [worker('aging', lead), worker('a'), worker('b'), worker('c')],
    spawning: [], replacementLead: lead, target: 4
  });
  assert.equal(state.effectiveWorkers, 3);
  assert.equal(planWorkerSpawn(state, 200, capacity), null);
  assert.equal(planWorkerSpawn(state, capacity, capacity)?.reason, 'normal');
});

test('all-aging workforce uses bootstrap because effective population is zero', () => {
  const state = planWorkerPopulation({
    roomName, workers: [worker('aging', lead)], spawning: [],
    replacementLead: lead, target: 4
  });
  assert.equal(state.liveWorkers, 1);
  assert.equal(state.effectiveWorkers, 0);
  assert.equal(planWorkerSpawn(state, 200, capacity)?.reason, 'bootstrap');
});

test('worker targets retain the existing source-count and capacity policy', () => {
  assert.equal(workerTarget(2, 300), 6);
  assert.equal(workerTarget(2, 550), 5);
  assert.equal(workerTarget(2, capacity), 4);
});

test('runtime starts the planned bodies and only logs successful spawns', (t) => {
  const logs = t.mock.method(console, 'log', () => {});
  const started: BodyPartConstant[][] = [];
  let result: ScreepsReturnCode = OK;
  const spawn = {
    structureType: STRUCTURE_SPAWN,
    spawning: null,
    spawnCreep: (body: BodyPartConstant[], name: string, options: SpawnOptions) => {
      assert.ok(name.startsWith(`worker-${roomName}-`));
      assert.equal(options.memory?.kind, 'worker');
      assert.equal(options.memory?.home, roomName);
      if (result === OK) started.push(body);
      return result;
    }
  };
  const room = {
    name: roomName, energyAvailable: 200, energyCapacityAvailable: capacity,
    find: (type: number) => type === FIND_MY_STRUCTURES ? [spawn] : [{}, {}]
  } as unknown as Room;
  Object.assign(globalThis, { Game: { time: 123, creeps: {} }, Memory: { creeps: {} } });

  runSpawning(room);
  assert.equal(bodyCost(started[0]), 200);
  assert.match(String(logs.mock.calls[0].arguments[0]), /recovery=bootstrap/);

  Object.assign(Game, { creeps: { a: worker('a') } });
  runSpawning(room);
  assert.equal(bodyCost(started[1]), 200);
  assert.match(String(logs.mock.calls[1].arguments[0]), /recovery=critical-depletion/);

  Object.assign(Game, { creeps: { a: worker('a'), b: worker('b'), c: worker('c') } });
  runSpawning(room);
  assert.equal(started.length, 2);
  assert.equal(logs.mock.callCount(), 2);

  room.energyAvailable = capacity;
  runSpawning(room);
  assert.equal(bodyCost(started[2]), capacity);

  result = ERR_NOT_ENOUGH_ENERGY;
  Object.assign(Game, { creeps: {} });
  runSpawning(room);
  assert.equal(started.length, 3);
  assert.equal(logs.mock.callCount(), 3);
});

test('runtime counts a spawn-only worker through Memory while another spawn is available', () => {
  let started = 0;
  const room = {
    name: roomName, energyAvailable: 200, energyCapacityAvailable: capacity,
    find: (type: number) => type === FIND_MY_STRUCTURES
      ? [
        { structureType: STRUCTURE_SPAWN, spawning: { name: 'spawning' } },
        { structureType: STRUCTURE_SPAWN, spawning: null, spawnCreep: () => { started += 1; return OK; } }
      ]
      : [{}, {}]
  } as unknown as Room;
  Object.assign(globalThis, {
    Game: { time: 123, creeps: { a: worker('a'), b: worker('b') } },
    Memory: { creeps: { spawning: memory } }
  });
  runSpawning(room);
  // Two live plus one spawning is above critical depletion: wait for a full body.
  assert.equal(started, 0);
});

test('runtime does not double-count a spawning worker and skip an affordable normal spawn', (t) => {
  t.mock.method(console, 'log', () => {});
  const started: BodyPartConstant[][] = [];
  const room = {
    name: roomName, energyAvailable: capacity, energyCapacityAvailable: capacity,
    find: (type: number) => type === FIND_MY_STRUCTURES
      ? [
        { structureType: STRUCTURE_SPAWN, spawning: { name: 'both' } },
        {
          structureType: STRUCTURE_SPAWN, spawning: null,
          spawnCreep: (body: BodyPartConstant[]) => { started.push(body); return OK; }
        }
      ]
      : [{}, {}]
  } as unknown as Room;
  Object.assign(globalThis, {
    Game: { time: 123, creeps: {
      a: worker('a'), b: worker('b'), both: worker('both', undefined, true)
    } },
    Memory: { creeps: { both: memory } }
  });
  runSpawning(room);
  assert.equal(started.length, 1);
  assert.equal(bodyCost(started[0]), capacity);
});
