import { LIMITS, partitionKey, validRoom } from './query.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').slice(0, 300) : null;
const flag = value => typeof value === 'boolean' ? value : null;
const numericFields = (source, keys) => Object.fromEntries(keys.map(key => [key, number(source?.[key])]));
const list = (value, maximum) => {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid telemetry array');
  return value;
};

// Decode only supported schema types, with depth/collection caps and no prototype assignment.
export function unmarshallItem(item) {
  function decode(value, depth = 0) {
    if (!object(value) || depth > 12 || Object.keys(value).length !== 1) throw new Error('Invalid attribute');
    if (typeof value.S === 'string') return value.S;
    if (typeof value.N === 'string' && value.N.trim() && Number.isFinite(Number(value.N))) return Number(value.N);
    if (typeof value.BOOL === 'boolean') return value.BOOL;
    if (value.NULL === true) return null;
    if (object(value.M) && Object.keys(value.M).length <= 128) return Object.fromEntries(Object.entries(value.M).map(([key, child]) => [key, decode(child, depth + 1)]));
    if (Array.isArray(value.L) && value.L.length <= 2000) return value.L.map(child => decode(child, depth + 1));
    throw new Error('Unsupported attribute');
  }
  if (!object(item)) throw new Error('Invalid item');
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, decode(value)]));
}

function roomProjection(room) {
  if (!object(room) || !validRoom(room.name) || !Number.isInteger(room.rcl) || room.rcl < 0 || room.rcl > 8) {
    throw new Error('Invalid room');
  }
  const labor = object(room.labor) ? {
    ...numericFields(room.labor, ['totalDemands']), emergency: flag(room.labor.emergency),
    kinds: list(room.labor.kinds, 8).map(kind => {
      if (!object(kind) || !['refill', 'build', 'repair', 'upgrade'].includes(kind.kind)) throw new Error('Invalid labor');
      return { kind: text(kind.kind), capability: text(kind.capability), ...numericFields(kind, [
        'demands', 'minimum', 'desired', 'assigned', 'unsatisfied', 'unsatisfiedMinimum',
        'workers', 'boundedAssigned', 'surplusAssigned', 'acquiringWorkers', 'travelingWorkers',
        'workingWorkers', 'blockedWorkers', 'acceptedWorkIntents'
      ]) };
    })
  } : null;
  if (labor && new Set(labor.kinds.map(kind => kind.kind)).size !== labor.kinds.length) throw new Error('Duplicate labor kind');
  return {
    name: room.name,
    ...numericFields(room, ['rcl', 'progress', 'progressTotal', 'ticksToDowngrade', 'safeMode',
      'energyAvailable', 'energyCapacityAvailable', 'constructionSites', 'hostiles']),
    workerPopulation: object(room.workerPopulation) ? numericFields(room.workerPopulation,
      ['live', 'spawning', 'aging', 'effective', 'target', 'replacementLead']) : null,
    infrastructure: Object.fromEntries(['extensions', 'containers', 'towers', 'roads'].map(key => [key,
      object(room.infrastructure?.[key]) ? numericFields(room.infrastructure[key], ['built', 'sites', 'target']) : null])),
    spawns: list(room.spawns, 32).map(spawn => {
      if (!object(spawn)) throw new Error('Invalid spawn');
      return { name: text(spawn.name), ...numericFields(spawn, ['energy', 'energyCapacity']),
        spawning: object(spawn.spawning) ? { name: text(spawn.spawning.name),
          remainingTime: number(spawn.spawning.remainingTime) } : null };
    }),
    labor,
    safety: object(room.safety) ? { requested: flag(room.safety.requested), attempted: flag(room.safety.attempted),
      accepted: flag(room.safety.accepted), reason: text(room.safety.reason) } : null
  };
}

function creepProjection(creep) {
  if (!object(creep)) throw new Error('Invalid creep');
  return { ...Object.fromEntries(['name', 'room', 'kind', 'home', 'sourceId'].map(key => [key, text(creep[key])])),
    ...numericFields(creep, ['x', 'y', 'ttl', 'energy', 'energyCapacity']),
    spawning: flag(creep.spawning), working: flag(creep.working) };
}

export function projectRecord(item, request, compact = false) {
  try {
    const row = unmarshallItem(item);
    const suffix = request.action === 'latest' ? 'latest' : 'snapshot';
    if (row.schemaVersion !== 1 || row.shard !== request.shard || row.pk !== partitionKey(request) ||
        row.kind !== (request.room ? 'room-' : 'colony-') + suffix ||
        !Number.isSafeInteger(row.tick) || row.tick < 0 || typeof row.collectedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.collectedAt)) || new Date(row.collectedAt).toISOString() !== row.collectedAt ||
        row.sk !== (suffix === 'latest' ? 'LATEST' : 'SNAPSHOT#' + row.collectedAt) || !object(row.telemetry)) return null;
    const source = row.telemetry;
    if (!object(source.cpu)) return null;
    const rooms = request.room ? [roomProjection(source.room)] : list(source.rooms, LIMITS.rooms).map(roomProjection);
    if (new Set(rooms.map(room => room.name)).size !== rooms.length) return null;
    if (request.room && (row.roomName !== request.room || rooms[0].name !== request.room)) return null;
    if (!request.room && (source.schemaVersion !== 1 || source.sourceVersion !== 1 || source.tick !== row.tick)) return null;
    const errors = list(source.recentErrors, 12).map(error => {
      if (!object(error) || !Number.isSafeInteger(error.tick) || error.tick < 0) throw new Error('Invalid error');
      return { tick: error.tick, scope: text(error.scope), subject: text(error.subject), message: text(error.message) };
    });
    const creeps = list(source.creeps, 1000);
    const telemetry = {
      ...(!request.room ? { schemaVersion: 1, sourceVersion: 1, tick: row.tick } : {}),
      cpu: numericFields(source.cpu, ['used', 'limit', 'bucket']),
      ...(request.room ? { room: rooms[0] } : { rooms }),
      ...(compact ? { creepCount: creeps.length } : { creeps: creeps.map(creepProjection) }), recentErrors: errors
    };
    return { schemaVersion: 1, shard: row.shard, ...(request.room ? { room: request.room } : {}),
      tick: row.tick, collectedAt: row.collectedAt, telemetry };
  } catch { return null; }
}
