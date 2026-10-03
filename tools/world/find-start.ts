import { findStartCandidates } from './findStart';

const radiusFlag = process.argv.find((argument) =>
  argument.startsWith('--radius=')
);
const radius = radiusFlag ? Number(radiusFlag.split('=')[1]) : 5;

if (!Number.isInteger(radius) || radius < 1 || radius > 6) {
  throw new Error('--radius must be an integer from 1 through 6');
}

const result = await findStartCandidates(radius, (message) => {
  console.log(`[world] ${message}`);
});

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
  console.log(
    `    Spawn1=${candidate.spawn.position.x},${candidate.spawn.position.y}  sources=${candidate.room.room.sources.length}  neighbor=${neighborText}`
  );
  console.log(
    `    spawn source costs=${candidate.spawn.sourcePathCosts.join('/')} controller=${candidate.spawn.controllerPathCost}`
  );
}

if (result.candidates.length === 0) {
  process.exitCode = 2;
}
