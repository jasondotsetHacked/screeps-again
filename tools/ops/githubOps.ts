import { writeFile } from 'node:fs/promises';
import { getScreepsClient, withScreepsRetry } from '../lib/screepsClient';
import { opsHelp, parseOpsCommand } from './commands';

const RESPONSE_FILE = '.ops-response.md';
const shard = process.env.SCREEPS_OPS_SHARD ?? 'shard3';
const rawCommand = process.env.SCREEPS_OPS_COMMAND ?? '';

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n|]+/g, ' ')
    .replace(/@/g, '@\u200b')
    .replace(/\x60/g, "'")
    .slice(0, 300);
}

function parseOpsMemory(data: unknown): OpsMemory | null {
  let value = data;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    (value as { version?: unknown }).version !== 1
  ) {
    return null;
  }

  return value as OpsMemory;
}

function formatErrors(ops: OpsMemory): string {
  const errors = ops.recentErrors.slice(-5);
  if (errors.length === 0) return 'Recent runtime errors: none';

  return [
    'Recent runtime errors:',
    ...errors.map(
      (error) =>
        '- tick ' +
        error.tick +
        ' [' +
        clean(error.scope) +
        '] ' +
        clean(error.subject) +
        ': ' +
        clean(error.message)
    )
  ].join('\n');
}

function structureProgressText(
  progress: OpsStructureProgressSnapshot | undefined
): string {
  if (!progress) return 'n/a';

  const target = progress.target === null ? '' : '/' + progress.target;
  return progress.built + target + ' built; ' + progress.sites + ' sites';
}

function compactStructureProgress(
  progress: OpsStructureProgressSnapshot | undefined
): string {
  if (!progress) return '?';

  const target = progress.target === null ? '' : '/' + progress.target;
  const sites = progress.sites > 0 ? ' +' + progress.sites : '';
  return progress.built + target + sites;
}

function workerPopulationText(
  population: OpsWorkerPopulationSnapshot | undefined
): string {
  if (!population) return 'n/a';

  return (
    'effective ' +
    population.effective +
    '/' +
    population.target +
    '; live ' +
    population.live +
    '; aging ' +
    population.aging +
    '; spawning ' +
    population.spawning +
    '; replacement lead ' +
    population.replacementLead
  );
}

function formatCpu(snapshot: OpsSnapshot): string {
  return [
    '### Screeps CPU — ' + shard,
    '',
    '- Tick: **' + snapshot.tick + '**',
    '- CPU: **' + snapshot.cpuUsed.toFixed(2) + ' / ' + snapshot.cpuLimit + '**',
    '- Bucket: **' + snapshot.bucket + ' / 10000**'
  ].join('\n');
}

function formatCreep(creep: OpsCreepSnapshot, tick: number): string {
  return [
    '### Creep: ' + clean(creep.name),
    '',
    '- Snapshot tick: **' + tick + '**',
    '- Room/position: **' + clean(creep.room) + ' ' + creep.x + ',' + creep.y + '**',
    '- TTL: **' + (creep.ttl ?? 'n/a') + '**',
    '- Energy: **' + creep.energy + '/' + (creep.energyCapacity ?? '?') + '**',
    '- Role/home: **' + clean(creep.kind ?? 'none') + ' / ' + clean(creep.home ?? 'none') + '**',
    '- State: **' + (creep.spawning ? 'spawning' : creep.working ? 'working' : 'harvesting') + '**',
    '- Source assignment: **' + clean(creep.sourceId ?? 'none') + '**'
  ].join('\n');
}

function laborText(labor: OpsLaborSnapshot | undefined): string {
  if (!labor) return 'n/a';
  return labor.totalDemands + ' demands' + (labor.emergency ? '; controller emergency' : '') + '; ' +
    labor.kinds.slice(0, 4).map((entry) => clean(entry.kind) + ': ' +
      entry.workers + ' workers, ' + entry.assigned + '/' + entry.desired + ' ' + clean(entry.capability) +
      ', minimum ' + entry.minimum + ', unmet ' + entry.unsatisfied +
      ' (minimum ' + entry.unsatisfiedMinimum + ')').join('; ');
}

function formatRoom(room: OpsRoomSnapshot, snapshot: OpsSnapshot): string {
  const roomCreeps = snapshot.creeps.filter(
    (creep) => creep.room === room.name || creep.home === room.name
  );

  const spawnText =
    room.spawns.length === 0
      ? 'none'
      : room.spawns
          .map((spawn) => {
            const activity = spawn.spawning
              ? 'spawning ' +
                clean(spawn.spawning.name) +
                ' (' +
                spawn.spawning.remainingTime +
                ' ticks)'
              : 'idle';
            return (
              clean(spawn.name) +
              ' ' +
              spawn.energy +
              '/' +
              (spawn.energyCapacity ?? '?') +
              '; ' +
              activity
            );
          })
          .join('; ');

  return [
    '### Room: ' + clean(room.name),
    '',
    '- Snapshot tick: **' + snapshot.tick + '**',
    '- RCL: **' + room.rcl + '** (' + (room.progress ?? '?') + '/' + (room.progressTotal ?? '?') + ')',
    '- Energy: **' + room.energyAvailable + '/' + room.energyCapacityAvailable + '**',
    '- Controller downgrade: **' + (room.ticksToDowngrade ?? 'n/a') + ' ticks**',
    '- Safe mode: **' + (room.safeMode ?? 'inactive') + '**',
    '- Worker population: **' + workerPopulationText(room.workerPopulation) + '**',
    '- Labor: ' + laborText(room.labor),
    '- Extensions: **' + structureProgressText(room.infrastructure?.extensions) + '**',
    '- Containers: **' + structureProgressText(room.infrastructure?.containers) + '**',
    '- Towers: **' + structureProgressText(room.infrastructure?.towers) + '**',
    '- Roads: **' + structureProgressText(room.infrastructure?.roads) + '**',
    '- Construction sites: **' + room.constructionSites + '**',
    '- Hostile creeps: **' + room.hostiles + '**',
    '- Spawns: ' + spawnText,
    '- Creeps associated with room: **' + roomCreeps.length + '**'
  ].join('\n');
}

function formatSnapshot(ops: OpsMemory): string {
  const snapshot = ops.snapshot;
  if (!snapshot) {
    return '### Screeps Ops\n\nNo runtime snapshot has been published yet.';
  }

  const rooms = snapshot.rooms.length
    ? snapshot.rooms
        .map(
          (room) =>
            '| ' +
            clean(room.name) +
            ' | ' +
            room.rcl +
            ' | ' +
            (room.progress ?? '?') +
            '/' +
            (room.progressTotal ?? '?') +
            ' | ' +
            room.energyAvailable +
            '/' +
            room.energyCapacityAvailable +
            ' | ' +
            (room.workerPopulation
              ? room.workerPopulation.effective + '/' + room.workerPopulation.target
              : '?') +
            ' | ' +
            compactStructureProgress(room.infrastructure?.extensions) +
            ' | ' +
            compactStructureProgress(room.infrastructure?.containers) +
            ' | ' +
            room.constructionSites +
            ' | ' +
            room.hostiles +
            ' |'
        )
        .join('\n')
    : '| none | - | - | - | - | - | - | - | - |';

  const progress = snapshot.rooms.length
    ? snapshot.rooms
        .map(
          (room) =>
            '- **' +
            clean(room.name) +
            '** — controller ' +
            (room.ticksToDowngrade ?? 'n/a') +
            ' ticks; workers ' +
            workerPopulationText(room.workerPopulation) +
            '; extensions ' +
            structureProgressText(room.infrastructure?.extensions) +
            '; containers ' +
            structureProgressText(room.infrastructure?.containers) +
            '; towers ' +
            structureProgressText(room.infrastructure?.towers) +
            '; roads ' +
            structureProgressText(room.infrastructure?.roads) +
            '; labor ' + laborText(room.labor)
        )
        .join('\n')
    : '- none';

  const creeps = snapshot.creeps.length
    ? snapshot.creeps
        .map(
          (creep) =>
            '- **' +
            clean(creep.name) +
            '** — ' +
            clean(creep.room) +
            ' ' +
            creep.x +
            ',' +
            creep.y +
            '; TTL ' +
            (creep.ttl ?? '?') +
            '; energy ' +
            creep.energy +
            '/' +
            (creep.energyCapacity ?? '?') +
            '; ' +
            clean(creep.kind ?? 'unassigned')
        )
        .join('\n')
    : '- none';

  return [
    '### Screeps snapshot — ' + shard,
    '',
    '- Tick: **' + snapshot.tick + '**',
    '- CPU: **' + snapshot.cpuUsed.toFixed(2) + ' / ' + snapshot.cpuLimit + '**',
    '- Bucket: **' + snapshot.bucket + ' / 10000**',
    '- Owned rooms: **' + snapshot.rooms.length + '**',
    '- Creeps: **' + snapshot.creeps.length + '**',
    '',
    '| Room | RCL | Progress | Energy | Workers | Ext | Containers | Sites | Hostiles |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    rooms,
    '',
    '#### Colony progress',
    progress,
    '',
    '#### Creeps',
    creeps,
    '',
    formatErrors(ops),
    '',
    '_Sanitized operational telemetry. This repository and issue are public._'
  ].join('\n');
}

async function main(): Promise<void> {
  const command = parseOpsCommand(rawCommand);

  if (!command) {
    await writeFile(
      RESPONSE_FILE,
      [
        '### Screeps Ops',
        '',
        'Command rejected. Only the read-only allowlist is supported.',
        '',
        opsHelp()
      ].join('\n'),
      'utf8'
    );
    process.exitCode = 2;
    return;
  }

  if (command.type === 'help') {
    await writeFile(RESPONSE_FILE, opsHelp(), 'utf8');
    return;
  }

  const api = getScreepsClient();
  const response = await withScreepsRetry(
    () => api.userMemoryGet('ops', shard),
    'ops telemetry on ' + shard
  );

  const ops = parseOpsMemory(response.data);
  if (!ops?.snapshot) {
    await writeFile(
      RESPONSE_FILE,
      '### Screeps Ops — ' +
        shard +
        '\n\nNo valid ops snapshot is available yet. The runtime may not have published one since the latest deploy.',
      'utf8'
    );
    process.exitCode = 3;
    return;
  }

  let output: string;

  switch (command.type) {
    case 'snapshot':
      output = formatSnapshot(ops);
      break;

    case 'cpu':
      output = formatCpu(ops.snapshot);
      break;

    case 'room': {
      const room = ops.snapshot.rooms.find(
        (candidate) => candidate.name === command.roomName
      );
      output = room
        ? formatRoom(room, ops.snapshot)
        : '### Screeps room\n\nRoom ' +
          clean(command.roomName) +
          ' is not present in the current owned-room snapshot.';
      break;
    }

    case 'creep': {
      const creep = ops.snapshot.creeps.find(
        (candidate) => candidate.name === command.creepName
      );
      output = creep
        ? formatCreep(creep, ops.snapshot.tick)
        : '### Screeps creep\n\nCreep ' +
          clean(command.creepName) +
          ' is not present in the current snapshot.';
      break;
    }

    default:
      output = opsHelp();
      break;
  }

  await writeFile(RESPONSE_FILE, output, 'utf8');
}

main().catch(async (error: unknown) => {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : null;

  const message =
    error instanceof Error
      ? error.message
      : 'Unknown Screeps API error';

  await writeFile(
    RESPONSE_FILE,
    [
      '### Screeps Ops query failed',
      '',
      '- HTTP status: **' + (status ?? 'unknown') + '**',
      '- Error: ' + clean(message),
      '',
      'No response headers, request headers, tokens, or raw API objects are included.'
    ].join('\n'),
    'utf8'
  );

  process.exitCode = 1;
});
