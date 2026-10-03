import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOpsCommand } from '../../tools/ops/commands';

test('ops command parser accepts only the read-only allowlist', () => {
  assert.deepEqual(parseOpsCommand('/screeps snapshot'), {
    type: 'snapshot'
  });
  assert.deepEqual(parseOpsCommand('/screeps cpu'), {
    type: 'cpu'
  });
  assert.deepEqual(parseOpsCommand('/screeps room E25S47'), {
    type: 'room',
    roomName: 'E25S47'
  });
  assert.deepEqual(
    parseOpsCommand('/screeps creep worker-E25S47-abc123'),
    {
      type: 'creep',
      creepName: 'worker-E25S47-abc123'
    }
  );
});

test('ops command parser rejects arbitrary execution and memory access', () => {
  assert.equal(parseOpsCommand('/screeps eval Game.time'), null);
  assert.equal(parseOpsCommand('/screeps memory'), null);
  assert.equal(parseOpsCommand('/screeps room ../../etc/passwd'), null);
  assert.equal(parseOpsCommand('/screeps creep x;process.exit()'), null);
});
