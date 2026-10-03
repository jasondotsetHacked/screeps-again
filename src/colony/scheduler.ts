import type { WorkerAssignment } from '../work/assignments';
import type { WorkDemand } from '../work/demands';
import type { ColonyState, ColonyWorker } from './colonyState';

function contribution(worker: ColonyWorker, demand: WorkDemand): number {
  if (worker.carry <= 0 || worker.work <= 0) return 0;
  return worker[demand.capability];
}

function score(
  worker: ColonyWorker,
  demand: WorkDemand,
  remaining: number
): number {
  const distance = Math.max(
    Math.abs(worker.pos.x - demand.target.pos.x),
    Math.abs(worker.pos.y - demand.target.pos.y)
  );
  const capacity = contribution(worker, demand);

  // Readiness and proximity reduce travel churn without storing assignments.
  // Oversized bodies are less attractive for small budgets.
  return (
    (worker.energy > 0 && (worker.working || demand.emergency) ? 20 : 0) -
    distance -
    Math.max(0, capacity - remaining) * 2 +
    Math.min(capacity, remaining)
  );
}

export function scheduleWorkers(
  state: Pick<ColonyState, 'workers'>,
  demands: readonly WorkDemand[]
): WorkerAssignment[] {
  const ordered = [...demands].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id)
  );
  const available = new Map(
    state.workers.map((worker) => [worker.name, worker])
  );
  const assigned = new Map<string, number>();
  const assignments: WorkerAssignment[] = [];

  const fill = (
    demand: WorkDemand,
    requested: number,
    hardMaximum = demand.maximum ?? Infinity
  ): void => {
    const goal = Math.min(requested, hardMaximum);

    while ((assigned.get(demand.id) ?? 0) < goal) {
      const current = assigned.get(demand.id) ?? 0;
      let best: ColonyWorker | undefined;
      let bestScore = -Infinity;

      for (const worker of available.values()) {
        const amount = contribution(worker, demand);
        if (
          worker.pos.roomName !== demand.target.pos.roomName ||
          amount <= 0 ||
          current + amount > hardMaximum
        ) {
          continue;
        }

        // Immobile workers can act in range, but cannot acquire energy yet.
        const range = demand.kind === 'refill' ? 1 : 3;
        const distance = Math.max(
          Math.abs(worker.pos.x - demand.target.pos.x),
          Math.abs(worker.pos.y - demand.target.pos.y)
        );
        const ready =
          worker.energy > 0 && (worker.working || demand.emergency);
        if (worker.move <= 0 && (distance > range || !ready)) continue;

        const value = score(worker, demand, goal - current);
        if (
          value > bestScore ||
          (value === bestScore &&
            (!best || worker.name.localeCompare(best.name) < 0))
        ) {
          best = worker;
          bestScore = value;
        }
      }

      if (!best) break;

      const amount = contribution(best, demand);
      assigned.set(demand.id, current + amount);
      available.delete(best.name);
      assignments.push({
        creepName: best.name,
        demandId: demand.id,
        kind: demand.kind,
        targetId: demand.target.id,
        capability: demand.capability,
        contribution: amount,
        emergency: Boolean(demand.emergency)
      });
    }
  };

  // Reserve minimum service before optional throughput can consume workers.
  for (const demand of ordered) {
    fill(demand, Math.min(demand.minimum, demand.desired));
  }

  // Fill the bounded desired plan in normal priority order.
  for (const demand of ordered) {
    fill(demand, demand.desired);
  }

  // Only after every bounded desired demand has had a chance to schedule may
  // explicitly opt-in demands absorb otherwise-idle labor. This keeps useful
  // fallback work in colony planning rather than inside creep execution.
  const surplus = ordered
    .filter(
      (demand) =>
        demand.surplusPriority !== undefined &&
        demand.surplusMaximum !== undefined
    )
    .sort(
      (a, b) =>
        (b.surplusPriority ?? -Infinity) -
          (a.surplusPriority ?? -Infinity) ||
        a.id.localeCompare(b.id)
    );

  for (const demand of surplus) {
    fill(
      demand,
      demand.surplusMaximum ?? demand.desired,
      demand.surplusMaximum ?? demand.maximum ?? Infinity
    );
  }

  return assignments;
}
