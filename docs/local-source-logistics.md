# Stage 3: local source operations and logistics

Phase 3.1 refines the deployed Stage 3 pilot in
[local-logistics-refinement.md](local-logistics-refinement.md). That document
supersedes the miner body/replacement, hauler loading, buffer-access, and
construction policies below. This Stage 3 document retains its original
architecture and validation record.

## Goal and boundary

An established owned colony can transition viable local sources to dedicated
miner -> container -> hauler pipelines while its existing generalist economy
can recover from the loss of any part of the chain. This is a local pilot based
on main `ed596eca44e0049511a243c2650a86f1b57f4d1c`. No remote operations, travel
abstraction, world planning, infrastructure deployment, or worker target reduction
is included.

Previously workers selected sources or recovered stores, acquired their own
energy, and performed refill/build/repair/upgrade work. Source containers were
placed independently from the first source-to-spawn path step. Workers retain
their existing bodies, targets, acquisition planner, scheduler, and work kinds.

```text
shared colony observation
  -> owned local sources -> tile/buffer + income/trip estimates
  -> tick-local SourceOperation[] -> miner/hauler PopulationRequest[]
  -> worker requests + specialist requests
  -> planSpawn -> runSpawning -> spawnCreep

operations -> incumbent miner assignments -> runMiner
operations + energy/refill projections -> planHauling -> runHauler
remaining refill demand -> planWork -> scheduleWorkers -> runWorker
```

`sourceOperation.ts` contains pure tile ordering, body/throughput policy, readiness,
replacement lead, and population requests. `observeSources.ts` adapts owned-room
facts, adjacent terrain, and local paths. `runSourceLogistics.ts` composes planned
assignments and shared reservations at the colony boundary. Specialist executors
issue intents, validate identity/locality, and never select another operation or
spawn bodies. `main.ts` remains unchanged.

## Source identity, mining tile, and readiness

One operation is recomputed for each observed source in a functioning owned room.
Its identity is `{ home, operationId: "source:<source ID>" }`; kind distinguishes
its miner and hauler populations. Sources are sorted by ID. Physical creep room
never establishes population ownership.

The shared tile selector considers the eight adjacent tiles, excludes terrain
walls, blocking structures/private hostile ramparts, source/controller tiles,
and room borders. It adopts a usable built container first, then a valid owned
container site, then a placeable empty tile. Distance to the deterministic active
spawn, y, and x break ties. Before assigning a NEW buffer tile, the selector
checks a bounded local route and tries the next ordered candidate if the preferred
one is unreachable. Built buffers/sites are adopted without duplicating them;
unreachable adopted infrastructure remains inactive. The selected route time is
reused within this tick. Claimed tiles cannot serve two operations. The miner stands
on the selected container; buffer and mining position are the same tile.

Construction uses exactly those planned tiles, with the same selector available
for standalone calls. A container/site on the source's assigned tile prevents
duplicate placement. A shared adjacent container belongs to the operation that
adopted it; the other source can build its own distinct assigned tile. New placement
requires the selected tile's successful route check. Extension priority, tower
priority, four
new sites per planning interval, construction error isolation, and road behavior
are retained. New sites join shared observation on the next tick. Sites do not
count as ready buffers.

Readiness requires an owned controller, an active owned spawn, a usable built
container, enough capacity for the specialist bodies, a complete local path to
spawn range one, and an estimate of at most three haulers. The current owned
source miner costs 700 energy, so lower-capacity rooms stay worker-only. Paths
that fail or end early leave the source in fallback.

New specialist requests additionally require the full effective worker target
(including spawning workers), and at least two usable local WORK/CARRY/MOVE
workers. Existing specialists may continue useful work during worker recovery
when infrastructure remains valid; direct source access stays open to workers.
Loaded haulers can still deliver existing energy after buffer loss. Readiness
reasons are explicit planner outputs (`no-tile`, `no-buffer`, `no-path`,
`capacity`, `haul-limit`, `worker-recovery`, `colony-unavailable`, `ready`).

## Bodies, throughput, and spawning

Expected income is `source.energyCapacity / ENERGY_REGEN_TIME`: normally
3,000 / 300 = 10 energy per tick in an owned room. WORK harvests two energy per
tick. One miner has `ceil(income / HARVEST_POWER)` WORK, capped at five, one CARRY,
and `ceil((WORK + CARRY) / 2)` MOVE. A normal owned source uses 5 WORK + 1 CARRY +
3 MOVE, costs 700 energy, and takes 27 ticks to spawn. Its 50-energy store lets
harvest and deposit intents coexist without routinely filling its store.

Haulers belong to a source operation, rather than a shared unassigned pool. They
have balanced CARRY/MOVE pairs and no WORK. For one-way time T, nominal income I,
and body carry capacity C:

```text
cycle budget = (2T + 2 action ticks) * 1.2
desired CARRY parts = max(2, ceil(I * cycle budget / 50))
body pairs = min(desired parts, floor(room capacity / 100), 8)
hauler target = max(1, ceil(I * cycle budget / C))
```

Targets above three disable that operation's specialist activation. For I=10 and
T=4, a three-pair hauler costs 300 and carries 150, so one body covers the estimated
120 energy per cycle. T=20 uses eight pairs and two haulers; T=40 uses three.
This sizes short-trip bodies without requiring the room's entire capacity budget.

T reuses the selected tile's tick-local route estimate: plain/road terrain is
charged one tick, swamp terrain five ticks for the loaded balanced hauler. Road
swamps are deliberately overestimated. A five-ticks-per-tile Chebyshev allowance
from spawn to the farthest owned spawn/extension/tower covers a conservative
consumer detour. It is an estimate, not an exact sink route or traffic simulation.
All path queries are `maxRooms: 1`, `ignoreCreeps: true`, `range: 1`, `maxOps: 2000`.

Each needed body produces a unique request ID containing home, source operation,
and kind. Generic population counting deduplicates live/spawning representations
by name, isolates operation/home/kind, and excludes aging bodies from effective
population. Spawning bodies count toward their own operation immediately.
Replacement lead is body spawn time + T (2T for miner mobility) + 50 ticks of
queue/safety allowance. A stationary incumbent continues working while its
replacement waits nearby; only one miner is assigned to harvest each source.
Hauler requests require an effective miner (including spawn-only bodies). With no
miner, the producer requests mining first. When any enabled operation needs an
aging specialist replacement, the producer emits those replacement requests and
defers new specialist expansion until they are covered. These dependencies and
maintenance precedence belong to the producer; generic arbitration/adapter role
policy is unchanged.

Arbitration now orders **bootstrap > recovery > normal > logistics**. This
explicit category protects every worker replacement, independent of lexical IDs.
A valid unaffordable worker winner continues reserving its budget. Worker targets
and bootstrap bodies are unchanged. There is still one spawn attempt per colony
per tick. Operations only produce requests; the generic adapter remains the sole
`spawnCreep` caller.

Mechanics references: [Screeps API](https://docs.screeps.com/api/) and
[simultaneous actions](https://docs.screeps.com/simultaneous-actions.html). Intents
use start-of-tick observations; accepted intents do not guarantee engine success.

## Identity and Memory recovery

Specialists use `{ kind: "miner" | "hauler", home, operationId }` and require an
operation ID. The generic naming contract is
`<kind>-<home>~<URI-encoded operation key>~<base36 tick>`; the delimiter is escaped
inside keys and parsing requires canonical encoding. It carries no source
strategy in the spawn adapter. Local source IDs fit comfortably within Screeps'
name limit. Existing `worker-<home>-<base36 tick>` names remain unchanged.

Live and spawn-only orphan metadata recovers before observation. Conflicting
kind/home/operation intent is preserved rather than adopted. For specialists,
valid-looking Memory must also match the name's full recovery identity before
counting or dispatch. Corruption cannot silently change source A into source B,
or turn a specialist into a worker. Such bodies remain unassigned; workers cover
gaps and a correctly assigned specialist may replace the missing population.
Legacy valid worker Memory remains authoritative exactly as before.

No operation namespace, assignment cache, reservation Memory, migration, or
schema bump is introduced. Only durable creep identity/birth fields persist.
Workers retain `working`/`sourceId`; specialists add no task-state fields. Cleanup
still preserves live/spawning entries and removes dead entries only. Unrelated
Memory is retained. A total Memory reset reconstructs live/spawn specialist scope
from names; a total creep wipe bootstraps generalists before logistics.

## Execution, reservations, and degradation

The colony dispatches each valid specialist once from its home identity. Miners
travel to the exact tile with `range: 0`, harvest only the assigned source, and
transfer to its assigned container. Replacement overlap does not produce a
second harvesting miner. Off-tile miners without MOVE are ineligible for primary
assignment. Saturating miners rank ahead of underpowered movable incumbents, then
stationary position, TTL, and name break ties. A damaged movable occupant yields to
a healthy replacement via a free local waiting tile selected by the colony, even
if all WORK or CARRY parts are gone. An immobile tile occupant or one without a
safe yield tile remains in place; it can keep doing useful work and workers cover
any missing throughput. Invalid or missing objects stop acquisition safely.

Hauler planning separates acquisition and delivery. Empty haulers acquire only
their source buffer's observed energy; loaded haulers select owned refill
consumers using existing work priorities, then proximity and stable ID. Partial
loads deliver immediately. Workers remain responsible for building, repairs,
upgrading, and refill fallback. Neither specialist uses the worker scheduler.
Every movement intent stays within `maxRooms: 1`; away specialists remain owned
by home but do not attempt to return through another room.

Haulers execute before worker scheduling/acquisition. Accepted withdraw/transfer
intents returning OK reserve exact amounts in shared tick-local supply and
consumer projections. Hauler execution distinguishes resource, travel, idle, and
blocked outcomes. Travel never consumes supply or refill capacity, whether movement
succeeds or fails. Worker acquisition/refill reservations follow the same accepted
resource-intent rule, so an earlier traveling body cannot hide energy/demand from a
later in-range actor. Worker refill demands are replanned from remaining capacity;
worker runtime transfers also cap
their amount against that same projection. Worker acquisitions share the same
remaining supplies. Reservations reset from observations next tick, never persist,
and do not count pending miner deposits as already available energy.

Workers retain access to buffers for general labor. Direct harvesting is avoided
only while a saturating stationary miner has a usable deposit/harvest chain,
enough usable hauling CARRY/MOVE capacity exists, worker recovery is not active,
and at least 50 unreserved buffer energy remains. Missing specialists, blocked
intents, damaged throughput, empty/full buffers, or worker depletion release
direct source access immediately. Source depletion alone does not invalidate a
working miner. Full buffers can pause miners; worker consumption helps drain them.

Specialist errors are isolated per creep. Source-planning errors leave operations
empty and continue worker recovery/labor. Container construction errors remain
isolated. No specialist is required to generate or transport its own spawn budget.

## Telemetry and cost

Existing private creep telemetry already reports kind/home; its format and AWS/MCP
infrastructure remain unchanged. Producer spawn logs explain source population,
income, travel estimate, and replacement lead. Existing sanitized error records
cover planner/executor failure. No raw intel, route, remote strategy, or additional
`Memory.ops` fields are exposed. No AWS redeploy is required.

Operation observations reuse existing sources/structures/sites/refill projections;
they add no room finds to the per-tick shared observation. Eight adjacent terrain
checks per source are added each tick. Established buffers/sites use one bounded
local route check per source; selecting new tiles normally uses one check but may
try at most eight adjacent candidates, each capped at 2,000 path operations. This
also applies before capacity reaches the specialist threshold, so construction
avoids committing to unreachable buffers. Miner handoff planning reads adjacent
terrain and existing occupants for a safe waiting tile. No route cache or persistent
path data is introduced. Periodic construction still has its own existing scans;
the container helper adds two structure/site room finds per container-placement pass,
replacing per-source range finds and old placement paths. Movement retains normal Screeps path reuse.

Tile projection is O(8S(B+K)), for S sources, B structures and K sites; population
requests are O(S(C+P)), for C creeps and P spawning representations. Dispatch uses
small transient groups/projections; refill selection sorts local consumers per
hauler and workers plan work twice, before and after hauler reservations. Heap
objects are tick-local. Serialized Memory grows only with specialist identity and
existing per-creep telemetry; names are longer. These are structural estimates,
not measured live CPU or Memory benchmarks. Local pathfinding and extra intents
are the principal CPU costs to measure during live acceptance.

At an owned source the incremental economy costs one 700-energy miner plus one
to three haulers costing 200-800 each, bounded to 3,100 initial energy per source.
Miner replacement amortizes roughly 0.47 energy/tick over 1,500 ticks; haulers add
roughly 0.13-1.6, plus travel/replacement overlap. Worker population is unchanged,
so this adds spawn load before any future worker-count optimization. Miners aim
at nominal source saturation; actual logistics throughput depends on sink demand,
worker buffer consumption, terrain, regeneration, and congestion.

## Validation

| Check | Baseline main | Stage 3 |
| --- | ---: | ---: |
| Repository tests | 218 | 303 |
| MCP tests | 73 | 73 |
| Combined tests | 291 | 376 |
| Failures / cancellations / skips / todos | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Typecheck and build (`npm run check`) | Pass | Pass |
| AWS SAM lint (`npm run aws:validate`) | Pass | Pass |
| MCP SAM lint (`npm run mcp:validate`) | Pass | Pass |
| `git diff --check` | Pass | Pass |
| Unminified `dist/main.js` | 60,422 bytes | 79,770 bytes |

85 repository tests added versus main; MCP tests unchanged. Bundle delta versus
main is **+19,348 bytes (+32.021449%)**. The independent-review follow-up adds
**21 tests** (282 -> 303 repository; 355 -> 376 combined) and changes the reviewed
76,946-byte bundle to **79,770 bytes**, **+2,824 bytes (+3.670106%)**. Focused coverage
includes deterministic sources/tiles, adoption,
no duplicates, sites and readiness gates, bodies/throughput, arbitration under
adversarial IDs, replacement/deduplication, scope integrity and reset recovery,
stationary mining, source-bound hauling, shared supply/refill promises, fallback,
damage, failed movement, exceptions, and local-only movement. New review coverage
includes distant loaded haulers leaving recovery Spawn/extension/tower demand to
energized in-range workers, traveling workers preserving refill/supply capacity,
shared-container/site construction ownership, reachable alternative tiles, damaged
miner handoff (including zero WORK/CARRY), immobile stationary miners, miner-first
startup, and aging replacement ahead of expansion. Eight lifecycle simulation
scenarios plus a focused two-tick miner handoff exercise energy/travel cycles,
specialist death, buffer loss/restoration,
specialist wipe, full colony wipe, low energy, and Memory reset. Existing worker,
safety, Stage 1 intelligence, and Stage 2 arbitration tests all pass.

The lifecycle model resolves deferred movement/energy/work/spawn intents and TTL
expiration. It does not emulate collisions, terrain fatigue, every engine intent
ordering rule, or the complete extension energy pool (modeled as one refill store).
These tests are not live-world validation. No deployment, merge, or live acceptance
was performed.

## Limitations and later stages

The conservative detour/swamp estimate can leave viable sources in fallback or
overprovision hauling. Paths are recomputed rather than cached; constrained/failed
paths and unusable adopted buffers stay fallback rather than triggering a layout
rewrite. Replacement lead is best effort under competing worker requests and
multiple specialist replacements. Collision/stuck behavior relies on existing
`moveTo` handling and requires live acceptance. Accepted resource intents still
require engine resolution; projections clear next tick. Travel contributes no
resource reservations. An immobile damaged tile occupant cannot be safely forced
off its tile; a replacement waits until that occupant expires. A movable occupant
without a free safe yield tile waits until a handoff is possible. No persistent
promises or guaranteed intent resolution exist.

Haulers service refill structures, not creep-to-creep transfers or an advanced
storage network. Generalists still acquire energy for construction/upgrade/repair
and may harvest during transient chain gaps. Malformed conflicting specialist
metadata is quarantined rather than reassigned. No damaged-body retirement system
or optimized shared-hauler balancing is added. The full worker target is retained
deliberately to protect proven recovery behavior.

Deferred: remote mining, scouts, cross-room travel, room scoring/designation,
reservers/reservation, claimers/expansion, combat doctrine, multi-colony balancing,
market/empire planning, generalized route caches, map-wide analysis, inter-shard
behavior, and AWS/MCP deployment changes. Suggested Stage 4 remains **Cross-room
travel**, with explicit room/border/arrival/stuck handling. Do not begin it here.
