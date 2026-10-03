# Colony labor planning

The colony owns task selection. Workers execute one assignment or acquire energy;
they no longer choose between colony priorities.

```text
observeColony(room)
    → ColonyState
    → planWork(state)
    → WorkDemand[]
    → scheduleWorkers(state, demands)
    → WorkerAssignment[]
    → runWorker(creep, assignment, energyContext)
```

`main.ts` still only invokes the kernel. The kernel isolates room errors, collects
tick results, and publishes sanitized ops telemetry. `prepareColony` recovers
worker memory, observes once, and emits a pure safety request. The kernel collects
all requests, arbitrates, and executes at most one safe-mode activation. It then
passes each observation to `runColony`, which runs towers, construction-site
placement and spawning, then plans, schedules, and executes workers with individual
error isolation. A later execution failure cannot discard an already considered
safety request; an observation failure is isolated to its room.
Construction exceptions are recorded without aborting spawning or labor. Worker
exceptions remain individually isolated. New construction sites enter labor planning on the next observation, one tick
after placement. Construction placement rules are unchanged.

## Runtime state

`ColonyState` contains the room, controller ID/position/level/downgrade buffer and
RCL timer limit, room energy, sources, structures, sites, owned spawns/towers,
hostiles and their active combat capabilities, critical owned spawn/tower/controller targets,
safe-mode eligibility, local creeps, home-worker objects, normalized energy supplies,
normalized eligible
worker capabilities/positions/energy, and the existing population/replacement
plan. Target projections contain refill deficits, remaining construction work,
and infrastructure damage. Each room find category is gathered once for this
observation. Spawning, towers, workers, and successful-colony telemetry reuse it.

Home-worker population still includes aging workers and workers outside the
room, and deduplicates the Game/spawn representations of spawning workers through
`planWorkerPopulation`. Labor candidates exclude spawning and out-of-room workers.
The scheduler also requires usable WORK/CARRY for current self-harvesting generalists
and rejects immobile workers unless energized and already in action range.

State, demands, assignments, and source-load counts exist only for the current
tick. No persistent creep or colony assignment fields are added. Only compact
aggregated labor telemetry is stored in the existing ops snapshot.

## Demands and scheduling

A `WorkDemand` has a stable ID, kind, target ID/position, numeric priority,
minimum contribution, desired contribution, optional hard maximum, capability
unit (`work` or `carry`), and an optional emergency flag. There are target-specific
refill, build, repair and upgrade demands, rather than new creep roles.
Contributions measure active body parts, not measured throughput. Refill budgets
use the deficit divided by 50 energy per unboosted CARRY part. Construction uses
at most 40% of colony WORK per site, bounded by remaining progress divided by
BUILD_POWER; repair uses at most 20%, bounded by damage up to the existing 45%
health threshold divided by REPAIR_POWER. These are simple allocation budgets.

The pure scheduler sorts demands by descending priority and ID. It first
reserves each minimum, then fills bounded desired budgets with remaining workers.
Each worker is consumed at most once. A candidate score favors energized workers
already working (+20), proximity (minus Chebyshev range), useful capability,
and smaller overshoot (minus two per excess capability unit). Within an equal
priority tier it compares all eligible worker-target pairs before selecting the
best one; demand IDs then worker names break score ties. A nearby peer target
therefore wins over a distant target even if its ID sorts later.
This favors retaining a nearby working creep without persistent assignments.

Workers are indivisible: desired/minimum may be exceeded by the last whole body,
but never the normal hard maximum. After all bounded desired work has had a chance
to schedule, demands may explicitly opt into a third low-priority surplus pass
with their own surplus maximum. The controller upgrade demand uses this only as a
productive sink for workers that would otherwise be idle; creep execution still
contains no fallback task selector. Unmet minima and desired budgets remain
visible in telemetry. Assignments record whether they came from the minimum,
desired, or surplus pass. This greedy comparison costs O(D × W² + D log D) in
the worst case for D demands and W workers; at the current small generalist
population it needs no pathfinding or global optimization. Large future labor
pools should revisit this cost before expanding the population policy.

Normal desired-pass priority retains spawn → extension → tower refill, then
controller desired service, extension → tower → container → other non-road
construction, repair (lowest health first), and roads. Controller minimum service
is reserved before optional throughput. Critically depleted colonies give
spawn/extension minimum refill service priority 99. Hostile-present tower refill
has priority 98 and minimum service. These can precede non-emergency controller
service when the workforce cannot satisfy both. Only after all bounded desired
work has had its scheduling opportunity may otherwise-idle workers take the
controller's very-low-priority surplus service.

## Controller policy

Let `L = CONTROLLER_DOWNGRADE[level]` and `W = total eligible WORK`. Define
`comfortable = max(4,000, 0.8 × L)` and
`uncomfortable = max(3,500, 0.5 × L)`.

| Controller buffer | Minimum WORK | Desired WORK | Priority |
| --- | --- | --- | --- |
| At least comfortable | 1 | ceil(20% × W) | 60 |
| Uncomfortable through comfortable | 1 | ceil(30% × W) | 60 |
| 3,000 through uncomfortable | ceil(30% × W) | ceil(45% × W) | 95 |
| Strictly below 3,000 | all W | all W | 1,000 |

All normal budgets are bounded by available WORK. With two or more capable
workers, the normal budget also leaves at least the smallest worker's WORK for
other tasks. Maximum allocation is `min(normal budget, desired + largest WORK
body - 1)`, giving the last indivisible worker rounding slack. Minima are clipped
to desired. With zero workers there is no executable upgrade demand.

The live downgrade limit at RCL2 is 10,000 ticks. A controller that has just
leveled is initialized to 50% of that limit (5,000 ticks), but the policy uses
the full live RCL limit: comfortable starts at 8,000, declining is 5,000–7,999,
dangerous is 3,000–4,999, and emergency is strictly below 3,000. At RCL3 the
limit is 20,000, so the normal boundaries are 16,000 and 10,000. A five-worker
colony with four WORK per worker requests 4, 6, 9, or 20 WORK across the four
RCL2 bands before optional surplus service. Healthy bounded service assigns
approximately one worker while other work exists.

The official [controller documentation](https://docs.screeps.com/control.html)
describes the varying RCL downgrade timers. The [API documentation](https://docs.screeps.com/api/#Creep.upgradeController)
describes upgrading's 100-tick buffer restoration. The policy reserves service
early instead of letting endless roads drive the colony into emergency. WORK
shares support progress and recovery availability; they are not a forecast of
buffer restoration, energy supply, or travel duty cycle. No historical rate
estimator or persistent time series is introduced.

Below the unchanged strict 3,000-tick threshold, the scheduler reserves every
capable worker for upgrading before routine work. Empty workers still acquire
energy; an emergency worker with any energy uses its partial load immediately.
Unreachable/blocked controllers and colonies with insufficient energy cannot be
made safe solely by allocation.

## Execution, survival and transitions

Normal workers retain `working` hysteresis: zero energy starts acquisition, a
full store starts execution, and partial loads retain the current phase.
Observation projects sources, energy drops of at least 20 energy, containers,
tombstones, and ruins once. Spawn, extension and tower energy never enters the
withdrawal supply list. Supplies under private hostile ramparts are excluded.
The pure acquisition selector minimizes estimated travel plus acquisition ticks
per usable energy. Harvesting estimates use active WORK and cached source WORK
contention; withdrawals/pickups take one action tick. Chebyshev distance remains
a cheap travel proxy. A nearby useful recovered store can beat harvesting;
one-energy scraps do not automatically pull a worker away from a productive source.
Existing `sourceId` breaks exact score ties, and selected sources update the
tick-local WORK load. When all supplies are depleted, the selector chooses a
source using travel and its regeneration timer. Normal source harvesting remains
the fallback, with no persistent acquisition assignment.

Accepted pickups/withdrawals and travel toward them reserve that energy within
the tick so later workers do not all plan to consume the same small store.
These reservations are discarded next tick; they are not long-term claims.
Harvest intents subtract only their immediate estimated intake. Action movement
still uses reusePath 10 and maxRooms 1. Missing targets wait for the next tick's
plan rather than activating a second worker priority tree.

Bootstrap bodies, critical-depletion spawning, full-body replacement waiting,
replacement lead time, spawning deduplication, memory recovery, controller
emergency protection, tower attack/heal/repair decisions, error isolation and
ops publication remain. Towers act separately before site placement.
Safety policy and arbitration are described below. No account reboot, spawn
placement, or deployment is part of this migration.

Generalist workers and self-harvesting source allocation remain transitional.
Construction still places its own sites and performs its own periodic scans.
Towers remain independent of worker scheduling. There is no miner/hauler role,
remote mining, reservation, managed storage logistics, expansion, or rate forecasting.

Known limits: a greedy scheduler may leave a bounded budget unsatisfied when
whole bodies cannot fit its hard cap, and may change assignments as readiness
changes. Travel scores do not account for terrain or blocked paths, and temporary
energy reservations can change which supply a worker pursues on later ticks.
Refill budgets use CARRY capacity rather than actual transfer throughput;
demand is reobserved next tick. Otherwise-idle eligible generalists are sent to
explicit low-priority controller surplus service, but energy scarcity and travel
can still limit delivered work. Normal controller service can be starved during
severe recovery or defense scarcity. Boosts and RCL8's upgrade rate limit are not
modeled as throughput constraints. Live CPU and behavior have not been benchmarked;
this change is validated locally without deployment.

Future miners, haulers and remotes can add demand kinds, capability measurements,
eligibility and energy-acquisition routes without restoring task selection inside
workers. Targets already carry room positions; cross-room travel and remote
population ownership require explicit future policy. Stationary workers will need
logistics rather than the transitional self-harvesting eligibility rule.

## Safety requests and global arbitration

`observeSafety` projects active body damage (including relevant boosts), healing,
CLAIM and movement capability, fatigue, hostile health/shields, owned barrier
health, and tower energy/activity. It reuses room scans; only a nearby CLAIM
approach needs a local terrain check. No combat pathfinding is added.

For owned spawns/towers, potential incoming damage combines the larger of melee
or dismantle damage with ranged damage, summed across nearby attackers. An
unfatigued mobile attacker may close one tile before the next tick, so melee/
dismantle reaches two tiles and ranged reaches four for this warning. Request
protection when `(structure hits + owned rampart hits) / incoming damage <= 20`
ticks. Healthy structures and strong barriers therefore do not spend a charge
for proximity alone; weak barriers do not suppress protection indefinitely.

An eligible active, energized, unmodified tower may remove a structure threat
without safe mode only when every attacker is estimated to die to this tick's
actual closest-target tower allocation and the structure survives a full incoming
burst. Estimates include tower falloff, all in-range healing, and a conservative
TOUGH reduction applied to the entire damage amount. Hostiles under ramparts or
active effects receive no kill credit; towers with active effects receive no
credit. A close decoy cannot let the same tower promise multiple kills. This
is a conservative heuristic, not a combat simulator or a claim of guaranteed kills.

Controller threats are distinct: only active CLAIM can attack the controller.
An adjacent claimer requests urgent protection. A mobile, unfatigued claimer at
range two also requests protection if it can take one walkable step into attack
range; terrain walls, blocking structures, and private owned ramparts are respected.
A barrier breakable by the current in-range hostile damage is treated as an
unsafe approach, including a supporting dismantler opening the tile.
CLAIM requests do not rely on tower kills. Range two matters because the engine
applies [controller attack blocking](https://github.com/screeps/engine/blob/master/src/processor/intents/creeps/attackController.js)
before [committing safe-mode activation](https://github.com/screeps/engine/blob/master/src/processor/intents/controllers/tick.js).
An already adjacent attacker can cancel an activation whose API call returned OK.
First observation after arrival, portals, and unexpected movement can still miss
that window; an accepted intent must never be interpreted as confirmed protection.

Colony eligibility retains availability, current protection, cooldown, upgrade
blocking, and the official [downgrade eligibility rule](https://github.com/screeps/engine/blob/master/src/processor/intents/controllers/activateSafeMode.js).
`arbitrateSafety` selects among all eligible requests before any activation:
lowest projected deadline first, then asset value (sole spawn 4, controller 3,
additional spawn 2, tower 1), then higher RCL, then stable room/target IDs. CLAIM
deadlines are zero when adjacent and one when approaching. Charges belong to
individual controllers; only one room per shard can have active safe mode.
Existing protection anywhere prevents another request. At most one activation
is attempted per tick, and rejected/throwing actions do not interrupt colony
labor. A rejected winner is reconsidered next tick, not replaced by multiple
activation attempts in the same tick.

Known safety limits: the 20-tick horizon assumes current hostile damage continues;
it does not forecast routes, new reinforcements, repairs, or diplomacy. Structural
approach uses range rather than pathfinding. The global ranking is explicit and
deterministic, but not a strategic empire valuation. No policy can guarantee
survival against an already executing lethal burst or an already landed controller
attack. These policies are tested locally; live game behavior is still unmeasured.

## Observability and verification

Every existing ops snapshot interval includes total demands, controller emergency,
and four fixed kind summaries with capability unit, demand count, minimum,
desired, assigned, bounded versus surplus contribution, unsatisfied desired,
unsatisfied minimum, and assigned workers. Per-kind counts distinguish accepted
acquisition, travel, accepted work, and blocked execution. `acceptedWorkIntents`
counts OK action responses; the engine resolves those intents later, so this
does not measure delivered work or throughput. Failed movement also reports
blocked execution. A compact safety reason/request/accepted result appears in
the private room snapshot, with a separate attempted flag distinguishing a request
from the globally selected action. Public room output only reports `no action`,
`activation accepted`, or `activation rejected`; eligibility/threat/arbitration
reasons and legacy safety exception messages are redacted. The ops formatter
accepts older snapshots without the new fields.
Summaries expose no raw objects, arbitrary Memory, console
output, or per-target assignment list. The public read-only command allowlist and
credential model are unchanged. `/screeps room` and `/screeps snapshot` show labor.

Tests cover observation/population reuse, controller bands, scheduler limits and
determinism, mixed work execution, acquisition with every assignment kind, source
load balancing, energy selection/reservations, safe-mode eligibility and the
global arbitration, construction exception isolation, emergency partial-load
behavior, stale targets, and sanitized telemetry,
alongside the existing recovery and security tests. Run `npm run check` for
typechecking, the full test suite, and the runtime bundle. A small multi-tick
harness resolves queued movement, energy acquisition/consumption, source
regeneration, construction progress/completion, and controller buffer restoration.
It checks ongoing construction alongside upgrading, depleted-source recovery,
emergency recovery from stored energy, and new targets after completion. It does
not model terrain, collisions, fatigue, boosts, hostile damage, or spawning;
existing spawning/recovery tests remain authoritative for population behavior.
Separate safety timing tests model start-of-tick controller attack range and
attack blocking before pending activation, including the already-adjacent race.
