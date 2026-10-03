import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture } from '../helpers/colony';
import { runColony } from '../../src/colony/runColony';
import { publishOpsSnapshot } from '../../src/ops/opsTelemetry';
import { formatRoom, formatSnapshot } from '../../tools/ops/githubOps';

function snapshot() {
  const f = fixture();
  const colony = runColony(f.room);
  publishOpsSnapshot([f.room], 0, new Map([[f.room.name, colony]]));
  return Memory.ops!;
}

test('public room and snapshot output redact all defensive eligibility and arbitration reasons', () => {
  const ops = snapshot();
  const room = ops.snapshot!.rooms[0];
  for (const reason of ['unavailable', 'cooldown', 'upgrade-blocked', 'downgrade-blocked',
    'safe-mode-elsewhere', 'arbitration-deferred', 'controller-claim', 'critical-structure-threat'] as const) {
    room.safety = { requested: true, attempted: false, accepted: false, reason };
    assert.ok(formatRoom(room, ops.snapshot!).includes('Safety action: no action'));
    assert.equal(formatRoom(room, ops.snapshot!).includes(reason), false);
    assert.equal(formatSnapshot(ops).includes(reason), false);
  }
});

test('public action status distinguishes accepted, rejected and unselected requests, including old snapshots', () => {
  const ops = snapshot();
  const room = ops.snapshot!.rooms[0];
  room.safety = { requested: true, attempted: true, accepted: true, reason: 'controller-claim' };
  assert.ok(formatRoom(room, ops.snapshot!).includes('activation accepted'));
  room.safety.accepted = false;
  assert.ok(formatRoom(room, ops.snapshot!).includes('activation rejected'));
  delete room.safety.attempted;
  assert.ok(formatRoom(room, ops.snapshot!).includes('activation rejected'));
  delete room.safety;
  assert.equal(formatRoom(room, ops.snapshot!).includes('Safety action'), false);
});

test('legacy safety exceptions cannot disclose private diagnostics through public recent errors', () => {
  const ops = snapshot();
  ops.recentErrors.push({ tick: 1, scope: 'colony', subject: 'E25S47/safety',
    message: 'cooldown unavailable: private defensive diagnostic' });
  const output = formatSnapshot(ops);
  assert.ok(output.includes('Safe-mode activation failed'));
  assert.equal(output.includes('private defensive diagnostic'), false);
  assert.equal(output.includes('cooldown unavailable'), false);
});

test('ops command remains executable after making its formatter importable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'screeps-ops-test-'));
  const response = join(directory, '.ops-response.md');
  try {
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('../../tools/ops/githubOps.ts', import.meta.url))], {
      cwd: directory, env: { ...process.env, SCREEPS_OPS_COMMAND: '/screeps help' }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(response, 'utf8').includes('/screeps room'));
  } finally {
    try { unlinkSync(response); } finally { rmdirSync(directory); }
  }
});
