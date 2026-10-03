import assert from 'node:assert/strict';
import test from 'node:test';
import { isControllerUrgent } from '../../src/creeps/controllerUrgency';
import { runWorker } from '../../src/creeps/runWorker';

Object.assign(globalThis, {
  RESOURCE_ENERGY: 'energy',
  FIND_MY_STRUCTURES: 1,
  FIND_MY_CONSTRUCTION_SITES: 2,
  FIND_STRUCTURES: 3,
  STRUCTURE_SPAWN: 'spawn',
  STRUCTURE_EXTENSION: 'extension',
  STRUCTURE_TOWER: 'tower',
  STRUCTURE_CONTAINER: 'container',
  STRUCTURE_ROAD: 'road',
  OK: 0,
  ERR_NOT_IN_RANGE: -9
});

function scenario(options: {
  ticks?: number;
  refill?: boolean;
  construction?: boolean;
  repair?: boolean;
  road?: boolean;
  outOfRange?: boolean;
}) {
  const actions: string[] = [];
  const controller = { my: true, ticksToDowngrade: options.ticks ?? 3000 };
  const room = {
    controller,
    find: (type: number) => {
      if (type === FIND_MY_STRUCTURES) {
        return options.refill ? [{ structureType: STRUCTURE_SPAWN }] : [];
      }
      if (type === FIND_MY_CONSTRUCTION_SITES) {
        return [
          ...(options.construction ? [{ structureType: STRUCTURE_EXTENSION }] : []),
          ...(options.road ? [{ structureType: STRUCTURE_ROAD }] : [])
        ];
      }
      if (type === FIND_STRUCTURES) {
        return options.repair
          ? [{ structureType: STRUCTURE_CONTAINER, hits: 10, hitsMax: 100 }]
          : [];
      }
      throw new Error(`Unexpected room query: ${type}`);
    }
  };
  const creep = {
    spawning: false,
    memory: { working: true },
    room,
    store: { getUsedCapacity: () => 50, getFreeCapacity: () => 0 },
    transfer: () => { actions.push('refill'); return OK; },
    build: (site: ConstructionSite) => {
      actions.push(site.structureType === STRUCTURE_ROAD ? 'road' : 'build');
      return OK;
    },
    repair: () => { actions.push('repair'); return OK; },
    upgradeController: (target: unknown) => {
      assert.equal(target, controller);
      actions.push('upgrade');
      return options.outOfRange ? ERR_NOT_IN_RANGE : OK;
    },
    moveTo: (target: unknown) => {
      assert.equal(target, controller);
      actions.push('move-to-controller');
      return OK;
    }
  } as unknown as Creep;
  runWorker(creep);
  return actions;
}

test('controller urgency retains the strict 3000-tick owned-controller threshold', () => {
  assert.equal(isControllerUrgent({ my: true, ticksToDowngrade: 2999 }), true);
  assert.equal(isControllerUrgent({ my: true, ticksToDowngrade: 3000 }), false);
  assert.equal(isControllerUrgent({ my: false, ticksToDowngrade: 1 }), false);
  assert.equal(isControllerUrgent(undefined), false);
});

test('endangered controller beats simultaneous refill and construction demand', () => {
  assert.deepEqual(
    scenario({ ticks: 2999, refill: true, construction: true, repair: true, road: true }),
    ['upgrade']
  );
});

test('worker travels to the endangered controller instead of doing routine work', () => {
  assert.deepEqual(
    scenario({ ticks: 2999, refill: true, construction: true, outOfRange: true }),
    ['upgrade', 'move-to-controller']
  );
});

test('safe controller preserves refill, construction, repair, road, upgrade priorities', () => {
  assert.deepEqual(scenario({ refill: true, construction: true, repair: true, road: true }), ['refill']);
  assert.deepEqual(scenario({ construction: true, repair: true, road: true }), ['build']);
  assert.deepEqual(scenario({ repair: true, road: true }), ['repair']);
  assert.deepEqual(scenario({ road: true }), ['road']);
  assert.deepEqual(scenario({}), ['upgrade']);
});
