import { findStartCandidates } from './findStart';

const radiusFlag = process.argv.find((argument) =>
  argument.startsWith('--radius=')
);
const radius = radiusFlag ? Number(radiusFlag.split('=')[1]) : 5;
const allowShardX = process.argv.includes('--allow-shard-x');
const samplesFlag = process.argv.find((argument) =>
  argument.startsWith('--samples=')
);
const startSamples = samplesFlag ? Number(samplesFlag.split('=')[1]) : 4;

if (!Number.isInteger(radius) || radius < 1 || radius > 6) {
  throw new Error('--radius must be an integer from 1 through 6');
}
if (!Number.isInteger(startSamples) || startSamples < 1 || startSamples > 8) {
  throw new Error('--samples must be an integer from 1 through 8');
}

const result = await findStartCandidates(
  radius,
  (message) => {
    console.log(`[world] ${message}`);
  },
  { allowShardX, startSamples }
);

console.log('');
console.log(`Account world status: ${JSON.stringify(result.worldStatus)}`);
console.log(`Candidate starts found: ${result.candidates.length}`);
console.log('');

for (const [index, candidate] of result.candidates.slice(0, 12).entries()) {
  const neighbor = candidate.room.nearbyOwners[0];
  const neighborText = neighbor
    ? `${neighbor.username} @ ${neighbor.nearestDistance} room(s), RCL ${neighbor.maxRcl}`
    : 'none observed';

  console.log(
    `${String(index + 1).padStart(2, ' ')}. ${candidate.shard}/${candidate.room.room.roomName}  combined=${candidate.combinedScore.toFixed(1)} room=${candidate.room.total.toFixed(1)}`
  );
  const protection = candidate.room.room.protectionEndsAt;
  const protectionText =
    protection === null
      ? 'none'
      : new Date(
          protection > 10_000_000_000 ? protection : protection * 1000
        ).toISOString();

  console.log(
    `    Spawn1=${candidate.spawn.position.x},${candidate.spawn.position.y}  sources=${candidate.room.room.sources.length}  neighbor=${neighborText}`
  );
  console.log(
    `    status=${candidate.room.room.status} protectionUntil=${protectionText} confidence=${candidate.room.confidence} launchRisk=${candidate.launchRisk}`
  );
  console.log(
    `    spawn source costs=${candidate.spawn.sourcePathCosts.join('/')} controller=${candidate.spawn.controllerPathCost}`
  );
}

if (result.candidates.length === 0) {
  process.exitCode = 2;
}
