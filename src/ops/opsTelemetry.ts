import type { ColonyTick } from '../colony/runColony';
import { buildWorkerBody, replacementLeadTicks } from '../spawning/workerBody';
import { planWorkerPopulation, workerTarget } from '../spawning/workerPlan';

const OPS_VERSION = 1 as const;
const SNAPSHOT_INTERVAL = 10;
const MAX_RECENT_ERRORS = 12;
const MAX_ERROR_LENGTH = 300;

function ensureOpsMemory(): OpsMemory {
  if (!Memory.ops || Memory.ops.version !== OPS_VERSION) {
    Memory.ops = {
      version: OPS_VERSION,
      recentErrors: []
    };
  }

  return Memory.ops;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

function countByType(
  items: readonly { structureType: StructureConstant }[],
  structureType: StructureConstant
): number {
  return items.filter((item) => item.structureType === structureType).length;
}

function structureProgress(
  structures: readonly Structure[],
  sites: readonly ConstructionSite[],
  structureType: StructureConstant,
  target: number | null
): OpsStructureProgressSnapshot {
  return {
    built: countByType(structures, structureType),
    sites: countByType(sites, structureType),
    target
  };
}

export function recordOpsError(
  scope: OpsErrorRecord['scope'],
  subject: string,
  error: unknown
): void {
  const ops = ensureOpsMemory();

  ops.recentErrors.push({
    tick: Game.time,
    scope,
    subject,
    message: errorMessage(error)
  });

  if (ops.recentErrors.length > MAX_RECENT_ERRORS) {
    ops.recentErrors.splice(
      0,
      ops.recentErrors.length - MAX_RECENT_ERRORS
    );
  }
}

export function publishOpsSnapshot(
  ownedRooms: Room[],
  cpuStart: number,
  colonies: ReadonlyMap<string, ColonyTick> = new Map()
): void {
  const ops = ensureOpsMemory();

  if (ops.snapshot && Game.time % SNAPSHOT_INTERVAL !== 0) {
    return;
  }

  const gameCreeps = Object.values(Game.creeps);

  const rooms: OpsRoomSnapshot[] = ownedRooms.map((room) => {
    const colony = colonies.get(room.name);
    const state = colony?.state;
    const controller = room.controller;
    const rcl = controller?.level ?? 0;
    const spawns = state?.spawns ?? room.find(FIND_MY_SPAWNS);
    const structures = state?.structures ?? room.find(FIND_STRUCTURES);
    const sites = state?.constructionSites ?? room.find(FIND_MY_CONSTRUCTION_SITES);
    const sources = state?.sources ?? room.find(FIND_SOURCES);

    const plannedBody = buildWorkerBody(room.energyCapacityAvailable);
    const replacementLead = state?.replacementLead ?? (plannedBody.length > 0
      ? replacementLeadTicks(plannedBody)
      : 0);
    const population = state?.population ?? planWorkerPopulation({
      roomName: room.name,
      workers: gameCreeps,
      spawning: spawns.flatMap((spawn) => {
        const name = spawn.spawning?.name;
        return name ? [{ name, memory: Memory.creeps[name] }] : [];
      }),
      replacementLead,
      target: workerTarget(sources.length, room.energyCapacityAvailable)
    });

    const extensionTarget =
      CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] ?? 0;
    const towerTarget =
      CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] ?? 0;
    const containerTarget = rcl >= 2 ? sources.length : 0;

    return {
      name: room.name,
      rcl,
      progress: controller?.progress ?? null,
      progressTotal: controller?.progressTotal ?? null,
      ticksToDowngrade: controller?.ticksToDowngrade ?? null,
      safeMode: controller?.safeMode ?? null,
      energyAvailable: room.energyAvailable,
      energyCapacityAvailable: room.energyCapacityAvailable,
      constructionSites: sites.length,
      hostiles: state?.hostiles.length ?? room.find(FIND_HOSTILE_CREEPS).length,
      labor: colony ? summarizeLabor(colony) : undefined,
      spawns: spawns.map((spawn) => ({
        name: spawn.name,
        energy: spawn.store.getUsedCapacity(RESOURCE_ENERGY),
        energyCapacity: spawn.store.getCapacity(RESOURCE_ENERGY),
        spawning: spawn.spawning
          ? {
              name: spawn.spawning.name,
              remainingTime: spawn.spawning.remainingTime
            }
          : null
      })),
      workerPopulation: {
        live: population.liveWorkers,
        spawning: population.spawningWorkers,
        aging: population.agingWorkers,
        effective: population.effectiveWorkers,
        target: population.target,
        replacementLead
      },
      infrastructure: {
        extensions: structureProgress(
          structures,
          sites,
          STRUCTURE_EXTENSION,
          extensionTarget
        ),
        containers: structureProgress(
          structures,
          sites,
          STRUCTURE_CONTAINER,
          containerTarget
        ),
        towers: structureProgress(
          structures,
          sites,
          STRUCTURE_TOWER,
          towerTarget
        ),
        roads: structureProgress(
          structures,
          sites,
          STRUCTURE_ROAD,
          null
        )
      }
    };
  });

  const creeps: OpsCreepSnapshot[] = gameCreeps.map(
    (creep) => ({
      name: creep.name,
      room: creep.room.name,
      x: creep.pos.x,
      y: creep.pos.y,
      ttl: creep.ticksToLive ?? null,
      spawning: creep.spawning,
      energy: creep.store.getUsedCapacity(RESOURCE_ENERGY),
      energyCapacity: creep.store.getCapacity(RESOURCE_ENERGY),
      kind: creep.memory.kind ?? null,
      home: creep.memory.home ?? null,
      working: creep.memory.working ?? null,
      sourceId: creep.memory.sourceId?.toString() ?? null
    })
  );

  ops.snapshot = {
    tick: Game.time,
    cpuUsed: Number((Game.cpu.getUsed() - cpuStart).toFixed(2)),
    cpuLimit: Game.cpu.limit,
    bucket: Game.cpu.bucket,
    rooms,
    creeps
  };
}

// Four fixed kind summaries, no target IDs, creep assignments, or raw objects.
export function summarizeLabor(colony: ColonyTick): OpsLaborSnapshot {
  return {
    totalDemands: colony.demands.length,
    emergency: colony.demands.some((demand) => demand.emergency),
    kinds: (['refill', 'build', 'repair', 'upgrade'] as const).map((kind) => {
      const demands = colony.demands.filter((demand) => demand.kind === kind);
      const assignments = colony.assignments.filter((assignment) => assignment.kind === kind);
      const contribution = new Map<string, number>();
      for (const assignment of assignments) {
        contribution.set(assignment.demandId, (contribution.get(assignment.demandId) ?? 0) + assignment.contribution);
      }
      return {
        kind, capability: kind === 'refill' ? 'carry' : 'work',
        demands: demands.length,
        minimum: demands.reduce((sum, demand) => sum + demand.minimum, 0),
        desired: demands.reduce((sum, demand) => sum + demand.desired, 0),
        assigned: assignments.reduce((sum, assignment) => sum + assignment.contribution, 0),
        unsatisfied: demands.reduce((sum, demand) => sum + Math.max(0, demand.desired - (contribution.get(demand.id) ?? 0)), 0),
        unsatisfiedMinimum: demands.reduce((sum, demand) => sum + Math.max(0, demand.minimum - (contribution.get(demand.id) ?? 0)), 0),
        workers: assignments.length
      };
    })
  };
}
