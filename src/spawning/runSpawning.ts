import { buildWorkerBody, replacementLeadTicks } from './workerBody';
import { planWorkerPopulation, planWorkerSpawn, workerTarget } from './workerPlan';

function spawnWorker(
  spawn: StructureSpawn,
  room: Room,
  body: BodyPartConstant[]
): ScreepsReturnCode {
  const name = `worker-${room.name}-${Game.time.toString(36)}`;
  return spawn.spawnCreep(body, name, {
    memory: {
      kind: 'worker',
      home: room.name,
      working: false,
      born: Game.time
    }
  });
}

export function runSpawning(room: Room): void {
  const spawns = room
    .find(FIND_MY_STRUCTURES)
    .filter(
      (structure): structure is StructureSpawn =>
        structure.structureType === STRUCTURE_SPAWN
    );

  const availableSpawn = spawns.find((spawn) => !spawn.spawning);
  if (!availableSpawn) return;

  const plannedBody = buildWorkerBody(room.energyCapacityAvailable);
  if (plannedBody.length === 0) return;

  const lead = replacementLeadTicks(plannedBody);
  const population = planWorkerPopulation({
    roomName: room.name,
    workers: Object.values(Game.creeps),
    spawning: spawns.flatMap((spawn) => {
      const name = spawn.spawning?.name;
      return name ? [{ name, memory: Memory.creeps[name] }] : [];
    }),
    replacementLead: lead,
    target: workerTarget(room.find(FIND_SOURCES).length, room.energyCapacityAvailable)
  });
  const plan = planWorkerSpawn(
    population, room.energyAvailable, room.energyCapacityAvailable
  );
  if (!plan) return;

  const result = spawnWorker(availableSpawn, room, plan.body);

  if (result === OK) {
    if (plan.reason !== 'normal') {
      console.log(
        `[spawn] ${room.name} recovery=${plan.reason}; effective=${population.effectiveWorkers}/${population.target}; body=${plan.body.join(',')}; budget=${plan.energyBudget}; cost=${plan.cost}`
      );
    } else {
      console.log(
        `[spawn] ${room.name} worker ${population.effectiveWorkers + 1}/${population.target}; replacement lead=${lead} ticks`
      );
    }
  }
}
