import type { ColonyState } from './colonyState';
import { safetyRange, type CriticalTarget, type HostileThreat } from './safetyState';

// Twenty ticks gives an exposed critical structure a response buffer while
// avoiding charges for slow damage against a healthy structure or barrier.
export const SAFETY_DAMAGE_HORIZON = 20;

export interface SafetyRequest {
  roomName: string;
  controllerId: string;
  targetId: string;
  threat: 'controller-claim' | 'critical-structure-threat';
  deadline: number;
  value: number;
  rcl: number;
}

export interface SafetyPlan {
  request?: SafetyRequest;
  reason: 'no-controller' | 'already-protected' | 'no-immediate-threat' |
    'defenses-sufficient' | 'unavailable' | 'cooldown' | 'upgrade-blocked' |
    'downgrade-blocked' | 'safe-mode-elsewhere' | 'arbitration-deferred' |
    SafetyRequest['threat'];
}

export interface SafetyOutcome extends SafetyPlan {
  attempted: boolean;
  accepted: boolean;
}

export function compareSafetyRequests(a: SafetyRequest, b: SafetyRequest): number {
  return a.deadline - b.deadline || b.value - a.value || b.rcl - a.rcl ||
    a.roomName.localeCompare(b.roomName) || a.targetId.localeCompare(b.targetId);
}

type SafetyState = Pick<ColonyState, 'room' | 'controller' | 'hostileThreats' | 'criticalTargets' | 'defenseTowers'>;

function damage(hostile: HostileThreat, target: CriticalTarget): number {
  const range = safetyRange(hostile.pos, target.pos);
  const step = hostile.canMove ? 1 : 0;
  return (range <= 1 + step ? Math.max(hostile.melee, hostile.dismantle) : 0) +
    (range <= 3 + step ? hostile.ranged : 0);
}

function towerRemoval(state: SafetyState): ReadonlySet<string> {
  const damageByHostile = new Map<string, number>();
  for (const tower of state.defenseTowers) {
    if (!tower.active || !tower.unmodified || tower.energy < TOWER_ENERGY_COST) continue;
    // Match the existing tower policy: each attacks its closest hostile.
    let closest: HostileThreat | undefined;
    for (const candidate of state.hostileThreats) {
      if (!closest || safetyRange(tower.pos, candidate.pos) < safetyRange(tower.pos, closest.pos)) closest = candidate;
    }
    if (!closest || closest.shielded) continue;
    const range = Math.min(TOWER_FALLOFF_RANGE, safetyRange(tower.pos, closest.pos));
    const falloff = Math.max(0, range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
    const output = Math.floor(TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * falloff)) * closest.towerDamageFactor;
    damageByHostile.set(closest.id, (damageByHostile.get(closest.id) ?? 0) + output);
  }
  const removable = new Set<string>();
  for (const hostile of state.hostileThreats) {
    const output = damageByHostile.get(hostile.id) ?? 0;
    if (output <= 0) continue;
    const healing = state.hostileThreats.reduce((sum, healer) => {
      const range = safetyRange(healer.pos, hostile.pos);
      return sum + (range <= 1 ? healer.heal : range <= 3 ? healer.rangedHeal : 0);
    }, 0);
    if (output >= hostile.hits + healing) removable.add(hostile.id);
  }
  return removable;
}

export function planSafety(state: SafetyState): SafetyPlan {
  const controller = state.controller;
  const none = (reason: SafetyPlan['reason']): SafetyPlan => ({ reason });
  if (!controller?.my) return none('no-controller');
  if (controller.safeMode > 0) return none('already-protected');
  let best: SafetyRequest | undefined;
  let nearbyThreat = false;
  const removable = towerRemoval(state);
  for (const target of state.criticalTargets) {
    let deadline: number;
    let threat: SafetyRequest['threat'];
    if (target.kind === 'controller') {
      const claimers = state.hostileThreats.filter((hostile) => hostile.claim > 0 &&
        (safetyRange(hostile.pos, target.pos) <= 1 || hostile.controllerApproach));
      if (claimers.length === 0) continue;
      // Never rely on a same-tick tower kill to prevent controller blocking.
      // At range two, protect before movement enters next tick's attack range.
      deadline = claimers.some((hostile) => safetyRange(hostile.pos, target.pos) <= 1) ? 0 : 1;
      threat = 'controller-claim';
    } else {
      const attackers = state.hostileThreats.filter((hostile) => damage(hostile, target) > 0);
      if (attackers.length === 0) continue;
      nearbyThreat = true;
      const incoming = attackers.reduce((sum, hostile) => sum + damage(hostile, target), 0);
      const buffer = target.hits + target.rampartHits;
      deadline = buffer / incoming;
      if (deadline > SAFETY_DAMAGE_HORIZON) continue;
      // Even killable creeps can attack this tick. Only credit a clear tower
      // kill when the protected structure survives that entire first burst.
      if (buffer > incoming && attackers.every((hostile) => removable.has(hostile.id))) continue;
      threat = 'critical-structure-threat';
    }
    const request: SafetyRequest = { roomName: state.room.name, controllerId: controller.id,
      targetId: target.id, threat, deadline,
      value: target.kind === 'spawn' ? (state.criticalTargets.filter((t) => t.kind === 'spawn').length === 1 ? 4 : 2)
        : target.kind === 'controller' ? 3 : 1,
      rcl: controller.level };
    if (!best || compareSafetyRequests(request, best) < 0) best = request;
  }
  if (!best) return none(nearbyThreat ? 'defenses-sufficient' : 'no-immediate-threat');
  if (controller.safeModeAvailable <= 0) return none('unavailable');
  if (controller.safeModeCooldown > 0) return none('cooldown');
  if (controller.upgradeBlocked > 0) return none('upgrade-blocked');
  if (controller.ticksToDowngrade < controller.downgradeLimit / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD) {
    return none('downgrade-blocked');
  }
  return { request: best, reason: best.threat };
}
