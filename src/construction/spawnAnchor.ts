import type { RoomPlan } from '../../shared/roomPlan/types';

/** Additional spawns never replace the sacred committed Spawn1 anchor. */
export function selectSpawnAnchor<T extends { id: string; name?: string; pos: { x: number; y: number } }>(
  spawns: readonly T[], plan?: RoomPlan): T | undefined {
  const isAnchor = (s: T) => plan && s.pos.x === plan.spawn1.x && s.pos.y === plan.spawn1.y;
  return [...spawns].sort((a, b) => Number(Boolean(isAnchor(b))) - Number(Boolean(isAnchor(a))) ||
    Number(b.name === 'Spawn1') - Number(a.name === 'Spawn1') || a.id.localeCompare(b.id))[0];
}
