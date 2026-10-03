import { saveRegionScan, scanRegion } from './scanRegion';

const [shard, centerRoom, radiusArgument] = process.argv.slice(2);
const radius = radiusArgument === undefined ? 3 : Number(radiusArgument);

if (!shard || !centerRoom || !Number.isInteger(radius)) {
  console.error('Usage: npm run world:region -- <shard> <center-room> [radius=3]');
  process.exitCode = 1;
} else {
  const scan = await scanRegion(shard, centerRoom, radius, (message) => {
    console.log(`[world] ${message}`);
  });

  const outputPath = await saveRegionScan(scan);

  console.log('');
  console.log(
    `Region: ${scan.shard} around ${scan.centerRoom} (radius ${scan.radius}, tick ${scan.gameTime})`
  );
  console.log(
    `Account world status: ${JSON.stringify(scan.worldStatus)} | candidates: ${scan.candidates.length}`
  );
  console.log('');

  if (scan.candidates.length === 0) {
    console.log('No candidate rooms were found in this scan.');
  } else {
    console.log('Top candidate rooms:');

    for (const [index, candidate] of scan.candidates.slice(0, 10).entries()) {
      const terrain = candidate.room.terrain;
      const sourceCount = candidate.room.sources.length;
      const anchor = candidate.room.anchor
        ? `${candidate.room.anchor.x},${candidate.room.anchor.y}`
        : 'unknown';
      const nearestOwner = candidate.nearbyOwners[0];
      const neighborText = nearestOwner
        ? `${nearestOwner.username} @ ${nearestOwner.nearestDistance} rooms (RCL ${nearestOwner.maxRcl})`
        : 'none observed';

      console.log(
        `${String(index + 1).padStart(2, ' ')}. ${candidate.room.roomName}  ` +
        `${candidate.total.toFixed(1)}/100  confidence=${candidate.confidence}`
      );
      console.log(
        `    sources=${sourceCount}  anchor=${anchor}  ` +
        `open=${terrain ? (terrain.walkableRatio * 100).toFixed(0) + '%' : '?'}  ` +
        `largest=${terrain?.largestOpenSquare.side ?? '?'}  neighbor=${neighborText}`
      );

      const positives = Object.values(candidate.dimensions)
        .flatMap((dimension) => dimension.reasons)
        .slice(0, 3);
      const warnings = Object.values(candidate.dimensions)
        .flatMap((dimension) => dimension.warnings)
        .slice(0, 2);

      for (const reason of positives) {
        console.log(`    + ${reason}`);
      }
      for (const warning of warnings) {
        console.log(`    ! ${warning}`);
      }
    }
  }

  console.log('');
  console.log(`Full scan saved to ${outputPath}`);
}
