import { normalizeOpsMemory, buildDynamoItems, marshallItem } from '../../aws/collector/telemetry.mjs';
import { projectRecord } from '../../aws/query/projection.mjs';

export const NOW = Date.parse('2026-10-03T18:00:00.000Z');
export const ROOM = 'E25S47';
export const historyRequest = { action: 'history', shard: 'shard3', hours: 6 };

export function row({ index = 0, room = false, latest = false, mutate = () => {} } = {}) {
  const telemetry = normalizeOpsMemory({ version: 1, recentErrors: [], snapshot: {
    tick: 100 + index, cpuUsed: 2 + index, cpuLimit: 20, bucket: 9000 - index * 100,
    rooms: [{ name: ROOM, rcl: 2, progress: 100 + index * 10, progressTotal: 45000,
      ticksToDowngrade: 10000 - index * 100, energyAvailable: 300, energyCapacityAvailable: 550,
      constructionSites: 2, hostiles: 0,
      workerPopulation: { live: 5, spawning: 0, aging: 1, effective: 4, target: 5, replacementLead: 60 },
      infrastructure: { extensions: { built: 5, sites: 0, target: 5 }, containers: { built: 2, sites: 0, target: 2 },
        towers: { built: 0, sites: 0, target: 0 }, roads: { built: 10, sites: 2, target: null } },
      spawns: [{ name: 'Spawn1', energy: 300, energyCapacity: 300, spawning: null }],
      labor: { totalDemands: 2, emergency: false, kinds: [{ kind: 'build', capability: 'work', demands: 2,
        minimum: 1, desired: 3, assigned: 1, unsatisfied: 2, unsatisfiedMinimum: 0,
        acquiringWorkers: 1, travelingWorkers: 1, workingWorkers: 2, blockedWorkers: 0 }] },
      safety: { requested: false, attempted: false, accepted: false, reason: null }
    }], creeps: []
  } });
  const kind = (room ? 'room-' : 'colony-') + (latest ? 'latest' : 'snapshot');
  const item = buildDynamoItems(telemetry, { shard: 'shard3', collectedAt: new Date(NOW - 3600000 + index * 900000).toISOString() })
    .find(value => value.kind === kind);
  mutate(item);
  return marshallItem(item);
}

export function samples(count = 4, mutate = () => {}) {
  return Array.from({ length: count }, (_, index) => projectRecord(row({ index, mutate: item => mutate(item, index) }), historyRequest, true));
}
