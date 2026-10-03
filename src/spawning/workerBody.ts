export const WORKER_UNIT: BodyPartConstant[] = [WORK, CARRY, MOVE];
export const WORKER_UNIT_COST = 200;

export function buildWorkerBody(energyBudget: number): BodyPartConstant[] {
  if (energyBudget < WORKER_UNIT_COST) return [];

  const body: BodyPartConstant[] = [];
  const cappedBudget = Math.min(energyBudget, 1200);

  while (
    body.length + WORKER_UNIT.length <= 18 &&
    (body.length / WORKER_UNIT.length + 1) * WORKER_UNIT_COST <= cappedBudget
  ) {
    body.push(...WORKER_UNIT);
  }

  return body;
}

export function bodyCost(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

export function replacementLeadTicks(
  body: BodyPartConstant[],
  expectedTravelTicks = 30,
  safetyBufferTicks = 20
): number {
  return body.length * CREEP_SPAWN_TIME + expectedTravelTicks + safetyBufferTicks;
}
