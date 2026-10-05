# RoomPlan v1

`shared/roomPlan/planRoom.ts` is the single layout engine. `planRoom(facts, options)`
accepts the plain `RoomFacts` schema and returns `{ roomPlan, score, feasibility,
warnings }`. It imports only shared planning modules and compiles with no Screeps
types. No room discovery, API client, room ranking or deployment code changes.

## Planning intent

Terrain is a row-major 2500-character string (`0` plain, `1` wall, `2` swamp,
`3` wall/swamp). Positions are `{ x, y }`; assets describe structures/sites,
ownership and observed walkability. Spawn1 is an explicit input, so a future
candidate evaluator can call this exact engine with different Spawn1 positions.
`sourceBuffers` optionally carries assigned source-operation infrastructure;
the planner validates its adjacency, occupancy and terrain connectivity. Source
operations and offline planning share `selectSourceBuffer`, including adoption
and deterministic ties. Once committed, source operations consume the committed
miner tile; an obstruction suspends specialists rather than moving infrastructure.

The planner combines terrain distance transform, flood fill, reusable modules,
and deterministic weighted paths:

- A rotatable core stamp reserves a manager at range one from storage, terminal,
  factory and core link. Its permanent access ring is protected; brownfield
  walls/assets can trim the ring while preserving independent accesses. Placement floods the
  future blocked footprint with the manager unavailable, then requires at least
  two accessible storage neighbors. Later modules preserve these accesses.
- Core scoring favors plains, clearance and proximity to Spawn1, sources and
  controller. Storage swamp carries a 500-point penalty, other core buildings
  80 each, and swamp access tiles 12 each. Each missing ring tile incurs an
  explicit 80-point geometry penalty and warning. The returned score also reports
  core logistics cost, road cost, clearance and incomplete-plan penalties.
- Sources get an adopted/planned container and miner tile, separate hauler
  access and future link. Links never sever protected accesses. Controller
  infrastructure includes a transitional buffer, upgrade tile, link and access.
- Small four-extension modules provide 60 unique mature extension coordinates
  with cross-shaped aisles. Dynamic room-level placement fits each module to
  real terrain; it does not apply one room-sized bunker stamp.
- Three spawns, six towers, power spawn, observer and nuker are exact intent.
  Ten labs are explicitly future reservations in a 4x4 module. Both input lab
  positions reach all eight reaction positions at range two. Lab construction
  and reaction behavior are deferred.
- Roads connect the core hub, spawns, sources, controller and module entrances.
  Existing/planned roads cost 1, plains 3 and swamps 15, so later routes reuse
  trunks. Roads are serialized once per coordinate and avoid manager/miner/work
  tiles. No minimum-cut or Steiner-tree solver is included.

Representative plans: [open room](roomplan-v1-open.svg) and
[wall-heavy room](roomplan-v1-walls.svg). These are generated from the normal
test fixtures with the offline renderer. Terrain, reservations and mature
coordinates are visible before any construction occurs.

## Runtime and brownfield policy

`observeRoomFacts` only normalizes observations. Construction commits one
versioned plan in `Memory.roomPlans[roomName]`, then uses pure `reconcilePlan`
to find missing legal structures. Every created site comes from that plan.
Storage is established at RCL4, early extensions and towers retain progression
priority, then buffers/core infrastructure. Extensions and towers nearer Spawn1
are scheduled first. The four-site budget and 25-tick interval remain; roads
run on 100-tick intervals while non-road sites are absent. Runtime limits use
`CONTROLLER_STRUCTURES`; the shared table supports ordinary offline tests.

The first plan is delayed when the CPU bucket is below 3000. Thereafter only
intent is persisted: coordinates, modules, reservations, routes, dispositions
and scoring. Terrain grids, pathfinding heaps and tick observations are not
stored. Host fixture generation took roughly 130–300 ms per room during review;
this is not a live Screeps CPU benchmark. No deployment was performed.

RCL progression, newly completed buildings, population losses and global resets
do not invalidate intent. Additional spawns do not change Spawn1. A version,
algorithm or Spawn1 mismatch pauses construction until an explicit replan.
Unplanned obstructions are reported rather than causing automatic relocation.
Natural anchors/terrain are assumed immutable within a World room; local resets
that change those facts require an explicit replan or clearing that room's plan.

Assets are classified as adopted, tolerated legacy, transitional or migration
candidates. Compatible source buffers and controller containers are adopted;
legacy roads/extensions remain and all observed assets/sites consume live
structure limits. Important built core assets constrain core adoption. If they
cannot fit the manager stamp, the planner returns an incomplete plan and warns
instead of planning destructive migration. This phase neither destroys
completed structures nor automatically removes conflicting construction sites.
Missing safe modules remain explicit feasibility reasons; legal partial intent
can still support early construction and worker recovery.

## Inspection and explicit replan

The console helpers are installed by the kernel:

```js
roomPlan.show('E1S1')       // full committed future RoomVisual on every tick
roomPlan.hide('E1S1')
roomPlan.preview('E1S1')    // compute a candidate; leave committed intent unchanged
roomPlan.replan('E1S1')     // explicitly replace intent; does not remove any assets
Memory.roomPlans.E1S1      // identity, score, feasibility, warnings, full intent
```

The overlay labels core storage/terminal/factory/link, manager, extensions,
spawns, towers, source miners/buffers, controller work area and reserved labs;
roads are gray dots. Core is gold, sources green, controller blue, labs purple.

For offline review without a Screeps runtime or credentials:

```bash
node --import tsx tools/room-plan/inspect.ts facts.json .local/room-plan
```

This writes a serializable plan and an SVG. Discovery adapters for local/MMO
can supply this schema later; neither adapter may introduce another layout
engine. This PR intentionally leaves existing room-selection scoring unchanged.

## Verification

The normal `npm test` / `npm run check` path includes RoomPlan regressions:

| Acceptance | Evidence |
| --- | --- |
| Determinism / shared boundary | Repeated and reordered plain facts produce identical serialized plans; standalone compilation excludes Screeps ambient types; import boundaries forbid runtime/API dependencies |
| Core access / terrain | Independent mature-footprint flood with manager blocked; two permanent storage accesses; all core relationships range one; swamp-closet and unavoidable-swamp fixtures |
| Future space / completeness | Coordinate validity and uniqueness; reservation compatibility; 60 extensions, six towers, three spawns, core/source/controller intent and ten lab reservations |
| Roads | Trunk reuse beyond the common hub; unique coordinates; stationary tiles excluded; bounded representative road count |
| Construction | Live simulated RCL2–8 buildout checks every created site against committed intent, budget, limits and future reservations |
| Brownfield / recovery | Source/container adoption, transitional controller, harmless legacy assets, conflict preservation, JSON Memory reload and blocked miner tile fallback |
| Debugging | Overlay call assertions cover every required category; offline generated representative SVGs |
| Change control | Dedicated `exp/roomplan-v1`; draft PR only; no merge, deployments, ranking/configuration or infrastructure edits |

The archetypes include open, swamp-heavy, unavoidable swamp, wall-heavy,
awkward controller, adjacent edge sources and brownfield rooms. The previous
road-covered-core test now covers every eligible room tile because planning
searches the whole room; its original no-overwrite/no-placement assertions remain.

Known limits: greedy module placement is conservative and can report
infeasibility even when a more complex packing exists. Tower positions do not
optimize defense topology. No automatic migrations, stationary manager behavior,
lab operations, power processing or link-transfer policies are added. Preview
before explicitly replanning an established colony; existing assets may prevent
the candidate from reaching full mature capacity without a later migration phase.
