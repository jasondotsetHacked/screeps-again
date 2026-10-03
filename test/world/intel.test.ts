import assert from 'node:assert/strict';
import test from 'node:test';
import { intelFreshness, isRoomIntel, projectRoomIntel, readRoomIntel, type RoomObservation } from '../../shared/world/intel';

function observation(overrides: Partial<RoomObservation> = {}): RoomObservation {
  return {
    roomName: 'E21S31', tick: 100,
    controller: { id: 'controller', x: 20, y: 20, owner: 'owner', level: 3,
      reservation: null },
    sources: [{ id: 'b', x: 5, y: 6 }, { id: 'a', x: 7, y: 8 }],
    mineral: { id: 'mineral', x: 10, y: 11, type: 'H' },
    hostiles: { creeps: 2, towers: 1, invaderCores: 0 }, ...overrides
  };
}

test('projection creates compact, timestamped intel using shared room classification', () => {
  const intel = projectRoomIntel(observation());
  assert.deepEqual(intel, {
    version: 1, lastSeen: 100, roomClass: 'standard',
    controller: { id: 'controller', x: 20, y: 20, owner: 'owner', level: 3, reservation: null },
    sources: [{ id: 'a', x: 7, y: 8 }, { id: 'b', x: 5, y: 6 }],
    mineral: { id: 'mineral', x: 10, y: 11, type: 'H' },
    hostiles: { creeps: 2, towers: 1, invaderCores: 0 }
  });
  assert.equal(isRoomIntel(intel), true);
  assert.equal(projectRoomIntel(observation({ roomName: 'W0N1' })).roomClass, 'highway');
  assert.equal(projectRoomIntel(observation({ roomName: 'W4N6' })).roomClass, 'sourceKeeper');
});

test('projection copies allowlisted facts without mutating or retaining input objects', () => {
  const input = observation();
  Object.assign(input.sources[0], { energy: 3000, runtime: { giant: 'ignored' } });
  Object.assign(input, { terrain: '0'.repeat(2500), remoteScore: 100 });
  const before = JSON.stringify(input);
  const intel = projectRoomIntel(input);
  assert.equal(JSON.stringify(input), before);
  input.sources[0].x = 1;
  input.hostiles.creeps = 999;
  assert.equal(intel.sources.find((source) => source.id === 'b')?.x, 5);
  assert.equal(intel.hostiles.creeps, 2);
  const serialized = JSON.stringify(intel);
  assert.ok(serialized.length < 700);
  for (const key of ['energy', 'runtime', 'terrain', 'remoteScore']) assert.equal(serialized.includes(key), false);
  assert.deepEqual(JSON.parse(serialized), intel);
});

test('reservation expiry is absolute and remains an observation, not predicted ownership', () => {
  const intel = projectRoomIntel(observation({ controller: {
    id: 'controller', x: 20, y: 20, owner: null, level: 0,
    reservation: { username: 'reserver', ticksRemaining: 50 }
  } }));
  assert.equal(intel.controller?.reservation?.expiresAt, 150);
  assert.equal(intelFreshness(intel, 151, 100), 'fresh');
  assert.equal(intel.controller?.reservation?.username, 'reserver');
});

test('freshness is derived at inclusive age boundary without mutating stale observations', () => {
  const intel = projectRoomIntel(observation());
  const before = JSON.stringify(intel);
  assert.equal(intelFreshness(intel, 100, 0), 'fresh');
  assert.equal(intelFreshness(intel, 110, 10), 'fresh');
  assert.equal(intelFreshness(intel, 111, 10), 'stale');
  assert.equal(intelFreshness(intel, 99, 10), 'unknown');
  assert.equal(JSON.stringify(intel), before);
  assert.throws(() => intelFreshness(intel, 100, -1));
  assert.throws(() => intelFreshness(intel, NaN, 10));
});

test('missing, older, future and malformed records cannot masquerade as fresh intel', () => {
  const valid = projectRoomIntel(observation());
  assert.equal(readRoomIntel({ version: 1, rooms: { E21S31: valid } }, 'E21S31'), valid);
  assert.equal(readRoomIntel({ version: 2, rooms: { E21S31: valid } }, 'E21S31'), undefined);
  assert.equal(readRoomIntel(undefined, 'E21S31'), undefined);
  assert.equal(readRoomIntel({ version: 1, rooms: {} }, 'E21S31'), undefined);
  for (const value of [undefined, null, {}, { lastSeen: 100 }, { ...valid, version: 0 },
    { ...valid, version: 2 }, { ...valid, lastSeen: NaN }, { ...valid, sources: null },
    { ...valid, sources: [{ id: 'bad', x: 50, y: 0 }] }, { ...valid, controller: {} },
    { ...valid, mineral: {} }, { ...valid, hostiles: { creeps: -1, towers: 0, invaderCores: 0 } }]) {
    assert.equal(isRoomIntel(value), false);
    assert.equal(intelFreshness(value, 100, 10), 'unknown');
    assert.equal(readRoomIntel({ version: 1, rooms: { E21S31: value } }, 'E21S31'), undefined);
  }
});

test('controllerless rooms preserve explicit absence and actual source count', () => {
  const intel = projectRoomIntel(observation({ controller: null, mineral: null, sources: [] }));
  assert.equal(intel.controller, null);
  assert.equal(intel.mineral, null);
  assert.equal(intel.sources.length, 0);
  assert.equal(isRoomIntel(intel), true);
});
