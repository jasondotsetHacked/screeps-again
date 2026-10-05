import { range } from './grid';
import type { Tile } from './types';

export interface BufferCandidate extends Tile { walkable: boolean; placeable: boolean; containerId?: string; siteId?: string }
/** Shared source-operation geometry: built buffer, site, then stable proximity ties. */
export function selectSourceBuffer<T extends BufferCandidate>(tiles: readonly T[], anchor: Tile): T | undefined {
  return tiles.filter((p) => p.walkable && (p.containerId || p.siteId || p.placeable))
    .sort((a, b) => Number(Boolean(b.containerId)) - Number(Boolean(a.containerId)) ||
      Number(Boolean(b.siteId)) - Number(Boolean(a.siteId)) || range(a, anchor) - range(b, anchor) || a.y - b.y || a.x - b.x)[0];
}
