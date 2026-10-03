import { fixture, position } from './colony';
import { runColony } from '../../src/colony/runColony';

// A deliberately small lifecycle model, not a Screeps engine substitute.
// Queue accepted intents, then resolve movement, energy and progress at tick end.
// No terrain/fatigue/body damage/boosts/collision or spawn lifecycle simulation.
export function simulation(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options);
  const intents: (() => void)[] = [];
  const energy = new Map<object, number>();
  const capacities = new Map<object, number>();
  const fulfilled = { harvest: 0, withdraw: 0, pickup: 0, refill: 0, build: 0, repair: 0, upgrade: 0 };
  let upgraded = false;
  let regenerated = 0;
  let regeneration = 0;

  function store(object: object, amount: number, capacity: number) {
    energy.set(object, amount);
    capacities.set(object, capacity);
    Object.assign(object, { store: {
      getUsedCapacity: () => energy.get(object) ?? 0,
      getFreeCapacity: () => capacity - (energy.get(object) ?? 0),
      getCapacity: () => capacity
    } });
  }
  function amount(object: object) { return energy.get(object) ?? 0; }
  function setEnergy(object: object, value: number) { energy.set(object, value); }
  function action(creep: Creep, target: RoomObject, range: number, resolve: () => void): ScreepsReturnCode {
    if (creep.pos.getRangeTo(target) > range) return ERR_NOT_IN_RANGE;
    intents.push(resolve);
    return OK;
  }
  function consume(creep: Creep, limit: number) {
    const spent = Math.min(amount(creep), creep.getActiveBodyparts(WORK), limit);
    setEnergy(creep, amount(creep) - spent);
    return spent;
  }
  function take(creep: Creep, target: object, limit: number, kind: 'withdraw' | 'refill') {
    const from = kind === 'refill' ? creep : target;
    const to = kind === 'refill' ? target : creep;
    const taken = Math.min(amount(from), (capacities.get(to) ?? 0) - amount(to), limit);
    setEnergy(from, amount(from) - taken);
    setEnergy(to, amount(to) + taken);
    if (taken > 0) fulfilled[kind] += 1;
  }
  for (const creep of f.workers) {
    const capacity = creep.getActiveBodyparts(CARRY) * 50;
    store(creep, options.energy ?? capacity, capacity);
    creep.moveTo = ((target: RoomObject) => {
      intents.push(() => { creep.pos = position(creep.pos.x + Math.sign(target.pos.x - creep.pos.x),
        creep.pos.y + Math.sign(target.pos.y - creep.pos.y)); });
      return OK;
    }) as Creep['moveTo'];
    creep.harvest = ((source: Source) => {
      if (source.energy <= 0) return ERR_NOT_ENOUGH_ENERGY;
      return action(creep, source, 1, () => {
        const taken = Math.min(source.energy, creep.getActiveBodyparts(WORK) * HARVEST_POWER,
          capacity - amount(creep));
        source.energy -= taken;
        setEnergy(creep, amount(creep) + taken);
        if (taken > 0) fulfilled.harvest += 1;
      });
    }) as Creep['harvest'];
    creep.withdraw = ((target: StructureContainer | Tombstone | Ruin, _resource: string, requested?: number) => {
      if (amount(target) <= 0) return ERR_NOT_ENOUGH_ENERGY;
      return action(creep, target, 1, () => take(creep, target, requested ?? Infinity, 'withdraw'));
    }) as Creep['withdraw'];
    creep.pickup = ((drop: Resource) => action(creep, drop, 1, () => {
      const taken = Math.min(drop.amount, capacity - amount(creep));
      drop.amount -= taken;
      setEnergy(creep, amount(creep) + taken);
      if (taken > 0) fulfilled.pickup += 1;
    })) as Creep['pickup'];
    creep.transfer = ((target: StructureSpawn) => amount(creep) <= 0 ? ERR_NOT_ENOUGH_ENERGY
      : action(creep, target, 1, () => take(creep, target, Infinity, 'refill'))) as Creep['transfer'];
    creep.build = ((site: ConstructionSite) => amount(creep) <= 0 ? ERR_NOT_ENOUGH_ENERGY
      : action(creep, site, 3, () => {
        const spent = consume(creep, Math.ceil((site.progressTotal - site.progress) / BUILD_POWER));
        site.progress = Math.min(site.progressTotal, site.progress + spent * BUILD_POWER);
        if (spent > 0) fulfilled.build += 1;
        if (site.progress >= site.progressTotal) f.sites.splice(f.sites.indexOf(site), 1);
      })) as Creep['build'];
    creep.repair = ((target: Structure) => amount(creep) <= 0 ? ERR_NOT_ENOUGH_ENERGY
      : action(creep, target, 3, () => {
        const spent = consume(creep, Math.ceil((target.hitsMax - target.hits) / REPAIR_POWER));
        target.hits = Math.min(target.hitsMax, target.hits + spent * REPAIR_POWER);
        if (spent > 0) fulfilled.repair += 1;
      })) as Creep['repair'];
    creep.upgradeController = ((controller: StructureController) => amount(creep) <= 0 ? ERR_NOT_ENOUGH_ENERGY
      : action(creep, controller, 3, () => {
        const spent = consume(creep, Infinity);
        controller.progress += spent;
        if (spent > 0) { fulfilled.upgrade += 1; upgraded = true; }
      })) as Creep['upgradeController'];
  }
  Object.assign(f.controller, { progress: 0, progressTotal: 45000 });
  // Avoid the periodic site planner in these labor tests. It is covered by the
  // unchanged integration path; no spawn means construction mutation is inert.
  function tick() {
    const colony = runColony(f.room);
    upgraded = false;
    intents.splice(0).forEach((intent) => intent());
    f.controller.ticksToDowngrade = Math.min(CONTROLLER_DOWNGRADE[f.controller.level],
      f.controller.ticksToDowngrade - 1 + (upgraded ? 100 : 0));
    if (f.source.energy < 3000 || regeneration > 0) {
      if (regeneration === 0) regeneration = f.source.ticksToRegeneration ?? 10;
      regeneration -= 1;
      f.source.ticksToRegeneration = regeneration;
      if (regeneration === 0) {
        f.source.energy = 3000;
        f.source.ticksToRegeneration = 300;
        regenerated += 1;
      }
    }
    for (const creep of f.workers) creep.ticksToLive! -= 1;
    Game.time += 1;
    return colony;
  }
  return { ...f, tick, store, amount, setEnergy, fulfilled, regenerated: () => regenerated };
}
