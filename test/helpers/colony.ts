Object.assign(globalThis, {
  RoomPosition: class {
    constructor(public x: number, public y: number, public roomName: string) {}
    findPathTo(target: RoomPosition) {
      const path: PathStep[] = [];
      let x = this.x, y = this.y;
      while (Math.max(Math.abs(x - target.x), Math.abs(y - target.y)) > 1) {
        x += Math.sign(target.x - x); y += Math.sign(target.y - y);
        path.push({ x, y, dx: 0, dy: 0, direction: 1 });
      }
      return path;
    }
  },
  WORK: 'work',
  CARRY: 'carry',
  MOVE: 'move',
  ATTACK: 'attack',
  RANGED_ATTACK: 'ranged_attack',
  CLAIM: 'claim',
  HEAL: 'heal',
  TOUGH: 'tough',
  ATTACK_POWER: 30,
  RANGED_ATTACK_POWER: 10,
  DISMANTLE_POWER: 50,
  HEAL_POWER: 12,
  RANGED_HEAL_POWER: 4,
  TOWER_ENERGY_COST: 10,
  TOWER_POWER_ATTACK: 600,
  TOWER_OPTIMAL_RANGE: 5,
  TOWER_FALLOFF_RANGE: 20,
  TOWER_FALLOFF: 0.75,
  BOOSTS: {
    attack: { XUH2O: { attack: 4 } }, work: { XZH2O: { dismantle: 4 } },
    ranged_attack: { XKHO2: { rangedAttack: 4 } }, heal: { XLHO2: { heal: 4, rangedHeal: 4 } },
    tough: { XGHO2: { damage: 0.3 } }
  },
  OBSTACLE_OBJECT_TYPES: ['spawn', 'extension', 'tower', 'storage', 'link', 'terminal', 'constructedWall', 'controller'],
  STRUCTURE_WALL: 'constructedWall',
  RESOURCE_ENERGY: 'energy',
  CREEP_SPAWN_TIME: 3,
  BODYPART_COST: { work: 100, carry: 50, move: 50 },
  FIND_SOURCES: 1,
  FIND_STRUCTURES: 2,
  FIND_MY_CONSTRUCTION_SITES: 3,
  FIND_MY_CREEPS: 4,
  FIND_HOSTILE_CREEPS: 5,
  FIND_DROPPED_RESOURCES: 6,
  FIND_MY_STRUCTURES: 7,
  FIND_MY_SPAWNS: 8,
  FIND_TOMBSTONES: 9,
  FIND_RUINS: 10,
  FIND_MINERALS: 11,
  LOOK_STRUCTURES: 'structure',
  LOOK_CONSTRUCTION_SITES: 'constructionSite',
  STRUCTURE_INVADER_CORE: 'invaderCore',
  STRUCTURE_RAMPART: 'rampart',
  TERRAIN_MASK_WALL: 1,
  STRUCTURE_SPAWN: 'spawn',
  STRUCTURE_EXTENSION: 'extension',
  STRUCTURE_TOWER: 'tower',
  STRUCTURE_CONTAINER: 'container',
  STRUCTURE_ROAD: 'road',
  STRUCTURE_STORAGE: 'storage',
  STRUCTURE_LINK: 'link',
  STRUCTURE_TERMINAL: 'terminal',
  CONTROLLER_DOWNGRADE: {
    1: 20000,
    2: 10000,
    3: 20000,
    4: 40000,
    5: 80000,
    6: 120000,
    7: 150000,
    8: 200000
  },
  CONTROLLER_STRUCTURES: {
    extension: { 2: 5 },
    tower: { 2: 0 }
  },
  BUILD_POWER: 5,
  HARVEST_POWER: 2,
  ENERGY_REGEN_TIME: 300,
  SOURCE_ENERGY_CAPACITY: 3000,
  CARRY_CAPACITY: 50,
  TERRAIN_MASK_SWAMP: 2,
  ERR_NOT_ENOUGH_RESOURCES: -6,
  CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD: 5000,
  REPAIR_POWER: 100,
  OK: 0,
  ERR_NOT_IN_RANGE: -9,
  ERR_INVALID_TARGET: -7,
  ERR_NOT_ENOUGH_ENERGY: -6
});

export function position(x = 10, y = 10, roomName = 'E25S47'): RoomPosition {
  return {
    x,
    y,
    roomName,
    getRangeTo: (target: { pos: RoomPosition }) =>
      Math.max(Math.abs(x - target.pos.x), Math.abs(y - target.pos.y)),
    findClosestByRange: (targets: { pos: RoomPosition }[]) =>
      [...targets].sort(
        (a, b) =>
          Math.max(
            Math.abs(x - a.pos.x),
            Math.abs(y - a.pos.y)
          ) -
          Math.max(
            Math.abs(x - b.pos.x),
            Math.abs(y - b.pos.y)
          )
      )[0] ?? null
  } as unknown as RoomPosition;
}

export function fixture(
  options: {
    count?: number;
    work?: number;
    carry?: number;
    move?: number;
    energy?: number;
    ticks?: number;
    level?: number;
    roomName?: string;
  } = {}
) {
  const actions: string[] = [];
  const roomName = options.roomName ?? 'E25S47';
  const calls = new Map<number, number>();
  const structures: Structure[] = [];
  const sites: ConstructionSite[] = [];
  const hostiles: Creep[] = [];
  const drops: Resource[] = [];
  const tombstones: Tombstone[] = [];
  const ruins: Ruin[] = [];
  const source = {
    id: 'source-a',
    energy: 3000,
    ticksToRegeneration: 300,
    pos: position(5, 5, roomName)
  } as Source;
  const controller = {
    id: 'controller',
    my: true,
    level: options.level ?? 2,
    ticksToDowngrade: options.ticks ?? 10000,
    safeModeAvailable: 0,
    activateSafeMode: () => { actions.push('safe-mode'); return OK; },
    pos: position(30, 30, roomName)
  } as StructureController;
  const room = {
    name: roomName,
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    controller,
    getTerrain: () => ({ get: () => TERRAIN_MASK_WALL }),
    find: (type: number) => {
      calls.set(type, (calls.get(type) ?? 0) + 1);
      switch (type) {
        case FIND_SOURCES:
          return [source];
        case FIND_STRUCTURES:
          return structures;
        case FIND_MY_STRUCTURES:
          return structures.filter((s) => (s as OwnedStructure).my);
        case FIND_MY_SPAWNS:
          return structures.filter(
            (s) => s.structureType === STRUCTURE_SPAWN
          );
        case FIND_MY_CONSTRUCTION_SITES:
          return sites;
        case FIND_MY_CREEPS:
          return workers;
        case FIND_HOSTILE_CREEPS:
          return hostiles;
        case FIND_DROPPED_RESOURCES:
          return drops;
        case FIND_TOMBSTONES: return tombstones;
        case FIND_RUINS: return ruins;
        case FIND_MINERALS: return [];
        default:
          throw new Error(`Unexpected find ${type}`);
      }
    }
  } as unknown as Room;

  const workParts = options.work ?? 1;
  const carryParts = options.carry ?? options.work ?? 1;
  const moveParts = options.move ?? options.work ?? 1;
  const workers = Array.from({ length: options.count ?? 5 }, (_, index) => {
    const name = `w${index}`;
    const capacity = carryParts * 50;
    return {
      name,
      memory: {
        kind: 'worker',
        home: room.name,
        working: true
      },
      room,
      pos: position(10 + index, 10, roomName),
      ticksToLive: 1000,
      spawning: false,
      fatigue: 0,
      body: [...Array.from({ length: workParts }, () => ({ type: WORK, hits: 100 })),
        ...Array.from({ length: carryParts }, () => ({ type: CARRY, hits: 100 })),
        ...Array.from({ length: moveParts }, () => ({ type: MOVE, hits: 100 }))],
      hits: 100,
      hitsMax: 100,
      getActiveBodyparts: (part: BodyPartConstant) => {
        if (part === WORK) return workParts;
        if (part === CARRY) return carryParts;
        if (part === MOVE) return moveParts;
        return 0;
      },
      store: {
        getUsedCapacity: () => options.energy ?? capacity,
        getFreeCapacity: () => capacity - (options.energy ?? capacity),
        getCapacity: () => capacity
      },
      harvest: () => {
        actions.push(`${name}:harvest`);
        return OK;
      },
      pickup: () => {
        actions.push(`${name}:pickup`);
        return OK;
      },
      withdraw: () => { actions.push(`${name}:withdraw`); return OK; },
      transfer: () => {
        actions.push(`${name}:refill`);
        return OK;
      },
      build: () => {
        actions.push(`${name}:build`);
        return OK;
      },
      repair: () => {
        actions.push(`${name}:repair`);
        return OK;
      },
      upgradeController: () => {
        actions.push(`${name}:upgrade`);
        return OK;
      },
      moveTo: (target: { id?: string }) => {
        actions.push(`${name}:move:${target.id}`);
        return OK;
      }
    } as unknown as Creep;
  });

  Object.assign(globalThis, {
    Memory: { creeps: {} },
    Game: {
      time: 1,
      creeps: Object.fromEntries(
        workers.map((worker) => [worker.name, worker])
      ),
      spawns: {},
      rooms: { [room.name]: room },
      getObjectById: (id: string) =>
        [controller, source, ...structures, ...sites, ...drops, ...tombstones, ...ruins].find(
          (object) => object.id === id
        ) ?? null,
      cpu: { getUsed: () => 1, limit: 20, bucket: 10000 }
    }
  });

  function refill(
    id = 'spawn',
    freeEnergy = 50,
    type: StructureConstant = STRUCTURE_SPAWN
  ) {
    const target = {
      id,
      name: id,
      my: true,
      structureType: type,
      pos: position(11, 11, roomName),
      spawning: null,
      hits: 5000,
      hitsMax: 5000,
      isActive: () => true,
      store: {
        getFreeCapacity: () => freeEnergy,
        getUsedCapacity: () => 300 - freeEnergy,
        getCapacity: () => 300
      },
      spawnCreep: () => OK
    } as unknown as StructureSpawn;
    structures.push(target);
    return target;
  }

  function build(
    id = 'site',
    type: BuildableStructureConstant = STRUCTURE_EXTENSION,
    remaining = 1000
  ) {
    const target = {
      id,
      structureType: type,
      pos: position(15, 15, roomName),
      progress: 0,
      progressTotal: remaining
    } as ConstructionSite;
    sites.push(target);
    return target;
  }

  function repair(id = 'container') {
    const target = {
      id,
      structureType: STRUCTURE_CONTAINER,
      hits: 44,
      hitsMax: 100,
      pos: position(20, 20, roomName),
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 2000, getCapacity: () => 2000 }
    } as unknown as StructureContainer;
    structures.push(target);
    return target;
  }

  return {
    room,
    workers,
    structures,
    sites,
    source,
    controller,
    hostiles,
    drops,
    tombstones,
    ruins,
    actions,
    calls,
    refill,
    build,
    repair
  };
}
