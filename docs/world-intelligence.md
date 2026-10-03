# World intelligence and empire evolution

This foundation was based on main at `f5013bd`. It adds observation persistence,
without changing colony work, spawning, safety policy, or creep execution.

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
      hostiles: { creeps: number, towers: number, invaderCores: number }
    }
  }
}
```

Room identity is the map key, so positions omit repeated room names. Source count
is `sources.length`. Controller presence, ownership, and mineral presence use
explicit nulls. `owner` is the observed username; it is not a home colony or
designation. Sources are sorted by ID for deterministic projection. Mineral type
is recorded, not its changing amount. Hostile summaries contain standard hostile
creep count, non-owned tower count, and invader-core count, without entity lists,
combat bodies, structure inventories, or a stored strategic risk score.

`roomClass` uses the existing shared geometric classifier, including its central
source-keeper band convention. It does not assert that a keeper is present or that
a room is economically suitable. Classification is separate from ownership,
assessment, and designation.

All ticks are `Game.time` for the current shard. `lastSeen` means a successful
complete observation at the start of that tick. A new sighting replaces the whole
small record; vanished ownership, reservation, or hostiles are cleared. Unseen
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
Likewise, zero hostile counts are facts from `lastSeen`, not permission to operate.

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
- Older/malformed room entries rebuild when vision returns. Unseen entries remain
  stored, but `readRoomIntel` returns only validated v1 facts. The Memory room-map
  values are typed as `unknown` so future callers cannot accidentally skip this
  validation; retained old data is not silently treated as current facts.
- Future namespace versions disable writes. Future numeric room versions remain
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
| 1. Persistent room intel | This PR. Observe existing vision; no strategic consumers. | Current main | Projection, age boundaries, missing/old/future data, reset recovery, scan reuse, failure isolation, ops exclusion. |
| 2. Population requests and identity | Add pure spawn-demand arbitration and a runtime adapter. Workers remain the only active population initially. Define home/kind and optional operation identity; preserve recovery priority and count live/spawning/replacement bodies exactly once. | 1 for sequence; mechanically independent | Existing bootstrap/depletion/replacement behavior, deterministic priority, affordability, spawning identity cleanup, old worker metadata and orphan recovery. |
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

- **Spawning:** `runSpawning` currently selects one available spawn and calls a
  worker-only planner. Generalize requests above that adapter before adding roles;
  keep the 200-energy bootstrap and depletion priorities. Future replacement lead
  time needs destination travel estimates rather than the fixed worker allowance.
- **Identity/recovery:** `CreepMemory.kind` only permits workers; recovery recognizes
  `worker-<home>-...` names. New kinds need durable home/operation identity and a
  recovery naming contract. Physical room must not become population ownership.
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

## Validation of this foundation

Main's baseline: 107 passing tests and a 51,180-byte unminified bundle.
Foundation: 125 passing tests (18 added) and a 55,361-byte bundle: +4,181 bytes,
approximately +8.17%. `npm run check` runs typechecking, the full suite, and build.
`git diff --check` is also required before the draft PR.

Tests are local pure-function and mocked-runtime checks, including the unchanged
existing suite. No live CPU/Memory profiling, actual scouting, or live-world
behavior has been tested. No deployment, reboot, spawn placement, or merge was
performed. Suggested next PR: stage 2, preserving worker behavior while making
population identity and spawn arbitration ready for local source operations.
