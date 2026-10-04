# World intelligence and empire evolution

Stage 3 adds the bounded owned-room source logistics pilot documented in
[local-source-logistics.md](local-source-logistics.md). Stage 1/2 sections below
remain historical records; Stage 3 introduces miners/haulers without beginning
cross-room travel or remote mining.

Stage 1 was based on main at `f5013bd`. It added observation persistence,
without changing colony work, spawning, safety policy, or creep execution.
Stage 2 below builds on current main at `fdd8873` and separates population
requests, identity, arbitration, and spawn execution while retaining workers as
the only active population.

## Ownership boundaries

The kernel coordinates world observation and colonies. World facts belong to the
shard, not the colony that happened to provide vision. Future scouts execute
assignments and provide vision; the same room adapter records their observations.
Scouts do not score rooms, approve remotes, or request economic actions themselves.

Keep these concepts separate:

1. **Observation:** complete, tick-local facts from a visible room.
2. **Intel:** durable observations with their observation timestamp.
3. **Assessment:** derived suitability and confidence for a particular purpose.
4. **Designation:** durable approved intent, including the supporting home colony.
5. **Operation:** lifecycle and resource requests needed to carry out that intent.

Later operation planners request capacity; the home colony owns its energy and
spawn capacity and arbitrates those requests. No operation calls `spawnCreep`.
Local refill/build/repair/controller labor continues through
`observeColony -> planWork -> scheduleWorkers -> execution`. A structural source
assignment belongs to a source operation, not a new recurring `WorkDemand`.
World decisions and colony logistics should be small composable planners, not a
single empire planner that duplicates every colony decision.

## Current schema

`Memory.world` is optional, shard-local, and independent of `Memory.meta` v1:

```typescript
world: {
  version: 1,
  rooms: {
    [roomName]: {
      version: 1,
      lastSeen: number,
      roomClass: 'standard' | 'highway' | 'sourceKeeper',
      controller: {
        id: string, x: number, y: number,
        owner: string | null,
        level: number,
        reservation: { username: string, expiresAt: number } | null
      } | null,
      sources: { id: string, x: number, y: number }[],
      mineral: { id: string, x: number, y: number, type: string } | null,
      presence: { foreignCreeps: number, foreignTowers: number, invaderCores: number }
    }
  }
}
```

Room identity is the map key, so positions omit repeated room names. Source count
is `sources.length`. Controller presence, ownership, and mineral presence use
explicit nulls. `owner` is the observed username; it is not a home colony or
designation. Sources are sorted by ID for deterministic projection. Mineral type
is recorded, not its changing amount. Presence summaries contain non-owned standard
creep count, non-owned tower count, and invader-core count, without entity lists,
combat bodies, structure inventories, or a stored strategic risk score. The
`foreignCreeps` count uses `FIND_HOSTILE_CREEPS`, whose ownership filter means
"not mine"; foreign presence does not imply strategic hostility. No diplomacy or
threat assessment is applied.

`roomClass` uses the existing shared geometric classifier, including its central
source-keeper band convention. It does not assert that a keeper is present or that
a room is economically suitable. Classification is separate from ownership,
assessment, and designation.

All ticks are `Game.time` for the current shard. `lastSeen` means a successful
complete observation at the start of that tick. A new sighting replaces the whole
small record; vanished ownership, reservation, or foreign presence are cleared. Unseen
rooms are not rewritten, deleted, or relabeled as safe.

`intelFreshness(record, now, maxAge)` returns:

- `unknown` for absent, malformed, unsupported-version, or future-dated records;
- `fresh` when `0 <= now - lastSeen <= maxAge`;
- `stale` after that inclusive boundary.

The caller chooses `maxAge`. Economic topology, ownership, and threats will need
different tolerances. This PR does not set a strategic freshness policy. No
persisted `stale` flag needs updating each tick. Freshness measures observation
age; it does not guarantee present safety or complete threat knowledge.

Reservation `expiresAt` is `lastSeen + observed ticksToEnd`. It lets future readers
derive expected remaining duration without rewriting Memory. Expiry is not proof
that the room is currently unreserved: someone might renew it without our vision.
Likewise, zero foreign-presence counts are facts from `lastSeen`, not permission to operate.

## Projection, integration, and recovery

`shared/world/intel.ts` defines plain fact types, pure allowlisted projection,
record validation, a validated `readRoomIntel` accessor, and freshness. It imports no Screeps globals. Runtime inputs
are copied into primitive fields, so extra runtime properties cannot slip into
serialized Memory. Neither Room objects nor RoomPosition methods survive this
boundary.

`src/world/roomIntel.ts` adapts runtime rooms and writes only this namespace.
The kernel invokes it after colony observation and before safety arbitration or
colony execution. It covers **all rooms in `Game.rooms`**, including non-owned
rooms, using existing colony sources/structures/hostile scans when available.
Each room also needs one `FIND_MINERALS` lookup. Rooms without colony observations
use their own three scans. World observation failures are isolated per room; the
previous record remains unchanged and other rooms, safety, and labor continue.
Only a fixed private console diagnostic is emitted; intel failures are not sent
to the public ops error list.

There was no previous world-intel schema on main. No manual migration is required:

- Missing/null/damaged namespace containers initialize locally.
- Unversioned or v0 namespace headers advance to v1, preserving their room map
  and unrelated extension fields. No fictional legacy room schema is inferred.
- Malformed namespace versions (such as strings, negative/fractional numbers,
  null, NaN, or infinities) recover in place to v1. A structurally valid room map
  and extension fields are retained; its entries still require validation, and
  invalid room maps reset to an empty map. Unrelated Memory is unchanged. NaN and
  infinities serialize as null in JSON; both direct and null values recover.
- Older/malformed room entries rebuild when vision returns. Unseen entries remain
  stored, but `readRoomIntel` returns only validated v1 facts. The Memory room-map
  values are typed as `unknown` so future callers cannot accidentally skip this
  validation; retained old data is not silently treated as current facts.
- The earlier draft's `hostiles`-only room records fail current validation and
  rebuild with `presence` on new vision; no legacy facts or assessment are inferred.
- Valid integer namespace versions greater than 1 disable writes and remain
  unchanged during rollback. Future numeric room versions remain
  untouched even when visible, protecting them on a code rollback.
- Missing/damaged room maps reset only that map. Other Memory namespaces, creep
  identities, ops data, and `Memory.meta` are not migrated or wiped.
- A total Memory reset rebuilds intel from available vision. With no owned rooms
  or creeps, an empty map is valid; existing external start/reboot tooling and
  runtime worker bootstrap remain independent of intel.

## CPU, Memory, and privacy

Only compact current observations are stored, with no history, terrain arrays,
CostMatrix, path arrays, scans of unseen intel, or persisted assessments. Each
successful sighting writes a small record each tick, including its timestamp.
Owned-room scan reuse avoids three extra room scans. Projection work scales with
visible rooms and the existing source/structure/hostile lists; Memory scales with
rooms observed over time. The two-source test fixture serializes below 700 bytes;
this is a local example, not a universal size bound or a live measurement.

Screeps still serializes the complete Memory containing retained unseen intel;
cheap incremental writes do not eliminate that cost. A bounded scouting region
and eventual retention policy should be considered when adding scouting. No
premature garbage collection discards useful unseen facts in this foundation.

`Memory.world` stays private. The public GitHub bridge continues reading only the
existing allowlisted `Memory.ops` snapshots. No new intel command, room listing,
score, designation, route, or arbitrary Memory dump is exposed. Future telemetry
must choose coarse sanitized summaries explicitly.

## Shared analysis to reuse later

- `shared/world/rooms.ts`: reuse coordinates, classification, distance, and
  regional enumeration. This PR reuses classification directly.
- `shared/world/terrain.ts`: reuse position types now; later use the source-access
  and compact terrain metrics with a suitable adapter and an explicit CPU budget.
- `shared/world/pathing.ts`: reuse pure terrain-cost analysis where justified.
  Its 2,500-cell search is not an in-game travel abstraction and is not invoked
  by this PR.
- `tools/world/scoreRoom.ts` and the pure analysis inside `scanRegion.ts`: when
  assessment needs them, extract reusable input types and scoring dimensions to
  shared modules, with adapters for API scans and in-game intel. Keep missing-data
  confidence explicit. Do not feed sparse intel fake terrain/path metrics or use
  the existing starting-room score as a remote score.
- `tools/world/findStart.ts` and `spawnPlan.ts`: retain account/shard selection,
  credentialed API access, and expensive initial spawn search in tools. Extract
  only pure reusable calculations when an actual planner requires them.

## Suggested PR sequence and test boundaries

| Stage | Scope and coherent runtime boundary | Dependencies | Tests |
| --- | --- | --- | --- |
| 1. Persistent room intel | Complete. Observe existing vision; no strategic consumers. | Original main | Projection, age boundaries, missing/old/future data, reset recovery, scan reuse, failure isolation, ops exclusion. |
| 2. Population requests and identity | Current slice. Pure population accounting and spawn-request arbitration plus a runtime adapter. Workers are the only producer/executor. Define home/kind and optional operation identity; preserve recovery priority and count live/spawning/replacement bodies exactly once. | 1 for sequence; mechanically independent | Existing bootstrap/depletion/replacement behavior, deterministic priority, affordability, spawning identity cleanup, old worker metadata and orphan recovery. |
| 3. Local source operations and logistics | Pilot local source assignments with miner and hauler needs, expected income and measured/estimated hauling need. Enable only with a usable mining tile/buffer and affordable support; retain generalists during bootstrap or logistics loss. Coordinate container placement with the chosen mining position. | 2 | Source assignment uniqueness, buffer readiness, miner replacement, hauling cycles, shared supply contention, miner/hauler loss, total population wipe and low-energy fallback. |
| 4. Cross-room travel | Add an execution helper with destination room/position, range, deliberate borders, invalid-destination handling, and basic stuck/repath recovery. Keep local workers on their existing movement behavior initially. | 2 for identity | Entry/exit transitions, border destinations, arrival, invalid destinations, lost vision, blocked steps, reset of travel state. Mocked intents are not live travel tests. |
| 5. Scouting | Pure bounded scouting needs from missing/stale intel, colony-supported spawn requests, and scout assignments using travel. Scouts collect vision; the world adapter still owns fact projection. Use conservative refresh and population limits. | 1, 2, 4 | Missing/stale target selection, bounded scope, deterministic assignment, death/replacement, unaffordable requests, denied/closed destinations, successful intel refresh. |
| 6. Assessment and designation | Extract shared pure analysis/scoring from tools; derive remote suitability/confidence from intel and explicit missing facts. Keep approved target/home intent separate from scores and facts. No remote activation yet. | 1, 5 | Agreement between tool/runtime adapters on common facts, incomplete/stale input, ownership exclusions, intent persistence/revalidation, no creep-side strategy. |
| 7. First remote mining operation | One approved home-supported remote and a small source set; operation requests miner/hauler resources and uses existing logistics/travel. Gate start on sufficient home capacity, usable fresh intel, and a supportable route/buffer. Pause on uncertainty/threats; no automatic claiming. | 2, 3, 4, 6 | Resource requests never spawning directly, home recovery precedence, outbound/return logistics, stale intel, loss of vision, route denial, miner/hauler death, safe suspension. |
| 8. Operation lifecycle and multiple homes | Strengthen pause/resume/abandon/replacement, travel-based forecasting and ownership arbitration across existing colonies. Add reservation requests only with a demonstrated economic need. Require complete current-world recovery tests before further expansion. | 7 | Two homes competing for one target, home loss/reassignment, operation wipe, account wipe, reservation economics if added, deterministic recovery without duplicate populations. |

Stage 3 is an intentionally complete local logistics slice: shipping miners
without a viable hauling/buffer path would leave the economy incoherent. Keep the
pilot bounded; separate preparation changes if implementation proves too large.
Stages 2/3 and 4/5 prepare independent capabilities that converge at stage 7.
Stage 6 can be reviewed while keeping all economic activation disabled.

## Existing architecture that needs later changes

- **Spawning:** Stage 2 makes `runSpawning` an adapter for an arbitrated population
  request and retains one available spawn attempt per colony per tick. Add future
  producers above arbitration and keep home recovery priorities. Future replacement lead
  time needs destination travel estimates rather than the fixed worker allowance.
- **Identity/recovery:** Stage 2 centralizes durable kind/home/optional operation
  identity; the kind union still permits only workers. Recovery recognizes the
  deployed `worker-<home>-<base36 suffix>` contract and respects valid Memory.
  New kinds need explicit recovery contracts, especially for lost operation
  identity. Physical room must not become population ownership.
- **Dispatch:** the kernel runs only owned colonies, and colonies execute only
  worker creeps. Scouts and remote specialists need explicit assignment execution
  outside the local worker scheduler, exactly once even while away from home.
- **Movement:** worker movement uses `maxRooms: 1`, and scheduling/acquisition
  filters target room. Preserve those local constraints while introducing travel
  for cross-room executors; simply increasing maxRooms everywhere is insufficient.
- **Economy/construction:** existing generalists harvest opportunistically and
  containers are placed using source-to-spawn paths. Source operations must
  coordinate dedicated positions, buffers, reservations and hauling throughput;
  local demand scheduling remains responsible for consumers.
  The current worker scheduler requires both WORK and CARRY, so carry-only haulers
  need explicit logistics assignments/execution rather than being passed through
  `runWorker` as if they were generalists.
- **Memory:** world facts stay shard-wide. Future designation and operation intent
  need separate versioned stores with target/home identity. Recompute requests,
  assignments, live room objects, transient risk, scores and runtime indexes.

Do not implement scouts, stationary miners, haulers, spawn-demand generalization,
designations, scores, route planning, remotes, reservation, or an empire planner
in stage 1. Autonomous expansion/claimers/pioneers, combat doctrine, inter-shard
coordination, map-wide data collection, and advanced economic forecasting remain
later work beyond this sequence. Multi-colony support is a prerequisite for an
explicit future expansion operation, not permission to claim rooms automatically.

## Stage 1 validation (historical)

Main's baseline: 107 passing tests and a 51,180-byte unminified bundle.
Foundation: 127 passing tests (20 added) and a 55,430-byte bundle: +4,250 bytes,
approximately +8.30%. `npm run check` runs typechecking, the full suite, and build.
`git diff --check` is also required before the draft PR.

Tests are local pure-function and mocked-runtime checks, including the unchanged
existing suite. No live CPU/Memory profiling, actual scouting, or live-world
behavior has been tested. No deployment, reboot, spawn placement, or merge was
performed. Suggested next PR: stage 2, preserving worker behavior while making
population identity and spawn arbitration ready for local source operations.

## Stage 2: population requests and creep identity

The useful boundary is generic population/spawn infrastructure alongside existing
worker-specific labor. `WorkDemand` still describes refill/build/repair/upgrade
labor; it is not a population or operation abstraction. `main.ts`, the worker
scheduler, `runWorker`, movement, safety, construction policy, world intel, and
ops telemetry formats are unchanged.

```text
observeColony -> worker population projection
             -> requestWorkerPopulation -> PopulationRequest[]
             -> planSpawn (home capacity / pure arbitration)
             -> SpawnPlan -> runSpawning -> spawnCreep

observeColony -> planWork -> WorkDemand[] -> scheduleWorkers -> execution
```

`src/spawning/population.ts` counts a selected durable identity scope across live
and spawning representations. A name denotes one body. Live excludes spawning;
aging is a subset of live; effective is live minus aging plus spawning. TTL equal
to replacement lead counts as aging; undefined TTL retains the prior behavior.
Valid live identity wins over conflicting spawn metadata. Missing live identity
can use spawn metadata only without a conflicting partial kind/home/operation.
Unknown names are not interpreted by accounting: recovery happens first.
Colony observation supplies all Game identities, even foreign ones, so filtering
the local labor pool cannot hide conflicting ownership from accounting.

### Request and arbitration contract

`PopulationRequest` describes **one needed body**, not a persistent queue or a
target population. It contains a unique home-scoped `id`, durable `identity`,
priority (`bootstrap`, `recovery`, `normal`), concrete body, initial execution
Memory, reason, and a diagnostic explanation. Initial execution Memory excludes
identity and birth fields; the adapter supplies those centrally. Producers decide
population targets, bodies, replacement lead, and initial state. Only
`requestWorkerPopulation` produces requests today, using the existing worker
policy. An unmet need remains visible even when currently unaffordable.

`planSpawn` accepts home, requests, available energy, and capacity. Before selecting
a winner it rejects malformed request fields, empty/over-50-part/sparse bodies,
unknown body parts, and nonfinite/nonpositive part or total costs. Initial execution
Memory must be an object without identity/birth fields. It then filters other homes
and rejects **every** structurally valid local request sharing an ID, even identical
duplicates or requests with different operation identities. Malformed and foreign
requests do not invalidate a valid local ID. Uniqueness is enforced independently
of input order; callers cannot decide a collision winner through ordering.

Remaining requests order bootstrap before recovery before normal and use lexical
request ID ties independent of input order. Affordability is checked only after
winner selection. A valid unaffordable highest-priority
request reserves its place; lower priorities and later peer IDs wait. This
conservative policy protects recovery and preferred-body waiting. It can starve
lower-priority requests; future producers must bound needs and select priorities
deliberately. Inputs and requests are not mutated.

`runColony` composes the producer and arbitrator. `runSpawning` receives only the
resulting plan and the home colony's observed spawn capacity. It tries the first
idle spawn once, creates Memory/name, calls `spawnCreep`, returns the attempted
name/request ID/result, and logs the producer's explanation only on success.
No worker targets, bodies, execution initialization, or role dispatch live in
the adapter. Future operations supply requests to the home colony; they must
not call spawning directly. There is no empire planner or spawn queue.

### Identity, compatibility, and recovery

`src/creeps/identity.ts` owns `{ kind, home, operationId? }`. `home` is durable
population ownership, independent of physical room. `operationId`, when supplied,
identifies a separate population scope; absent operation identity is the ordinary
worker pool. No ordinary worker writes it. `CreepKind` deliberately remains
`'worker'`; introducing another kind requires its producer and executor in a later
slice, rather than advertising roles that do not exist yet.

`CreepMemory` extends the optional identity fields and retains `working`, `born`,
and `sourceId` in their deployed flat layout. Memory schema v1 is unchanged; no
manual migration or new strategic namespace is required. Valid worker Memory
is authoritative even if its name disagrees. Existing worker names stay
`worker-<home>-<tick in base36>`. Missing or malformed bot-named identity can
recover; conflicting nonempty kind/home fields and malformed operation intent
are left untouched. Unrelated names and foreign homes are not adopted.

Live recovery preserves unrelated fields and prior birth tick and initializes
`working` from carried energy as before. Spawn-only orphan recovery restores
identity before observation and initializes `working: false`. Cleanup retains
live and spawning creep entries and removes dead entries only. Duplicate spawn
representations do not duplicate bodies or recovery logs. Workers away from home
still count toward home population; only local workers enter local labor.

Recovery names cannot reconstruct a lost operation ID. Future operation populations
need their own recovery/assignment contract before activation. The current single
attempt per home/tick keeps the existing naming suffix safe within this path;
parallel spawn servicing would need distinct suffixes and tick-local capacity
reservations. No such multi-spawn throughput change is included here.

### Worker behavior and validation

Worker targets and body construction remain unchanged. The existing worker spawn
decision function is unchanged: 200-energy emergency bootstrap, critical threshold
`max(1, floor(target / 3))`, preferred normal body when affordable, full-body waiting
when healthy, and aging replacement lead from spawn time plus the existing travel
and safety allowance. Spawn-only workers count, live/spawn overlap counts once,
and total workforce loss recovers through the new pipeline.

Baseline measured on `fdd8873`: 181 repository tests plus 73 MCP tests, all passing.
Stage 2: 218 repository tests plus the same 73 MCP tests, all passing (**37 added**;
254 -> 291 combined). Failures, cancellations, skips, and todos are zero in both
runs. Added coverage includes 3,360 worker-policy comparison cases in one test,
pure arbitration, affordability/priority waiting, operation scopes, home ownership,
adapter initial Memory, metadata conflicts, orphan/spawn recovery, dead cleanup,
duplicate representations, total wipe, and preferred replacement waiting.
The arbitration robustness review adds seven focused tests beyond the original
211-test draft: malformed requests cannot block valid peers, valid unaffordable
winners still wait, and duplicate IDs are rejected deterministically within home.

`npm run check` passes typecheck, repository tests, MCP tests, and bot build.
`npm run aws:validate` and `npm run mcp:validate` pass SAM lint validation without
AWS/MCP changes. `git diff --check` passes. Unminified `dist/main.js` changes from
**55,430 to 60,422 bytes**, **+4,992 bytes (+9.005953%)**. The robustness follow-up
changes the original draft's 59,155-byte bundle by **+1,267 bytes (+2.141831%)**.

Population counting uses tick-local maps/sets in O(C + S) time and space per home
for supplied live and spawning representations. Arbitration validates body parts,
counts local IDs in a tick-local map, and sorts the remaining R requests in
O(B + R log R), where B is total inspected parts (at most 50 per request), with
O(R) extra space; today R is at most one. Identity projections, requests, plans, and
attempt results are recomputed and never persisted. Normal worker Memory gains
no serialized fields. Recovery retains the existing per-home creep scan and adds
a scan of current spawns. No extra room finds or in-game pathfinding are added.
These are structural estimates, not live CPU benchmarks; validation uses pure
functions and mocked runtime fixtures. No live-world test or deployment was run.

### Deferred behavior and Stage 3

This slice adds no miners, haulers, scouts, reservers, defenders, claimers, remote
workers, source/remote operations, room assessment/scoring/designation, travel,
routing, expansion, reservation logic, new strategic Memory, or generalized empire
planner. AWS/MCP infrastructure and deployment paths are unchanged.

Suggested Stage 3 remains **Local source operations and logistics**: a bounded
stationary-miner and hauling pilot with usable mining tiles/buffers, coordinated
containers, affordable support, replacement and logistics-loss recovery, and
generalists retained for bootstrap. Source operations should request home capacity
through this boundary and use their own assignments/executors. Carry-only hauling
must not be routed through the WORK + CARRY worker scheduler. No Stage 3 behavior
is activated here.
