const DOWNGRADE_URGENCY_TICKS = 3000;

export function isControllerUrgent(
  controller: { my: boolean; ticksToDowngrade: number } | undefined
): boolean {
  return Boolean(
    controller?.my && controller.ticksToDowngrade < DOWNGRADE_URGENCY_TICKS
  );
}
