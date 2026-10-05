import { key } from './grid';
import { compatible } from './planRoom';
import type { PlannedStructure, RoomAsset, RoomPlan } from './types';

export interface ReconcileResult { missing: PlannedStructure[]; conflicts: string[] }
/** Read-only reconciliation. Legacy assets still consume live RCL limits. */
export function reconcilePlan(plan: Omit<RoomPlan, 'assets' | 'routes'>, assets: readonly RoomAsset[], rcl: number,
  limits: Readonly<Record<string, number>>, maxNew = 4, roadsEnabled = true): ReconcileResult {
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const conflicts: string[] = [], missing: PlannedStructure[] = [];
  const scheduled = new Set<number>();
  if (plan.version !== 1) return { missing, conflicts: ['unsupported-plan-version'] };
  if (!plan.feasibility.complete || plan.feasibility.reasons.length) return { missing, conflicts: ['incomplete-plan'] };
  for (const s of plan.structures) {
    if (s.minRcl > rcl || s.type === 'road' && !roadsEnabled) continue;
    if (scheduled.has(key(s))) continue; // Even compatible types cannot have simultaneous sites.
    const at = assets.filter((a) => key(a) === key(s));
    if (at.some((a) => a.type === s.type)) continue;
    if (at.some((a) => !compatible(s.type, a)) || at.some((a) => a.site)) {
      conflicts.push(`${s.type}@${s.x},${s.y}:occupied`); continue;
    }
    if ((counts.get(s.type) ?? 0) >= (limits[s.type] ?? 0)) continue;
    if (s.priority > 10 && s.type !== 'storage' && (counts.get('extension') ?? 0) < (limits.extension ?? 0)) continue;
    if (s.priority > 30 && (counts.get('tower') ?? 0) < (limits.tower ?? 0)) continue;
    if (missing.length >= maxNew) continue;
    missing.push(s); scheduled.add(key(s)); counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  }
  return { missing, conflicts };
}
