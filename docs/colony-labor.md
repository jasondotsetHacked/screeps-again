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
tick results, and publishes sanitized ops telemetry. `runColony` recovers worker
memory, observes once, runs towers, construction-site placement and spawning,
then plans, schedules, and executes workers with individual error isolation.
New construction sites enter labor planning on the next observation, one tick
after placement. Construction placement rules are unchanged.

## Runtime state

`ColonyState` contains the room, controller ID/position/level/downgrade buffer and
RCL timer limit, room energy, sources, structures, sites, owned spawns/towers,
hostiles, local creeps, home-worker objects, dropped energy, normalized eligible
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

The pure scheduler sorts demands once by descending priority and ID. It first
reserves each minimum, then fills bounded desired budgets with remaining workers.
Each worker is consumed at most once. A candidate score favors energized workers
already working (+20), proximity (minus Chebyshev range), useful capability,
and smaller overshoot (minus two per excess capability unit); names break ties.
This favors retaining a nearby working creep without persistent assignments.

Workers are indivisible: desired/minimum may be exceeded by the last whole body,
but never the normal hard maximum. After all bounded desired work has had a chance
to schedule, demands may explicitly opt into a third low-priority surplus pass
with their own surplus maximum. The controller upgrade demand uses this only as a
productive sink for workers that would otherwise be idle; creep execution still
contains no fallback task selector. Unmet minima and desired budgets remain
visible in telemetry. Scheduling cost remains small and greedy, with no
pathfinding or global optimization.

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
full store starts execution, and partial loads retain the current phase. Nearby
energy drops (at least 20 energy and within four tiles) precede source harvesting.
Existing `sourceId` memory is reused. New source assignments balance cached home
worker counts and range, updating counts as workers execute. Action movement
still uses reusePath 10 and maxRooms 1. Missing targets wait for the next tick's
plan rather than activating a second worker priority tree.

Bootstrap bodies, critical-depletion spawning, full-body replacement waiting,
replacement lead time, spawning deduplication, memory recovery, controller
emergency protection, tower attack/heal/repair decisions, error isolation and
ops publication remain. Towers act separately before site placement. No account
reboot, spawn placement, or deployment is part of this migration.

Generalist workers and self-harvesting source allocation remain transitional.
Construction still places its own sites and performs its own periodic scans.
Towers remain independent of worker scheduling. There is no miner/hauler role,
remote mining, reservation, storage logistics, expansion, or rate forecasting.

Known limits: a greedy scheduler may leave a bounded budget unsatisfied when
whole bodies cannot fit its hard cap, and may change assignments as readiness
changes. Refill budgets use CARRY capacity rather than actual transfer throughput;
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

## Observability and verification

Every existing ops snapshot interval includes total demands, controller emergency,
and four fixed kind summaries with capability unit, demand count, minimum,
desired, assigned, unsatisfied desired, unsatisfied minimum, and assigned workers.
These measure assigned capacity, including workers acquiring energy; they do not
claim delivered work. Summaries expose no raw objects, arbitrary Memory, console
output, or per-target assignment list. The public read-only command allowlist and
credential model are unchanged. `/screeps room` and `/screeps snapshot` show labor.

Tests cover observation/population reuse, controller bands, scheduler limits and
determinism, mixed work execution, acquisition with every assignment kind, source
balancing, emergency partial-load behavior, stale targets, and sanitized telemetry,
alongside the existing recovery and security tests. Run `npm run check` for
typechecking, the full test suite, and the runtime bundle.
