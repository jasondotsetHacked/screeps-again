import { distanceTransform, flood, hash, inside, key, neighbors, range, tile, weightedPath } from './grid';
import type { CorePlan, PlanOptions, PlannedStructure, PlanStructureType, Reservation, RoomAsset, RoomFacts, RoomPlan, Tile } from './types';
import { selectSourceBuffer } from './sourceTile';

const point = (p: Tile): Tile => ({ x: p.x, y: p.y });
const compare = (a: Tile, b: Tile) => key(a) - key(b);
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const blockingType = (type: string): boolean => !['road', 'container', 'rampart', 'extractor'].includes(type);
export const assetBlocking = (a: RoomAsset): boolean => a.blocking ?? (a.type === 'rampart' ? a.owned !== true : blockingType(a.type));
export function compatible(type: string, asset: RoomAsset): boolean {
  return type === asset.type || !asset.site && (asset.type === 'rampart' && asset.owned === true ||
    type === 'container' && asset.type === 'road' || type === 'road' && asset.type === 'container');
}
export function anchorIdentity(facts: RoomFacts): string {
  return hash(JSON.stringify([facts.roomName, facts.terrain, point(facts.spawn1), point(facts.controller),
    [...facts.sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : compare(a, b)).map((s) => [s.id, s.x, s.y]),
    facts.mineral ? point(facts.mineral) : null]));
}
function validateFacts(facts: RoomFacts): void {
  if (!/^[0123]{2500}$/.test(facts.terrain)) throw new Error('RoomPlan needs exactly 2500 normalized terrain cells');
  for (const p of [facts.spawn1, facts.controller, ...facts.sources, ...(facts.mineral ? [facts.mineral] : []), ...facts.assets]) {
    if (!inside(p)) throw new Error('RoomPlan fact position outside room interior');
  }
  if (new Set(facts.sources.map((s) => s.id)).size !== facts.sources.length) throw new Error('Duplicate source identity');
}

/** One deterministic planner for runtime, local tools and future MMO/Spawn1 analysis. */
export function planRoom(facts: RoomFacts, options: PlanOptions = {}): {
  roomPlan: RoomPlan; score: RoomPlan['score']; feasibility: RoomPlan['feasibility']; warnings: string[];
} {
  validateFacts(facts);
  const assets = [...facts.assets].sort((a, b) => compare(a, b) || lexical(a.type, b.type) ||
    Number(Boolean(a.site)) - Number(Boolean(b.site)) || lexical(a.id ?? '', b.id ?? ''));
  const sources = [...facts.sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : compare(a, b));
  const objects = new Map<number, RoomAsset[]>();
  for (const a of assets) objects.set(key(a), [...(objects.get(key(a)) ?? []), a]);
  const natural = new Set([facts.controller, ...sources, ...(facts.mineral ? [facts.mineral] : [])].map(key));
  const walk = new Uint8Array(2500);
  for (let id = 0; id < 2500; id++) if (inside(tile(id)) && !(Number(facts.terrain[id]) & 1) && !natural.has(id) &&
    !(objects.get(id) ?? []).some(assetBlocking)) walk[id] = 1;
  walk[key(facts.spawn1)] = 0;
  const structures: PlannedStructure[] = [], reservations: Reservation[] = [], modules: RoomPlan['modules'] = [];
  const routes: RoomPlan['routes'] = [], sourcePlans: RoomPlan['sources'] = [], warnings: string[] = [], reasons: string[] = [];
  const occupied = new Map<number, string>(), reserved = new Map<number, Reservation>();
  const roads = new Set<number>(), noTraffic = new Set<number>();
  const seeds = neighbors(facts.spawn1).filter((p) => walk[key(p)]);
  let reachable = flood(walk, seeds);
  const clearance = distanceTransform(walk);
  const tiles = Array.from({ length: 2500 }, (_, id) => tile(id)).filter((p) => inside(p, 3));
  const canPlace = (p: Tile, type?: string, margin = 3) => inside(p, margin) && !(Number(facts.terrain[key(p)]) & 1) &&
    !natural.has(key(p)) && key(p) !== key(facts.spawn1) && !occupied.has(key(p)) && !reserved.has(key(p)) &&
    (objects.get(key(p)) ?? []).every((a) => type ? compatible(type, a) :
      !a.site && ['road', 'container', 'rampart'].includes(a.type) && !assetBlocking(a));
  const ordered = (candidates: Tile[], score: (p: Tile) => number): Tile[] => candidates
    .map((p) => ({ p, score: score(p) })).sort((a, b) => a.score - b.score || compare(a.p, b.p)).map(({ p }) => p);
  function reserve(p: Tile, module: string, purpose: Reservation['purpose'], futureType?: PlanStructureType) {
    const r: Reservation = { ...point(p), module, purpose, ...(futureType ? { futureType } : {}) };
    reservations.push(r); reserved.set(key(p), r);
    if (purpose === 'manager' || purpose === 'work') noTraffic.add(key(p));
    if (purpose === 'future') walk[key(p)] = 0;
  }
  function add(p: Tile, type: PlanStructureType, module: string, minRcl: number, priority: number,
    owner: PlannedStructure['owner'] = 'colony', transitional = false) {
    if (structures.some((s) => s.type === type && key(s) === key(p))) return;
    structures.push({ ...point(p), type, module, minRcl, priority, owner, ...(transitional ? { transitional: true } : {}) });
    if (type === 'road') { roads.add(key(p)); return; }
    occupied.set(key(p), type);
    if (blockingType(type)) walk[key(p)] = 0;
  }
  const required: Tile[] = [];
  function preserves(blocked: Tile[], extra: Tile[] = []): boolean {
    const seen = flood(walk, seeds, new Set([...blocked.map(key), ...noTraffic]));
    return [...required, ...extra].filter((p) => !noTraffic.has(key(p))).every((p) => seen[key(p)]);
  }
  add(facts.spawn1, 'spawn', 'spawn1', 1, 0);
  // Source operations nominate assigned tiles, but shared planning validates all geometry.
  for (const source of sources) {
    const nomination = facts.sourceBuffers?.find((b) => b.sourceId === source.id)?.pos;
    const candidates = neighbors(source).filter((p) => canPlace(p, 'container', 1) && reachable[key(p)]).map((p) => ({
      ...p, walkable: true, placeable: true,
      containerId: (objects.get(key(p)) ?? []).find((a) => a.type === 'container' && !a.site)?.id ??
        ((objects.get(key(p)) ?? []).some((a) => a.type === 'container' && !a.site) ? 'built' : undefined),
      siteId: (objects.get(key(p)) ?? []).find((a) => a.type === 'container' && a.site)?.id ??
        ((objects.get(key(p)) ?? []).some((a) => a.type === 'container' && a.site) ? 'site' : undefined)
    }));
    const buffer = candidates.find((p) => nomination && key(p) === key(nomination)) ?? selectSourceBuffer(candidates, facts.spawn1);
    if (!buffer) { reasons.push(`source:${source.id}:no-buffer`); continue; }
    add(buffer, 'container', `source:${source.id}`, 2, 40, 'source');
    reserve(buffer, `source:${source.id}`, 'work'); required.push(buffer);
    const access = ordered(neighbors(buffer).filter((p) => canPlace(p, undefined, 1) && reachable[key(p)]),
      (p) => range(p, facts.spawn1) * 5 + (facts.terrain[key(p)] === '2' ? 20 : 0))[0];
    if (!access) { reasons.push(`source:${source.id}:no-access`); continue; }
    reserve(access, `source:${source.id}`, 'access'); required.push(access);
    sourcePlans.push({ sourceId: source.id, miner: point(buffer), container: point(buffer), access: point(access) });
  }

  // A compact core stamp rotates around its manager, with a full permanent access ring.
  const coreOffsets = [[0, -1, 'storage'], [1, -1, 'terminal'], [1, 0, 'factory'], [1, 1, 'link']] as const;
  const rotate = (origin: Tile, dx: number, dy: number, rotation: number): Tile => {
    for (let i = 0; i < rotation; i++) [dx, dy] = [-dy, dx];
    return { x: origin.x + dx, y: origin.y + dy };
  };
  const durableCore = assets.filter((a) => ['storage', 'terminal', 'factory'].includes(a.type));
  let core: CorePlan | undefined, coreTerrainPenalty = 0, coreGeometryPenalty = 0, coreLogisticsCost = 0, coreClearance = 0;
  const coreCandidates: { manager: Tile; rotation: number; buildings: Tile[]; ring: Tile[]; score: number; penalty: number; geometryPenalty: number }[] = [];
  for (const manager of tiles) {
    if (!canPlace(manager) || !reachable[key(manager)] || options.maxCoreRange !== undefined && range(manager, facts.spawn1) > options.maxCoreRange) continue;
    for (let rotation = 0; rotation < 4; rotation++) {
      const buildings = coreOffsets.map(([dx, dy]) => rotate(manager, dx, dy, rotation));
      if (!buildings.every((p, i) => canPlace(p, coreOffsets[i][2])) ||
        durableCore.some((a) => key(a) !== key(buildings[coreOffsets.findIndex((o) => o[2] === a.type)]))) continue;
      const ring: Tile[] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const p = rotate(manager, dx, dy, rotation);
        if (key(p) !== key(manager) && !buildings.some((b) => key(b) === key(p)) && canPlace(p) && reachable[key(p)]) ring.push(p);
      }
      if (ring.length < 4 || sources.some((s) => range(manager, s) < 4) || range(manager, facts.controller) < 4) continue;
      const penalty = buildings.reduce((sum, p, i) => sum + (facts.terrain[key(p)] === '2' ? i === 0 ? 500 : 80 : 0), 0) +
        ring.reduce((sum, p) => sum + (facts.terrain[key(p)] === '2' ? 12 : 0), 0);
      const geometryPenalty = (20 - ring.length) * 80;
      const score = penalty + geometryPenalty + range(manager, facts.spawn1) * 8 + range(manager, facts.controller) * 2 +
        sources.reduce((sum, s) => sum + range(manager, s) * 2, 0) - Math.min(clearance[key(manager)], 6) * 8;
      coreCandidates.push({ manager, rotation, buildings, ring, score, penalty, geometryPenalty });
    }
  }
  coreCandidates.sort((a, b) => a.score - b.score || compare(a.manager, b.manager) || a.rotation - b.rotation);
  for (const candidate of coreCandidates) {
    const { manager, rotation, buildings, ring } = candidate;
    // Validate the future blocked footprint AND manager-free circulation, not empty terrain.
    const future = flood(walk, seeds, new Set([...buildings.map(key), key(manager), ...noTraffic]));
    const storageAccess = neighbors(buildings[0]).filter((p) => future[key(p)] && key(p) !== key(manager));
    if (storageAccess.length < 2 || !neighbors(manager).some((p) => future[key(p)]) ||
      !ring.every((p) => future[key(p)]) || !required.filter((p) => !noTraffic.has(key(p))).every((p) => future[key(p)])) continue;
    modules.push({ id: 'core', kind: 'core', origin: point(manager), rotation });
    buildings.forEach((p, i) => add(p, coreOffsets[i][2], 'core', [4, 6, 7, 5][i], [5, 60, 80, 50][i]));
    reserve(manager, 'core', 'manager'); ring.forEach((p) => reserve(p, 'core', 'access'));
    const entrance = ordered(storageAccess, (p) => range(p, facts.spawn1))[0];
    core = { manager: point(manager), storage: point(buildings[0]), terminal: point(buildings[1]),
      factory: point(buildings[2]), link: point(buildings[3]), access: storageAccess.map(point).sort(compare), entrance: point(entrance) };
    required.push(...ring); coreTerrainPenalty = candidate.penalty;
    coreGeometryPenalty = candidate.geometryPenalty;
    coreLogisticsCost = Math.max(0, candidate.score - candidate.penalty - candidate.geometryPenalty); coreClearance = clearance[key(manager)];
    if (coreTerrainPenalty) warnings.push(`Core terrain penalty ${coreTerrainPenalty}; swamp or compromised access terrain`);
    if (coreGeometryPenalty) warnings.push(`Core geometry penalty ${coreGeometryPenalty}; access ring adapts around walls or retained legacy assets`);
    break;
  }
  if (!core) { reasons.push('core:no-safe-module'); warnings.push('Existing core geometry or terrain prevents the manager/access stamp; retain all completed assets'); }
  const hub = core?.entrance ?? seeds[0];
  reachable = flood(walk, seeds, noTraffic);
  const proximity = (p: Tile) => range(p, hub ?? facts.spawn1) * 5 + (facts.terrain[key(p)] === '2' ? 30 : 0);

  let controller: RoomPlan['controller'];
  const controllerCandidates = ordered(tiles.filter((p) => range(p, facts.controller) <= 3 && range(p, facts.controller) > 0 &&
    canPlace(p, 'container') && reachable[key(p)] && sources.every((s) => range(p, s) > 1)), (p) =>
    ((objects.get(key(p)) ?? []).some((a) => a.type === 'container') ? -10000 : 0) +
    (range(p, facts.controller) === 2 ? 0 : 1000) + proximity(p));
  for (const buffer of controllerCandidates) {
    const work = ordered(neighbors(buffer).filter((p) => range(p, facts.controller) <= 3 && canPlace(p) && reachable[key(p)]), proximity);
    if (work.length < 2) continue;
    const stand = work[0];
    const link = ordered(neighbors(stand).filter((p) => key(p) !== key(buffer) && range(p, buffer) === 1 &&
      range(p, facts.controller) <= 3 && canPlace(p, 'link')), proximity).find((p) => preserves([p], [buffer, stand]));
    const access = work.find((p) => key(p) !== key(stand) && (!link || key(p) !== key(link)));
    if (!link || !access) continue;
    add(buffer, 'container', 'controller', 2, 45, 'colony', true);
    add(link, 'link', 'controller', 5, 55);
    reserve(stand, 'controller', 'work'); reserve(access, 'controller', 'access');
    controller = { container: point(buffer), link: point(link), work: [point(stand)], access: point(access) };
    required.push(buffer, stand, access); break;
  }
  if (!controller) reasons.push('controller:no-safe-work-area');
  sourcePlans.forEach((source, i) => {
    const link = ordered(neighbors(source.miner).filter((p) => canPlace(p, 'link', 1)), proximity)
      .find((p) => preserves([p]));
    if (link) { add(link, 'link', `source:${source.sourceId}`, Math.min(8, 6 + i), 65, 'source'); source.link = point(link); }
    else reasons.push(`source:${source.sourceId}:no-link`);
  });

  // Future labs are an explicit reserved stamp, not a premature lab subsystem.
  // Two reagent tiles at (1,1)/(2,1) reach all eight reaction tiles at range 2.
  const labOffsets = [[1, 1], [2, 1], [0, 0], [1, 0], [2, 0], [3, 0], [0, 2], [3, 2], [1, 3], [2, 3]];
  let labEntrance: Tile | undefined;
  for (const origin of ordered(tiles, proximity)) {
    const footprint: Tile[] = [];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) footprint.push({ x: origin.x + dx, y: origin.y + dy });
    if (!footprint.every((p) => canPlace(p))) continue;
    const labs = labOffsets.map(([dx, dy]) => ({ x: origin.x + dx, y: origin.y + dy }));
    const aisles = footprint.filter((p) => !labs.some((l) => key(l) === key(p)));
    if (!preserves(labs, aisles)) continue;
    modules.push({ id: 'labs', kind: 'labs', origin: point(origin), rotation: 0 });
    labs.forEach((p) => reserve(p, 'labs', 'future', 'lab'));
    aisles.forEach((p) => reserve(p, 'labs', 'access'));
    required.push(...aisles); labEntrance = aisles[0]; break;
  }
  if (!labEntrance) reasons.push('labs:no-module-space');

  // Existing extensions/towers/spawns are adopted before adding compact modules.
  for (const [type, count, rcl, priority] of [['spawn', 3, 7, 70], ['tower', 6, 3, 30], ['extension', 60, 2, 10]] as const) {
    const existing = assets.filter((a) => a.type === type && key(a) !== key(facts.spawn1));
    for (const a of existing) if (structures.filter((s) => s.type === type).length < count && canPlace(a, type)) add(a, type, `adopted:${type}`, rcl, priority);
  }
  const utilityTargets = [
    { type: 'spawn', count: 3, rcl: 7, priority: 70 }, { type: 'tower', count: 6, rcl: 3, priority: 30 },
    { type: 'powerSpawn', count: 1, rcl: 8, priority: 90 }, { type: 'observer', count: 1, rcl: 8, priority: 95 },
    { type: 'nuker', count: 1, rcl: 8, priority: 95 }
  ] as const;
  const utilityEntrances: { id: string; pos: Tile }[] = [];
  for (const target of utilityTargets) {
    for (const a of assets.filter((a) => a.type === target.type)) {
      if (structures.filter((s) => s.type === target.type).length >= target.count) break;
      if (canPlace(a, target.type)) add(a, target.type, `adopted:${target.type}`, target.rcl, target.priority);
    }
    for (const p of ordered(tiles.filter((p) => canPlace(p, target.type)), proximity)) {
      if (structures.filter((s) => s.type === target.type).length >= target.count) break;
      // Leave adjacent permanent access and do not sever a corridor to any module.
      const access = ordered(neighbors(p).filter((n) => canPlace(n) && walk[key(n)]), proximity);
      if (access.length < 2 || !preserves([p], access.slice(0, 2))) continue;
      const module = `${target.type}:${structures.filter((s) => s.type === target.type).length}`;
      const rcl = target.type === 'spawn' && structures.filter((s) => s.type === 'spawn').length === 2 ? 8 : target.rcl;
      add(p, target.type, module, rcl, target.priority);
      reserve(access[0], module, 'access'); required.push(access[0]); utilityEntrances.push({ id: module, pos: access[0] });
    }
    if (structures.filter((s) => s.type === target.type).length < target.count) reasons.push(`${target.type}:insufficient-space`);
  }
  // Four extensions around a five-tile cross: every extension has road access.
  const extensionEntrances: { id: string; pos: Tile }[] = [];
  for (const origin of ordered(tiles, proximity)) {
    const remaining = 60 - structures.filter((s) => s.type === 'extension').length;
    if (remaining <= 0) break;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => ({ x: origin.x + dx, y: origin.y + dy }));
    const aisles = [point(origin), ...[[-1, 0], [0, -1], [1, 0], [0, 1]].map(([dx, dy]) => ({ x: origin.x + dx, y: origin.y + dy }))];
    if (![...corners, ...aisles].every((p) => canPlace(p)) || !preserves(corners.slice(0, remaining), aisles)) continue;
    const id = `extensions:${extensionEntrances.length}`;
    modules.push({ id, kind: 'extensions', origin: point(origin), rotation: 0 });
    corners.slice(0, remaining).forEach((p) => add(p, 'extension', id, 2, 10));
    [...aisles, ...corners.slice(remaining)].forEach((p) => reserve(p, id, 'access'));
    required.push(...aisles); extensionEntrances.push({ id, pos: point(origin) });
  }
  if (structures.filter((s) => s.type === 'extension').length < 60) reasons.push('extensions:insufficient-space');

  // Connect nearest destinations first. Reused road tiles cost 1, plains 3, swamps 15.
  // All routes originate at the hub; cheap existing trunks attract subsequent branches.
  if (hub) {
    const destinations = [
      { id: 'spawn1', goals: seeds }, ...sourcePlans.map((s) => ({ id: `source:${s.sourceId}`, goals: [s.access] })),
      ...(controller ? [{ id: 'controller', goals: [controller.access] }] : []),
      ...(labEntrance ? [{ id: 'labs', goals: [labEntrance] }] : []),
      ...utilityEntrances.map((d) => ({ id: d.id, goals: [d.pos] })),
      ...extensionEntrances.map((d) => ({ id: d.id, goals: [d.pos] }))
    ].sort((a, b) => Math.min(...a.goals.map((p) => range(p, hub))) - Math.min(...b.goals.map((p) => range(p, hub))) || lexical(a.id, b.id));
    const networkWalk = walk.slice();
    for (const p of noTraffic) networkWalk[p] = 0;
    for (const a of assets) if (a.type === 'road' && networkWalk[key(a)]) roads.add(key(a));
    for (const destination of destinations) {
      const path = weightedPath(networkWalk, facts.terrain, hub, destination.goals, roads);
      if (!path) { reasons.push(`road:${destination.id}:unreachable`); continue; }
      routes.push({ id: destination.id, tiles: path.map(point) }); path.forEach((p) => roads.add(key(p)));
    }
    // Module aisles join the shared network; no roads on stationary work/manager tiles.
    for (const r of reservations) if (r.purpose === 'access' && networkWalk[key(r)] &&
      r.module.startsWith('extensions:')) roads.add(key(r));
    for (const id of [...roads].sort((a, b) => a - b)) if (networkWalk[id] &&
      (objects.get(id) ?? []).every((a) => compatible('road', a))) add(tile(id), 'road', 'network', 2, 100);
  }
  // Final mature connectivity includes ALL buildings/reserved labs; manager can be absent.
  const finalReachable = flood(walk, seeds, noTraffic);
  if (core && (core.access.filter((p) => finalReachable[key(p)]).length < 2 || !finalReachable[key(core.entrance)])) reasons.push('core:future-access-blocked');
  if (required.filter((p) => !noTraffic.has(key(p))).some((p) => !finalReachable[key(p)])) reasons.push('modules:future-access-blocked');
  const dispositions: RoomPlan['assets'] = assets.map((a) => {
    const match = structures.find((s) => key(s) === key(a) && s.type === a.type);
    const future = reservations.find((r) => key(r) === key(a) && r.futureType === a.type);
    const conflict = structures.some((s) => key(s) === key(a) && !compatible(s.type, a)) ||
      reservations.some((r) => key(r) === key(a) && (r.purpose === 'manager' || r.purpose === 'future') && !future);
    return { ...a, disposition: match?.transitional ? 'transitional' : match || future ? 'adopted' : conflict ? 'migration-candidate' : 'tolerated-legacy',
      reason: match?.transitional ? 'Controller buffer retained until link logistics replaces it' : match || future ? 'Matches planning intent' :
        conflict ? 'Conflict reported only; no automatic demolition' : 'Existing asset retained; counts toward RCL limits' };
  });
  if (dispositions.some((a) => a.disposition === 'tolerated-legacy' && !['road', 'rampart'].includes(a.type))) warnings.push('Legacy structures retained; live limits may defer replacement intent');
  const roadStructures = structures.filter((s) => s.type === 'road');
  const roadCost = roadStructures.reduce((sum, p) => sum + (facts.terrain[key(p)] === '2' ? 5 : 1), 0);
  const score = { total: Math.max(0, 10000 - coreTerrainPenalty - coreGeometryPenalty - coreLogisticsCost - roadCost * 2 - reasons.length * 1000),
    coreTerrainPenalty, coreGeometryPenalty, coreLogisticsCost, roadCost, roadTiles: roadStructures.length, clearance: coreClearance };
  const feasibility = { complete: reasons.length === 0, reasons: [...new Set(reasons)].sort() };
  const anchorId = anchorIdentity(facts);
  const intent = { version: 1 as const, algorithm: 'hybrid-v1' as const, anchorId, roomName: facts.roomName, spawn1: point(facts.spawn1),
    structures: structures.sort((a, b) => a.priority - b.priority || lexical(a.type, b.type) ||
      (a.type === 'extension' || a.type === 'tower' ? range(a, facts.spawn1) - range(b, facts.spawn1) : 0) || compare(a, b)),
    reservations: reservations.sort((a, b) => compare(a, b) || lexical(a.module, b.module)), modules,
    ...(core ? { core } : {}), sources: sourcePlans, ...(controller ? { controller } : {}), routes, assets: dispositions,
    score, feasibility, warnings };
  const roomPlan: RoomPlan = { ...intent, id: `roomplan-v1:${hash(JSON.stringify(intent))}` };
  return { roomPlan, score, feasibility, warnings };
}
