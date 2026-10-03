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

  type Service = WorkerAssignment['service'];
  const pass = (
    orderedDemands: readonly WorkDemand[],
    service: Service,
    priority: (demand: WorkDemand) => number,
    requested: (demand: WorkDemand) => number,
    maximum: (demand: WorkDemand) => number
  ): void => {
    // Compare worker/target pairs only within the current urgency tier. This
    // keeps survival precedence while giving nearby peer demands a fair chance.
    for (let start = 0; start < orderedDemands.length && available.size > 0;) {
      let end = start + 1;
      while (end < orderedDemands.length &&
        priority(orderedDemands[end]) === priority(orderedDemands[start])) end += 1;
      while (available.size > 0) {
        let best: { worker: ColonyWorker; demand: WorkDemand; amount: number } | undefined;
        let bestScore = -Infinity;
        for (let index = start; index < end; index += 1) {
          const demand = orderedDemands[index];
          const current = assigned.get(demand.id) ?? 0;
          const hardMaximum = maximum(demand);
          const goal = Math.min(requested(demand), hardMaximum);
          if (current >= goal) continue;
          for (const worker of available.values()) {
            const amount = contribution(worker, demand);
            if (worker.pos.roomName !== demand.target.pos.roomName || amount <= 0 ||
                current + amount > hardMaximum) continue;
            const range = demand.kind === 'refill' ? 1 : 3;
            const distance = Math.max(Math.abs(worker.pos.x - demand.target.pos.x),
              Math.abs(worker.pos.y - demand.target.pos.y));
            const ready = worker.energy > 0 && (worker.working || demand.emergency);
            if (worker.move <= 0 && (distance > range || !ready)) continue;
            const value = score(worker, demand, goal - current);
            const tie = best ? demand.id.localeCompare(best.demand.id) ||
              worker.name.localeCompare(best.worker.name) : -1;
            if (value > bestScore || (value === bestScore && tie < 0)) {
              best = { worker, demand, amount };
              bestScore = value;
            }
          }
        }
        if (!best) break;
        const { worker, demand, amount } = best;
        assigned.set(demand.id, (assigned.get(demand.id) ?? 0) + amount);
        available.delete(worker.name);
        assignments.push({
          creepName: worker.name, demandId: demand.id, kind: demand.kind,
          targetId: demand.target.id, capability: demand.capability,
          contribution: amount, emergency: Boolean(demand.emergency), service
        });
      }
      start = end;
    }
  };

  const normalPriority = (demand: WorkDemand): number => demand.priority;
  const normalMaximum = (demand: WorkDemand): number => demand.maximum ?? Infinity;
  pass(ordered, 'minimum', normalPriority,
    (demand) => Math.min(demand.minimum, demand.desired), normalMaximum);
  pass(ordered, 'desired', normalPriority, (demand) => demand.desired, normalMaximum);

  const surplus = ordered.filter((demand) =>
    demand.surplusPriority !== undefined && demand.surplusMaximum !== undefined
  ).sort((a, b) => b.surplusPriority! - a.surplusPriority! || a.id.localeCompare(b.id));
  pass(surplus, 'surplus', (demand) => demand.surplusPriority!,
    (demand) => demand.surplusMaximum!, (demand) => demand.surplusMaximum!);
  return assignments;
}
