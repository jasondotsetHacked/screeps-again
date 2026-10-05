import { deploymentConfig, deploymentEnv, LOCAL_URL } from '../../scripts/deploy-config.mjs';
import { localRequest } from '../../scripts/local-api.mjs';
import { planInitialSpawn } from '../world/spawnPlan.ts';
import { requireManaged, cli, cliValue } from './lab.mjs';

try {
  await requireManaged();
  const config = deploymentConfig('local', await deploymentEnv('local'));
  if (config.url !== LOCAL_URL) throw new Error('local:seed requires the managed lab URL http://127.0.0.1:21025.');
  const call = (path, body) => localRequest(config.url, path, { token: config.token, body });
  const status = await call('/api/user/world-status');
  if (status.status !== 'empty') throw new Error('local:seed requires an empty local account. It never respawns or replaces a colony.');
  const room = process.argv[2] || 'W8N3';
  if (!/^[WE]\d+[NS]\d+$/.test(room)) throw new Error('Invalid local seed room.');
  await cli('system.pauseSimulation()');
  // Private backend lacks the MMO room-objects endpoint. CLI reads are
  // supported; all world mutation still goes through the place-spawn API.
  const roomObjects = async roomName => ({
    objects: await cliValue(`storage.db["rooms.objects"].find({room: ${JSON.stringify(roomName)}})`)
  });
  const objects = await roomObjects(room);
  const controller = objects.objects.find(object => object.type === 'controller');
  if (!controller || controller.user || controller.reservation) throw new Error('Local seed room must have a neutral controller.');
  // Supply a loopback adapter to the same spawn planner; its MMO default is
  // never invoked. Do not use world:reboot/world:find-start for local seeding.
  const plan = await planInitialSpawn('local', room, {
    gameRoomTerrain: roomName => call(`/api/game/room-terrain?room=${roomName}&encoded=1`),
    gameRoomObjects: roomObjects
  });
  await call('/api/game/place-spawn', { room, x: plan.position.x, y: plan.position.y, name: 'Spawn1' });
  const after = await roomObjects(room);
  if (!after.objects.some(object => object.type === 'spawn' && object.name === 'Spawn1')) throw new Error('Local spawn verification failed.');
  console.log(`Placed local Spawn1 in ${room} at ${plan.position.x},${plan.position.y}. Simulation paused. Stop and save a baseline before deploying.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
