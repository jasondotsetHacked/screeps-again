import { gunzipSync } from 'node:zlib';

const TELEMETRY_SCHEMA_VERSION = 1;
const MAX_TEXT = 300;

function objectValue(value) {
  return typeof value === 'object' && value !== null ? value : null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value) {
  return value === true;
}

function stringValue(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT);
}

function normalizeStructure(value) {
  const source = objectValue(value);
  if (!source) return null;

  return {
    built: numberValue(source.built, 0),
    sites: numberValue(source.sites, 0),
    target: source.target === null ? null : numberValue(source.target, null)
  };
}

function normalizeWorkers(value) {
  const source = objectValue(value);
  if (!source) return null;

  return {
    live: numberValue(source.live, 0),
    spawning: numberValue(source.spawning, 0),
    aging: numberValue(source.aging, 0),
    effective: numberValue(source.effective, 0),
    target: numberValue(source.target, 0),
    replacementLead: numberValue(source.replacementLead, 0)
  };
}

function normalizeSpawn(value) {
  const source = objectValue(value);
  if (!source) return null;
  const spawning = objectValue(source.spawning);

  return {
    name: stringValue(source.name, 'unknown'),
    energy: numberValue(source.energy, 0),
    energyCapacity: numberValue(source.energyCapacity, null),
    spawning: spawning
      ? {
          name: stringValue(spawning.name, 'unknown'),
          remainingTime: numberValue(spawning.remainingTime, null)
        }
      : null
  };
}

function normalizeLabor(value) {
  const source = objectValue(value);
  if (!source) return null;

  return {
    totalDemands: numberValue(source.totalDemands, 0),
    emergency: booleanValue(source.emergency),
    kinds: arrayValue(source.kinds).slice(0, 8).map((entry) => {
      const item = objectValue(entry) ?? {};
      return {
        kind: stringValue(item.kind, 'unknown'),
        capability: stringValue(item.capability, 'unknown'),
        demands: numberValue(item.demands, 0),
        minimum: numberValue(item.minimum, 0),
        desired: numberValue(item.desired, 0),
        assigned: numberValue(item.assigned, 0),
        unsatisfied: numberValue(item.unsatisfied, 0),
        unsatisfiedMinimum: numberValue(item.unsatisfiedMinimum, 0),
        workers: numberValue(item.workers, 0),
        boundedAssigned: numberValue(item.boundedAssigned, 0),
        surplusAssigned: numberValue(item.surplusAssigned, 0),
        acquiringWorkers: numberValue(item.acquiringWorkers, 0),
        travelingWorkers: numberValue(item.travelingWorkers, 0),
        workingWorkers: numberValue(item.workingWorkers, 0),
        blockedWorkers: numberValue(item.blockedWorkers, 0),
        acceptedWorkIntents: numberValue(item.acceptedWorkIntents, 0)
      };
    })
  };
}

function normalizeRoom(value) {
  const source = objectValue(value);
  if (!source) return null;

  const infrastructure = objectValue(source.infrastructure) ?? {};
  const safety = objectValue(source.safety);

  return {
    name: stringValue(source.name, 'unknown'),
    rcl: numberValue(source.rcl, 0),
    progress: numberValue(source.progress, null),
    progressTotal: numberValue(source.progressTotal, null),
    ticksToDowngrade: numberValue(source.ticksToDowngrade, null),
    safeMode: numberValue(source.safeMode, null),
    energyAvailable: numberValue(source.energyAvailable, 0),
    energyCapacityAvailable: numberValue(source.energyCapacityAvailable, 0),
    constructionSites: numberValue(source.constructionSites, 0),
    hostiles: numberValue(source.hostiles, 0),
    workerPopulation: normalizeWorkers(source.workerPopulation),
    infrastructure: {
      extensions: normalizeStructure(infrastructure.extensions),
      containers: normalizeStructure(infrastructure.containers),
      towers: normalizeStructure(infrastructure.towers),
      roads: normalizeStructure(infrastructure.roads)
    },
    spawns: arrayValue(source.spawns).map(normalizeSpawn).filter(Boolean),
    labor: normalizeLabor(source.labor),
    safety: safety
      ? {
          requested: booleanValue(safety.requested),
          attempted: booleanValue(safety.attempted),
          accepted: booleanValue(safety.accepted),
          reason: stringValue(safety.reason, null)
        }
      : null
  };
}

function normalizeCreep(value) {
  const source = objectValue(value);
  if (!source) return null;

  return {
    name: stringValue(source.name, 'unknown'),
    room: stringValue(source.room, 'unknown'),
    x: numberValue(source.x, null),
    y: numberValue(source.y, null),
    ttl: numberValue(source.ttl, null),
    spawning: booleanValue(source.spawning),
    energy: numberValue(source.energy, 0),
    energyCapacity: numberValue(source.energyCapacity, null),
    kind: stringValue(source.kind, null),
    home: stringValue(source.home, null),
    working: source.working === null ? null : booleanValue(source.working),
    sourceId: stringValue(source.sourceId, null)
  };
}

function normalizeError(value) {
  const source = objectValue(value);
  if (!source) return null;

  return {
    tick: numberValue(source.tick, 0),
    scope: stringValue(source.scope, 'unknown'),
    subject: stringValue(source.subject, 'unknown'),
    message: stringValue(source.message, 'Unknown runtime error')
  };
}

export function decodeScreepsData(data) {
  if (typeof data !== 'string') return data;

  let value = data;
  if (value.startsWith('gz:')) {
    const compressed = Buffer.from(value.slice(3), 'base64');
    value = gunzipSync(compressed).toString('utf8');
  }

  return JSON.parse(value);
}

export function normalizeOpsMemory(raw) {
  const value = objectValue(raw);
  if (!value || value.version !== 1) return null;

  const snapshot = objectValue(value.snapshot);
  if (!snapshot) return null;

  const tick = numberValue(snapshot.tick, null);
  if (tick === null) return null;

  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    sourceVersion: 1,
    tick,
    cpu: {
      used: numberValue(snapshot.cpuUsed, 0),
      limit: numberValue(snapshot.cpuLimit, 0),
      bucket: numberValue(snapshot.bucket, 0)
    },
    rooms: arrayValue(snapshot.rooms).map(normalizeRoom).filter(Boolean),
    creeps: arrayValue(snapshot.creeps).map(normalizeCreep).filter(Boolean),
    recentErrors: arrayValue(value.recentErrors)
      .slice(-12)
      .map(normalizeError)
      .filter(Boolean)
  };
}

export function buildDynamoItems(
  telemetry,
  {
    shard,
    collectedAt = new Date().toISOString(),
    retentionDays = 30
  }
) {
  const collectedDate = new Date(collectedAt);
  if (Number.isNaN(collectedDate.getTime())) {
    throw new Error('collectedAt must be an ISO-compatible date');
  }

  const expiresAt =
    Math.floor(collectedDate.getTime() / 1000) +
    Math.max(1, retentionDays) * 24 * 60 * 60;
  const colonyPk = 'COLONY#' + shard;
  const historySk = 'SNAPSHOT#' + collectedDate.toISOString();

  const common = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    shard,
    tick: telemetry.tick,
    collectedAt: collectedDate.toISOString()
  };

  const items = [
    {
      ...common,
      pk: colonyPk,
      sk: historySk,
      kind: 'colony-snapshot',
      expiresAt,
      telemetry
    },
    {
      ...common,
      pk: colonyPk,
      sk: 'LATEST',
      kind: 'colony-latest',
      telemetry
    }
  ];

  for (const room of telemetry.rooms) {
    const roomPk = 'ROOM#' + shard + '#' + room.name;
    const roomCreeps = telemetry.creeps.filter(
      (creep) => creep.room === room.name || creep.home === room.name
    );
    const roomErrors = telemetry.recentErrors.filter(
      (error) => typeof error.subject === 'string' && error.subject.includes(room.name)
    );
    const roomTelemetry = {
      cpu: telemetry.cpu,
      room,
      creeps: roomCreeps,
      recentErrors: roomErrors
    };

    items.push(
      {
        ...common,
        pk: roomPk,
        sk: historySk,
        kind: 'room-snapshot',
        roomName: room.name,
        expiresAt,
        telemetry: roomTelemetry
      },
      {
        ...common,
        pk: roomPk,
        sk: 'LATEST',
        kind: 'room-latest',
        roomName: room.name,
        telemetry: roomTelemetry
      }
    );
  }

  return items;
}

function toAttribute(value) {
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };

  if (Array.isArray(value)) {
    return { L: value.map(toAttribute) };
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, toAttribute(child)]);
    return { M: Object.fromEntries(entries) };
  }

  throw new Error('Unsupported DynamoDB value type: ' + typeof value);
}

export function marshallItem(item) {
  return Object.fromEntries(
    Object.entries(item)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toAttribute(value)])
  );
}
