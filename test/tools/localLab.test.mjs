import test from 'node:test';
import assert from 'node:assert/strict';
import { interactiveSteamConfigured } from '../../tools/local-screeps/lab.mjs';

test('interactive Steam mode requires a real configured key', () => {
  assert.equal(interactiveSteamConfigured({}), false);
  assert.equal(interactiveSteamConfigured({ SCREEPS_LOCAL_STEAM_KEY: '' }), false);
  assert.equal(interactiveSteamConfigured({ SCREEPS_LOCAL_STEAM_KEY: '   ' }), false);
  assert.equal(interactiveSteamConfigured({ SCREEPS_LOCAL_STEAM_KEY: 'offline-local-lab-no-steam-login' }), false);
  assert.equal(interactiveSteamConfigured({ SCREEPS_LOCAL_STEAM_KEY: ' real-local-secret ' }), true);
});
