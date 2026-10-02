import { getScreepsClient } from '../lib/screepsClient';

const [shard, room] = process.argv.slice(2);

if (!shard || !room) {
  console.error('Usage: npm run world:room -- <shard> <room>');
  process.exitCode = 1;
} else {
  const api = getScreepsClient();
  const [status, terrain, objects] = await Promise.all([
    api.gameRoomStatus(room, shard),
    api.gameRoomTerrain(room, shard),
    api.gameRoomObjects(room, shard)
  ]);

  console.log(
    JSON.stringify(
      {
        shard,
        room,
        observedAt: new Date().toISOString(),
        status,
        terrain,
        objects
      },
      null,
      2
    )
  );
}
