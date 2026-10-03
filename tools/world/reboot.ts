import { setTimeout as delay } from 'node:timers/promises';
import { isWalkable } from '../../shared/world/terrain';
import { getScreepsClient } from '../lib/screepsClient';
import { findStartCandidates, type StartCandidate } from './findStart';

const commit = process.argv.includes('--commit');
const allowShardX = process.argv.includes('--allow-shard-x');
const samplesFlag = process.argv.find((argument) =>
  argument.startsWith('--samples=')
);
const startSamples = samplesFlag ? Number(samplesFlag.split('=')[1]) : 4;
const radiusFlag = process.argv.find((argument) =>
  argument.startsWith('--radius=')
);
const radius = radiusFlag ? Number(radiusFlag.split('=')[1]) : 5;

if (!Number.isInteger(radius) || radius < 1 || radius > 6) {
  throw new Error('--radius must be an integer from 1 through 6');
}
if (!Number.isInteger(startSamples) || startSamples < 1 || startSamples > 8) {
  throw new Error('--samples must be an integer from 1 through 8');
}

const api = getScreepsClient();

function range(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

async function assertSelectionStillValid(
  selected: StartCandidate
): Promise<void> {
  const shard = selected.shard;
  const roomName = selected.room.room.roomName;
  const position = selected.spawn.position;

  const [statsResponse, statusResponse, objectsResponse, terrainResponse, prohibited] =
    await Promise.all([
      api.gameMapStats([roomName], 'owner0', shard),
      api.gameRoomStatus(roomName, shard),
      api.gameRoomObjects(roomName, shard),
      api.gameRoomTerrain(roomName, shard),
      api.userRespawnProhibitedRooms()
    ]);

  const stats = statsResponse.stats[roomName];
  if (!stats) {
    throw new Error(
      `Launch aborted: ${shard}/${roomName} disappeared from current map metadata.`
    );
  }

  if (stats.own) {
    const owner =
      statsResponse.users[stats.own.user]?.username ?? stats.own.user;
    throw new Error(
      `Launch aborted: ${shard}/${roomName} is now owned by ${owner}.`
    );
  }

  if (statusResponse.status === 'closed') {
    throw new Error(
      `Launch aborted: ${shard}/${roomName} is now closed.`
    );
  }

  if (prohibited.rooms.includes(`${shard}/${roomName}`)) {
    throw new Error(
      `Launch aborted: ${shard}/${roomName} is currently prohibited for respawn.`
    );
  }

  const controller = objectsResponse.objects.find(
    (object) => object.type === 'controller'
  );
  const sources = objectsResponse.objects.filter(
    (object) => object.type === 'source'
  );

  if (!controller || sources.length === 0) {
    throw new Error(
      `Launch aborted: ${shard}/${roomName} no longer has the expected neutral-controller/source layout.`
    );
  }

  const controllerState = controller as unknown as {
    x: number;
    y: number;
    user?: string | null;
    reservation?: unknown;
  };

  if (controllerState.user || controllerState.reservation) {
    throw new Error(
      `Launch aborted: controller in ${shard}/${roomName} is owned or reserved.`
    );
  }

  const encoded = terrainResponse.terrain[0]?.terrain;
  if (!encoded || !isWalkable(encoded, position.x, position.y)) {
    throw new Error(
      `Launch aborted: planned Spawn1 tile ${position.x},${position.y} is no longer walkable.`
    );
  }

  const occupied = objectsResponse.objects.some(
    (object) => object.x === position.x && object.y === position.y
  );
  if (occupied) {
    throw new Error(
      `Launch aborted: planned Spawn1 tile ${position.x},${position.y} is now occupied.`
    );
  }

  if (range(position, controllerState) < 3) {
    throw new Error(
      'Launch aborted: planned Spawn1 tile is too close to the controller.'
    );
  }

  if (
    sources.some((source) => range(position, source) < 2)
  ) {
    throw new Error(
      'Launch aborted: planned Spawn1 tile is too close to an energy source.'
    );
  }

  console.log(
    `Revalidated ${shard}/${roomName}: unowned, unreserved, open, permitted, and Spawn1 tile is clear.`
  );
}

const initialStatus = await api.userWorldStatus();

if (initialStatus.status === 'normal') {
  console.log(
    'Account status is normal. At least one active spawn exists, so account reboot is not appropriate.'
  );
  process.exit(0);
}

const result = await findStartCandidates(
  radius,
  (message) => {
    console.log(`[reboot] ${message}`);
  },
  { allowShardX, startSamples }
);

const selected = result.candidates[0];
if (!selected) {
  throw new Error('No safe starting-room candidate was found.');
}

if (selected.shard === 'shardX' && !allowShardX) {
  throw new Error(
    'Refusing to select shardX without --allow-shard-x because controller actions there require active Access Key access.'
  );
}

console.log('');
console.log('Selected restart candidate:');
console.log(
  `  ${selected.shard}/${selected.room.room.roomName} at ${selected.spawn.position.x},${selected.spawn.position.y}`
);
console.log(
  `  combined score ${selected.combinedScore.toFixed(1)}/100; room score ${selected.room.total.toFixed(1)}/100`
);
const nearest = selected.room.nearbyOwners[0];
console.log(
  `  sources=${selected.room.room.sources.length}; status=${selected.room.room.status}; nearestOwner=${nearest ? `${nearest.username} @ ${nearest.nearestDistance} room(s), RCL ${nearest.maxRcl}` : 'none observed'}`
);
console.log('');

if (!commit) {
  console.log(
    'Dry run only. Deploy the runtime first, review this selection, then rerun with --commit to respawn/place Spawn1.'
  );
  process.exit(0);
}

let status: string = initialStatus.status;

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

await assertSelectionStillValid(selected);

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

console.log(
  'Spawn1 placement request submitted. The in-game runtime can now bootstrap the colony.'
);
