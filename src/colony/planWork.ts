import { isControllerUrgent } from './controllerUrgency';
import type { WorkDemand } from '../work/demands';
import type { ColonyState } from './colonyState';

export function planWork(state: ColonyState): WorkDemand[] {
  const workers = state.workers.filter((worker) => worker.work > 0 && worker.carry > 0);
  const totalWork = workers.reduce((sum, worker) => sum + worker.work, 0);
  const largestWork = Math.max(1, ...workers.map((worker) => worker.work));
  const demands: WorkDemand[] = [];
  const controller = state.controller;
  if (controller?.my) {
    const emergency = isControllerUrgent(controller);
    // Use the live RCL downgrade limit. For example, RCL2's limit is 10,000
    // ticks (a newly leveled controller starts at 50% of that limit).
    // Absolute floors preserve headroom above the strict 3,000-tick emergency.
    const uncomfortable = Math.max(3500, controller.downgradeLimit * 0.5);
    const comfortable = Math.max(4000, controller.downgradeLimit * 0.8);
    const dangerous = controller.ticksToDowngrade < uncomfortable;
    const declining = controller.ticksToDowngrade < comfortable;
    const share = dangerous ? 0.45 : declining ? 0.3 : 0.2;

    // Whole workers cannot be divided. The normal maximum allows one body's
    // rounding slack while leaving at least the smallest worker available for
    // other bounded work when possible.
    const smallestWork = Math.min(largestWork, ...workers.map((worker) => worker.work));
    const budget = workers.length > 1 ? totalWork - smallestWork : totalWork;
    const desired = emergency
      ? totalWork
      : Math.min(budget, Math.max(1, Math.ceil(totalWork * share)));
    const normalMaximum = emergency
      ? totalWork
      : Math.min(budget, desired + largestWork - 1);

    demands.push({
      id: `upgrade:${controller.id}`,
      kind: 'upgrade',
      target: controller,
      priority: emergency ? 1000 : dangerous ? 95 : 60,
      minimum: emergency
        ? totalWork
        : dangerous
          ? Math.min(desired, Math.max(1, Math.ceil(totalWork * 0.3)))
          : Math.min(1, desired),
      desired,
      maximum: normalMaximum,
      capability: 'work',
      emergency,
      // Controller upgrading is the colony's safe productive sink for labor
      // that remains after all normal desired work is satisfied. Keeping this
      // explicit here prevents runWorker from growing a second task selector.
      surplusPriority: emergency || totalWork <= 0 ? undefined : 1,
      surplusMaximum: emergency || totalWork <= 0 ? undefined : totalWork
    });
  }

  const recovery =
    state.population.effectiveWorkers <=
    Math.max(1, Math.floor(state.population.target / 3));

  for (const target of state.refillTargets) {
    const tower = target.structureType === STRUCTURE_TOWER;
    const priority = tower
      ? (state.hostiles.length ? 98 : 80)
      : recovery
        ? 99
        : target.structureType === STRUCTURE_SPAWN
          ? 90
          : 89;
    const desired = Math.ceil(target.freeEnergy / 50);
    demands.push({
      id: `refill:${target.id}`,
      kind: 'refill',
      target,
      priority,
      minimum: (!tower && recovery) || (tower && state.hostiles.length) ? 1 : 0,
      desired,
      capability: 'carry'
    });
  }

  for (const target of state.buildTargets) {
    const priority =
      target.structureType === STRUCTURE_EXTENSION
        ? 55
        : target.structureType === STRUCTURE_TOWER
          ? 54
          : target.structureType === STRUCTURE_CONTAINER
            ? 53
            : target.structureType === STRUCTURE_ROAD
              ? 30
              : 52;
    demands.push({
      id: `build:${target.id}`,
      kind: 'build',
      target,
      priority,
      minimum: 0,
      desired: Math.min(
        Math.max(1, Math.ceil(totalWork * 0.4)),
        Math.ceil(target.remaining / BUILD_POWER)
      ),
      capability: 'work'
    });
  }

  for (const target of state.repairTargets) {
    demands.push({
      id: `repair:${target.id}`,
      kind: 'repair',
      target,
      priority: 40 + (1 - target.health),
      minimum: 0,
      desired: Math.min(
        Math.max(1, Math.ceil(totalWork * 0.2)),
        Math.ceil(target.missingHits / REPAIR_POWER)
      ),
      capability: 'work'
    });
  }

  return demands.filter((demand) => demand.desired > 0);
}
