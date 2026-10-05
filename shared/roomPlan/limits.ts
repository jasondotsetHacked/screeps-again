/** World structure limits, also usable in offline reconciliation without runtime globals. */
export const structureLimits: Record<string, readonly number[]> = {
  spawn: [0, 1, 1, 1, 1, 1, 1, 2, 3], extension: [0, 0, 5, 10, 20, 30, 40, 50, 60],
  tower: [0, 0, 0, 1, 1, 2, 2, 3, 6], link: [0, 0, 0, 0, 0, 2, 3, 4, 6],
  storage: [0, 0, 0, 0, 1, 1, 1, 1, 1], terminal: [0, 0, 0, 0, 0, 0, 1, 1, 1],
  factory: [0, 0, 0, 0, 0, 0, 0, 1, 1], powerSpawn: [0, 0, 0, 0, 0, 0, 0, 0, 1],
  observer: [0, 0, 0, 0, 0, 0, 0, 0, 1], nuker: [0, 0, 0, 0, 0, 0, 0, 0, 1],
  container: [5, 5, 5, 5, 5, 5, 5, 5, 5], road: [2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500],
  lab: [0, 0, 0, 0, 0, 0, 3, 6, 10], extractor: [0, 0, 0, 0, 0, 0, 1, 1, 1]
};
export function limitsAt(rcl: number): Record<string, number> {
  return Object.fromEntries(Object.entries(structureLimits).map(([type, limits]) => [type, limits[rcl] ?? 0]));
}
