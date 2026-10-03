import type { WorkPosition, WorkTarget } from '../work/demands';

export interface HostileThreat extends WorkTarget {
  hits: number;
  melee: number;
  ranged: number;
  dismantle: number;
  heal: number;
  rangedHeal: number;
  claim: number;
  canMove: boolean;
  controllerApproach: boolean;
  towerDamageFactor: number;
  shielded: boolean;
}

export interface CriticalTarget extends WorkTarget {
  kind: 'spawn' | 'tower' | 'controller';
  hits: number;
  rampartHits: number;
}

export interface SafetyTower extends WorkTarget {
  energy: number;
  active: boolean;
  unmodified: boolean;
}

export function safetyRange(a: WorkPosition, b: WorkPosition): number {
  return a.roomName === b.roomName ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;
}

function power(creep: Creep, part: BodyPartConstant, action: string, base: number): number {
  const boosts = BOOSTS[part] as Record<string, Record<string, number>>;
  return creep.body.reduce((sum, body) => {
    if (body.type !== part || body.hits <= 0) return sum;
    const boost = body.boost ? boosts[String(body.boost)]?.[action] ?? 1 : 1;
    return sum + base * boost;
  }, 0);
}

// Project combat inputs from the shared room scans. Only nearby CLAIM threats
// need a small local terrain/structure check; no pathfinding or extra finds.
export function observeSafety(room: Room, structures: readonly Structure[],
  hostiles: readonly Creep[], spawns: readonly StructureSpawn[], towers: readonly StructureTower[]) {
  const target = (object: { id: string; pos: RoomPosition }): WorkTarget => ({ id: object.id,
    pos: { x: object.pos.x, y: object.pos.y, roomName: object.pos.roomName } });
  const ramparts = structures.filter((s): s is StructureRampart => s.structureType === STRUCTURE_RAMPART);
  const rampartAt = (pos: RoomPosition) => ramparts.find((r) => r.pos.x === pos.x && r.pos.y === pos.y);
  const blockers = new Map<string, Structure[]>();
  for (const structure of structures.filter((s) =>
    (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my && !(s as StructureRampart).isPublic) ||
    (OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType)
  )) {
    const key = `${structure.pos.x},${structure.pos.y}`;
    blockers.set(key, [...(blockers.get(key) ?? []), structure]);
  }
  let terrain: RoomTerrain | undefined;
  const controller = room.controller;
  const hostileThreats: HostileThreat[] = hostiles.map((creep) => {
    const claim = creep.getActiveBodyparts(CLAIM);
    const canMove = creep.getActiveBodyparts(MOVE) > 0 && creep.fatigue === 0;
    const tough = creep.body.filter((part) => part.type === TOUGH && part.hits > 0 && part.boost)
      .map((part) => (BOOSTS[TOUGH] as Record<string, { damage: number }>)[String(part.boost)]?.damage ?? 1);
    return { ...target(creep), hits: creep.hits,
      melee: power(creep, ATTACK, 'attack', ATTACK_POWER),
      ranged: power(creep, RANGED_ATTACK, 'rangedAttack', RANGED_ATTACK_POWER),
      dismantle: power(creep, WORK, 'dismantle', DISMANTLE_POWER),
      heal: power(creep, HEAL, 'heal', HEAL_POWER),
      rangedHeal: power(creep, HEAL, 'rangedHeal', RANGED_HEAL_POWER),
      claim, canMove, controllerApproach: false,
      // Applying the strongest TOUGH reduction to all damage underestimates
      // tower output, deliberately avoiding optimistic kill predictions.
      towerDamageFactor: Math.min(1, ...tough),
      shielded: Boolean(rampartAt(creep.pos)) || Boolean(creep.effects?.some((effect) => effect.ticksRemaining > 0))
    };
  });
  for (const hostile of hostileThreats) {
    if (!controller || hostile.claim <= 0 || !hostile.canMove || safetyRange(hostile.pos, controller.pos) !== 2) continue;
    terrain ??= room.getTerrain();
    for (let x = Math.max(0, hostile.pos.x - 1); x <= Math.min(49, hostile.pos.x + 1); x += 1) {
      for (let y = Math.max(0, hostile.pos.y - 1); y <= Math.min(49, hostile.pos.y + 1); y += 1) {
        if (Math.max(Math.abs(x - controller.pos.x), Math.abs(y - controller.pos.y)) !== 1 ||
            terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        const blocked = blockers.get(`${x},${y}`) ?? [];
        if (blocked.length > 0) {
          // A barrier removable by this tick's hostile damage must not hide
          // the next controller attack. Use present attack ranges, not travel.
          const incoming = hostileThreats.reduce((sum, attacker) => {
            const range = safetyRange(attacker.pos, { x, y, roomName: room.name });
            return sum + (range <= 1 ? Math.max(attacker.melee, attacker.dismantle) : 0) +
              (range <= 3 ? attacker.ranged : 0);
          }, 0);
          const health = blocked.reduce((sum, structure) => sum + structure.hits, 0);
          if (blocked.some((structure) => !structure.hits) || health > incoming) continue;
        }
        hostile.controllerApproach = true;
      }
    }
  }
  const criticalTargets: CriticalTarget[] = [...spawns, ...towers].map((structure) => ({
    ...target(structure), kind: structure.structureType === STRUCTURE_SPAWN ? 'spawn' : 'tower',
    hits: structure.hits, rampartHits: rampartAt(structure.pos)?.my ? rampartAt(structure.pos)!.hits : 0
  }));
  if (controller?.my) criticalTargets.push({ ...target(controller), kind: 'controller', hits: 0, rampartHits: 0 });
  const defenseTowers: SafetyTower[] = towers.map((tower) => ({ ...target(tower),
    energy: tower.store.getUsedCapacity(RESOURCE_ENERGY), active: tower.isActive(),
    unmodified: !tower.effects?.some((effect) => effect.ticksRemaining > 0) }));
  return { hostileThreats, criticalTargets, defenseTowers };
}
