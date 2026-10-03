import { setTimeout as delay } from 'node:timers/promises';
import { getScreepsClient } from '../lib/screepsClient';
import { findStartCandidates } from './findStart';

const commit = process.argv.includes('--commit');
const radiusFlag = process.argv.find((argument) =>
  argument.startsWith('--radius=')
);
const radius = radiusFlag ? Number(radiusFlag.split('=')[1]) : 5;

if (!Number.isInteger(radius) || radius < 1 || radius > 6) {
  throw new Error('--radius must be an integer from 1 through 6');
}

const api = getScreepsClient();
const initialStatus = await api.userWorldStatus();

if (initialStatus.status === 'normal') {
  console.log(
    'Account status is normal. At least one active spawn exists, so account reboot is not appropriate.'
  );
  process.exit(0);
}

const result = await findStartCandidates(radius, (message) => {
  console.log(`[reboot] ${message}`);
});

const selected = result.candidates[0];
if (!selected) {
  throw new Error('No safe starting-room candidate was found.');
}

console.log('');
console.log('Selected restart candidate:');
console.log(
  `  ${selected.shard}/${selected.room.room.roomName} at ${selected.spawn.position.x},${selected.spawn.position.y}`
);
console.log(
  `  combined score ${selected.combinedScore.toFixed(1)}/100; room score ${selected.room.total.toFixed(1)}/100`
);
console.log('');

if (!commit) {
  console.log(
    'Dry run only. Deploy the runtime first, review this selection, then rerun with --commit to respawn/place Spawn1.'
  );
  process.exit(0);
}

let status = initialStatus.status;

if (status === 'lost') {
  console.log('Account is lost. Issuing explicit respawn request...');
  await api.userRespawn();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await delay(750);
    const updated = await api.userWorldStatus();
    status = updated.status;
    if (status === 'empty') break;
  }
}

if (status !== 'empty') {
  throw new Error(
    `Cannot place Spawn1 because account world status is "${status}", expected "empty".`
  );
}

const roomName = selected.room.room.roomName;
const { x, y } = selected.spawn.position;

console.log(
  `Placing Spawn1 in ${selected.shard}/${roomName} at ${x},${y}...`
);

await api.gamePlaceSpawn(
  roomName,
  x,
  y,
  'Spawn1',
  selected.shard
);

console.log('Spawn1 placement request submitted. The in-game runtime can now bootstrap the colony.');
