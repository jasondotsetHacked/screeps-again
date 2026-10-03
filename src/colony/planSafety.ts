import type { ColonyState } from './colonyState';

export interface SafetyPlan {
  activateSafeMode: boolean;
  reason: 'no-controller' | 'already-protected' | 'no-immediate-threat' |
    'unavailable' | 'cooldown' | 'upgrade-blocked' | 'downgrade-blocked' |
    'safe-mode-elsewhere' | 'critical-structure-threat';
}

export function planSafety(state: Pick<ColonyState, 'controller' | 'hostileThreats' | 'criticalTargets'>,
  canActivate = true): SafetyPlan {
  const controller = state.controller;
  const none = (reason: SafetyPlan['reason']): SafetyPlan => ({ activateSafeMode: false, reason });
  if (!controller?.my) return none('no-controller');
  if (controller.safeMode > 0) return none('already-protected');
  const threatened = state.hostileThreats.some((hostile) => state.criticalTargets.some((target) => {
    const range = Math.max(Math.abs(hostile.pos.x - target.pos.x), Math.abs(hostile.pos.y - target.pos.y));
    return hostile.pos.roomName === target.pos.roomName &&
      ((range <= 1 && (hostile.melee || hostile.dismantle)) || (range <= 3 && hostile.ranged));
  }));
  if (!threatened) return none('no-immediate-threat');
  if (controller.safeModeAvailable <= 0) return none('unavailable');
  if (controller.safeModeCooldown > 0) return none('cooldown');
  if (controller.upgradeBlocked > 0) return none('upgrade-blocked');
  if (controller.ticksToDowngrade < controller.downgradeLimit / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD) {
    return none('downgrade-blocked');
  }
  if (!canActivate) return none('safe-mode-elsewhere');
  return { activateSafeMode: true, reason: 'critical-structure-threat' };
}
