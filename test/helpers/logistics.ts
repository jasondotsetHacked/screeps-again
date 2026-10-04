import { fixture, position } from './colony';
import { creepName, type CreepIdentity } from '../../src/creeps/identity';
import { localSourceId } from '../../src/operations/sourceOperation';

// Straight local paths and intent spies; lifecycle tests use the separate
// deferred-energy simulation. Neither fixture models collision or real fatigue.
export function logisticsFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture({ count: 4, energy: 0, ...options });
  const paths: FindPathOpts[] = [];
  const moves: MoveToOpts[] = [];
  class LocalPosition {
    constructor(public x: number, public y: number, public roomName: string) {}
    findPathTo(target: RoomPosition, opts: FindPathOpts) {
      paths.push(opts);
      const path: PathStep[] = [];
      let x = this.x, y = this.y;
      while (Math.max(Math.abs(x - target.x), Math.abs(y - target.y)) > 1) {
        x += Math.sign(target.x - x); y += Math.sign(target.y - y);
        path.push({ x, y, dx: 0, dy: 0, direction: 1 });
      }
      return path;
    }
  }
  Object.assign(globalThis, { RoomPosition: LocalPosition });
  f.room.getTerrain = (() => ({ get: () => 0 })) as unknown as Room['getTerrain'];
  f.room.energyAvailable = 800;
  f.room.energyCapacityAvailable = 800;
  const spawn = f.refill('spawn', 300);
  const buffer = f.repair('buffer');
  buffer.pos = position(6, 6);
  Object.assign(buffer, { hits: 2000, hitsMax: 2000, store: {
    getUsedCapacity: () => 1000, getFreeCapacity: () => 1000, getCapacity: () => 2000
  } });
  function specialist(kind: 'miner' | 'hauler', suffix = 'abc', sourceId: string = f.source.id) {
    const identity: CreepIdentity = { kind, home: f.room.name, operationId: localSourceId(sourceId) };
    const name = creepName(identity, suffix);
    const creep = { ...f.workers[0], name, memory: { ...identity }, pos: position(6, 6),
      getActiveBodyparts: (part: BodyPartConstant) => part === WORK ? (kind === 'miner' ? 5 : 0)
        : part === CARRY ? (kind === 'miner' ? 1 : 8) : part === MOVE ? (kind === 'miner' ? 3 : 8) : 0,
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => kind === 'miner' ? 50 : 400,
        getCapacity: () => kind === 'miner' ? 50 : 400 },
      harvest: (source: Source) => { f.actions.push(`${name}:harvest:${source.id}`); return OK; },
      transfer: (target: Structure, _resource: string, amount?: number) => {
        f.actions.push(`${name}:transfer:${target.id}:${amount}`); return OK;
      },
      withdraw: (target: Structure, _resource: string, amount?: number) => {
        f.actions.push(`${name}:withdraw:${target.id}:${amount}`); return OK;
      },
      moveTo: (_target: unknown, opts: MoveToOpts) => { moves.push(opts); return OK; }
    } as unknown as Creep;
    Game.creeps[name] = creep;
    Memory.creeps[name] = creep.memory;
    return creep;
  }
  function secondSource() {
    const source = { ...f.source, id: 'source-b', pos: position(20, 20) } as Source;
    const find = f.room.find.bind(f.room);
    f.room.find = ((type: number) => type === FIND_SOURCES ? [source, f.source] : find(type as FindConstant)) as Room['find'];
    const get = Game.getObjectById;
    Game.getObjectById = ((id: string) => id === source.id ? source : get(id as Id<Source>)) as typeof Game.getObjectById;
    return source;
  }
  return { ...f, spawn, buffer, specialist, secondSource, paths, moves };
}
