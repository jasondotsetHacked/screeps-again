Object.assign(globalThis, {
  WORK: 'work',
  CARRY: 'carry',
  MOVE: 'move',
  ATTACK: 'attack',
  RANGED_ATTACK: 'ranged_attack',
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
  STRUCTURE_RAMPART: 'rampart',
  TERRAIN_MASK_WALL: 1,
  STRUCTURE_SPAWN: 'spawn',
  STRUCTURE_EXTENSION: 'extension',
  STRUCTURE_TOWER: 'tower',
  STRUCTURE_CONTAINER: 'container',
  STRUCTURE_ROAD: 'road',
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
  CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD: 5000,
  REPAIR_POWER: 100,
  OK: 0,
  ERR_NOT_IN_RANGE: -9,
  ERR_INVALID_TARGET: -7,
  ERR_NOT_ENOUGH_ENERGY: -6
});

export function position(x = 10, y = 10): RoomPosition {
  return {
    x,
    y,
    roomName: 'E25S47',
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
  } = {}
) {
  const actions: string[] = [];
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
    pos: position(5, 5)
  } as Source;
  const controller = {
    id: 'controller',
    my: true,
    level: options.level ?? 2,
    ticksToDowngrade: options.ticks ?? 10000,
    safeModeAvailable: 0,
    activateSafeMode: () => { actions.push('safe-mode'); return OK; },
    pos: position(30, 30)
  } as StructureController;
  const room = {
    name: 'E25S47',
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
      pos: position(10 + index, 10),
      ticksToLive: 1000,
      spawning: false,
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
      pos: position(11, 11),
      spawning: null,
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
      pos: position(15, 15),
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
      pos: position(20, 20),
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
