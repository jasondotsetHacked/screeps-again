import type { WorkPosition } from '../work/demands';
import { distance } from '../operations/sourceOperation';

export interface LayoutObject {
  pos: WorkPosition; type: StructureConstant; blocking: boolean; site?: boolean; my?: boolean;
}

export function layoutCoexistence(type: StructureConstant | undefined, object: LayoutObject): boolean {
  if (object.type === type) return true; // Adopt the durable structure/site.
  // Even compatible structures cannot share two simultaneous construction sites.
  if (object.site) return false;
  return object.type === STRUCTURE_RAMPART && object.my === true ||
    object.type === STRUCTURE_ROAD && (type === undefined || type === STRUCTURE_CONTAINER);
}
export interface LocalLayout {
  storage?: WorkPosition;
  coreLink?: WorkPosition;
  terminal?: WorkPosition;
  coreAccess?: WorkPosition;
  controllerBuffer?: WorkPosition;
  controllerLink?: WorkPosition;
  controllerWork?: WorkPosition;
}

export function layoutReservations(layout: LocalLayout): WorkPosition[] {
  return Object.values(layout).filter((tile): tile is WorkPosition => Boolean(tile));
}

// A small strategic footprint, not a base layout. Called only on construction
// intervals. Terrain and anchor scores keep reservations stable as ordinary
// extensions grow around them; only occupied reserved slots force a new choice.
export function planLocalLayout(input: {
  roomName: string; spawn: WorkPosition; controller: WorkPosition;
  sources: readonly WorkPosition[]; sourceBuffers: readonly WorkPosition[];
  objects: readonly LayoutObject[]; fixed?: readonly WorkPosition[]; terrain: (x: number, y: number) => number;
}): LocalLayout {
  const { spawn, controller, sources, sourceBuffers, objects, terrain, roomName } = input;
  const key = (p: WorkPosition) => p.y * 50 + p.x;
  const at = new Map<number, LayoutObject[]>();
  for (const o of objects) at.set(key(o.pos), [...(at.get(key(o.pos)) ?? []), o]);
  const natural = (p: WorkPosition) => p.x >= 3 && p.x <= 46 && p.y >= 3 && p.y <= 46 &&
    terrain(p.x, p.y) !== TERRAIN_MASK_WALL && distance(p, controller) > 0 &&
    !sources.some((s) => distance(p, s) === 0) && !input.fixed?.some((s) => distance(p, s) === 0);
  const clear = (p: WorkPosition, type?: StructureConstant) => natural(p) &&
    !sourceBuffers.some((s) => distance(p, s) === 0) &&
    (at.get(key(p)) ?? []).every((o) => layoutCoexistence(type, o));
  const square = (origin: WorkPosition, range: number, margin = 3): WorkPosition[] => {
    const tiles: WorkPosition[] = [];
    for (let y = Math.max(margin, origin.y - range); y <= Math.min(49 - margin, origin.y + range); y++) {
      for (let x = Math.max(margin, origin.x - range); x <= Math.min(49 - margin, origin.x + range); x++) {
        tiles.push({ x, y, roomName });
      }
    }
    return tiles;
  };
  // One transient walkability grid on construction intervals. Include sites as
  // future obstacles and validate access after the core's future buildings exist.
  const walkable = new Uint8Array(2500);
  const fixed = new Set([controller, ...sources, ...(input.fixed ?? [])].map(key));
  for (let y = 1; y < 49; y++) for (let x = 1; x < 49; x++) {
    const id = y * 50 + x;
    if (terrain(x, y) !== TERRAIN_MASK_WALL && !fixed.has(id) && !(at.get(id) ?? []).some((o) => o.blocking)) walkable[id] = 1;
  }
  const flood = (blocked: readonly WorkPosition[] = []) => {
    const visited = new Uint8Array(2500);
    const excluded = new Set(blocked.map(key));
    const queue = new Uint16Array(2500);
    let length = 0;
    for (const p of square(spawn, 1, 1)) if (walkable[key(p)] && !excluded.has(key(p))) {
      visited[key(p)] = 1; queue[length++] = key(p);
    }
    for (let i = 0; i < length; i++) {
      const id = queue[i];
      const x = id % 50, y = Math.floor(id / 50);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * 50 + nx;
        if (nx > 0 && nx < 49 && ny > 0 && ny < 49 && walkable[next] && !visited[next] && !excluded.has(next)) {
          visited[next] = 1; queue[length++] = next;
        }
      }
    }
    return visited;
  };
  const reachable = flood();
  const access = (p: WorkPosition) => square(p, 1).filter((n) => distance(n, p) > 0 && reachable[key(n)]).length;
  const ordered = (tiles: WorkPosition[], score: (p: WorkPosition) => number) => {
    const scores = new Map(tiles.map((p) => [key(p), score(p)]));
    return tiles.sort((a, b) => scores.get(key(a))! - scores.get(key(b))! || a.y - b.y || a.x - b.x);
  };
  const durable = (type: StructureConstant) => objects.filter((o) => o.type === type)
    .map((o) => ({ x: o.pos.x, y: o.pos.y, roomName }));
  const coreScore = (p: WorkPosition) => 4 * distance(p, spawn) + 2 * distance(p, controller) +
    sources.reduce((sum, s) => sum + distance(p, s), 0) -
    square(p, 2).filter(natural).length;
  const existingStorage = ordered(durable(STRUCTURE_STORAGE), coreScore)[0];
  const coreCandidates = existingStorage ? [existingStorage] : ordered(square(spawn, 6).filter((p) =>
    distance(p, spawn) >= 2 && distance(p, controller) >= 4 && sources.every((s) => distance(p, s) >= 3) &&
    clear(p, STRUCTURE_STORAGE) && access(p) >= 3), coreScore);
  let storage: WorkPosition | undefined, coreLink: WorkPosition | undefined, terminal: WorkPosition | undefined,
    coreAccess: WorkPosition | undefined;
  let futureReachable = reachable;
  for (const p of coreCandidates.slice(0, 8)) {
    const neighbors = ordered(square(p, 1).filter((n) => distance(n, p) === 1 && clear(n) && access(n) >= 2),
      (n) => distance(n, spawn));
    const link = neighbors.find((n) => clear(n, STRUCTURE_LINK));
    const term = ordered(square(p, 1).filter((n) => distance(n, p) === 1 &&
      (!link || distance(n, link) === 1) && clear(n, STRUCTURE_TERMINAL) && access(n) >= 2), (n) => distance(n, spawn))[0];
    const stand = neighbors.find((n) => (!link || distance(n, link) === 1) && (!term || distance(n, term) === 1));
    const future = flood([p, ...[link, term].filter((n): n is WorkPosition => Boolean(n))]);
    if (link && term && stand && future[key(stand)] &&
        sourceBuffers.every((s) => !reachable[key(s)] || future[key(s)]) || existingStorage) {
      storage = p; coreLink = link; terminal = term; coreAccess = stand; futureReachable = future; break;
    }
  }
  const core = [storage, coreLink, terminal, coreAccess].filter((p): p is WorkPosition => Boolean(p));
  const controllerClear = (p: WorkPosition, type?: StructureConstant) => clear(p, type) &&
    !core.some((c) => distance(c, p) === 0) && sources.every((s) => distance(s, p) > 1);
  const bufferScore = (p: WorkPosition) => distance(p, spawn) -
    square(p, 1).filter((n) => natural(n) && distance(n, controller) <= 3).length;
  const existingBuffer = ordered(durable(STRUCTURE_CONTAINER).filter((p) => distance(p, controller) <= 3 &&
    controllerClear(p, STRUCTURE_CONTAINER)), bufferScore)[0];
  const bufferCandidates = existingBuffer ? [existingBuffer] : ordered(square(controller, 2).filter((p) =>
    distance(p, controller) === 2 && controllerClear(p, STRUCTURE_CONTAINER) && futureReachable[key(p)] && access(p) >= 3), bufferScore);
  let controllerBuffer: WorkPosition | undefined, controllerLink: WorkPosition | undefined, controllerWork: WorkPosition | undefined;
  for (const p of bufferCandidates.slice(0, 8)) {
    const link = ordered(square(p, 1).filter((n) => distance(n, p) === 1 && distance(n, controller) <= 2 &&
      controllerClear(n, STRUCTURE_LINK) && access(n) >= 2), (n) => distance(n, spawn))[0];
    const stand = ordered(square(p, 1).filter((n) => distance(n, p) === 1 && distance(n, controller) <= 3 &&
      (!link || distance(n, link) > 0) && controllerClear(n) && futureReachable[key(n)]), (n) => distance(n, spawn))[0];
    const future = link && flood([...core.filter((c) => c !== coreAccess), link]);
    if (link && stand && future?.[key(p)] && future[key(stand)] &&
        sourceBuffers.every((s) => !reachable[key(s)] || future[key(s)]) || existingBuffer) {
      controllerBuffer = p; controllerLink = link; controllerWork = stand; break;
    }
  }
  return { storage, coreLink, terminal, coreAccess, controllerBuffer, controllerLink, controllerWork };
}
