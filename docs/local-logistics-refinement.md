# Phase 3.1: local logistics refinement and RCL4 transition

## Goal and boundaries

Based on main `afbad48941e56eaf58955b7e584aeeb514e168dd`, after successful
Stage 3 live acceptance. Fix the observed small-deposit traffic pattern and
provide useful local energy destinations beyond spawn, extensions, and towers.
The Stage 3 worker target and one-to-three-hauler formula remain unchanged.

Colonies compose source operations, structure consumers, and tick-local energy
projections. Pure planners choose body policy, loading/delivery intent, supply
access, and layout slots. Executors issue local intents. Generic population
arbitration, spawning, identity recovery, worker scheduling, safety, world intel,
and `main.ts` retain their existing boundaries. No AWS/MCP changes are needed.

```text
local source -> stationary miner -> source buffer -> source-bound haulers
  -> critical refill
  -> normal spawn/extension/tower refill
  -> controller working reserve
  -> storage surplus

workers acquire downstream stores while a healthy chain supports them
  -> otherwise immediately regain source-buffer/self-harvest fallback
```

## Local miner bodies and replacement

`localMinerBody` produces 5 WORK + 1 CARRY + 1 MOVE for the standard owned
10-energy/tick source: 600 energy and 21 spawn ticks, saving 100 energy and six
spawn ticks versus Stage 3. One CARRY remains; simultaneous transfer/harvest and
exact stationary assignments are unchanged. Existing three-MOVE miners remain
valid. This policy is explicitly for home-room ingress; a future remote operation
must select its own mobility policy.

The former `travelTicks` conflated miner ingress with hauler consumer detours.
Operations now expose `minerIngressTicks` and `haulTripTicks`. The existing source
route is reused, with plain/road charged 1 and swamp 5. Miner ingress is:

```text
ceil(non-MOVE parts / MOVE parts) * (source route cost + 5)
miner replacement lead = spawn ticks + ingress ticks + 50 queue/slack ticks
```

The standard body uses multiplier 6. Including its empty CARRY as weight and
ignoring road speedups deliberately overestimates ingress. Adding 5 covers a
worst-case extra swamp tile at the exact mining position when reversing the
range-one spawn route. Fatigue scales with body weight and terrain; empty CARRY
does not generate fatigue, so this estimate is conservative. See
[Screeps movement mechanics](https://docs.screeps.com/creeps.html#Movement).

Hauler body sizing, balanced CARRY/MOVE, trip estimate, replacement lead, income,
and population cap retain Stage 3 policy. In particular, new downstream sinks
do not retune the existing refill-detour estimate. Worker bootstrap/recovery/
normal spawning still outranks logistics; miner startup precedes hauling, and
aging specialist replacements precede specialist expansion. The cheaper local
miner lowers the capacity prerequisite from 700 to 600 energy.

## Hauler loading and reservations

A hauler normally loads until it holds at least half its current energy capacity.
For an eight-CARRY body this is 200 energy, rather than a trip per 10-energy
deposit. Partial loads can keep withdrawing from their own buffer. Once dispatched,
delivery intent continues until empty, so a small refill does not send the body
back upstream with most of its load. With no valid consumer, a body can continue
loading spare capacity; a full body safely idles.

Critical demand overrides batching: existing refill minimum/emergency semantics
identify recovery spawn/extension demand and hostile tower refill. Emergency
controller service makes its working reserve critical too. Critical consumers
sort first, then normal work priority, proximity, and stable ID. Fulfilled critical
projections stop triggering new dispatches. Missing infrastructure, or failed
production with an empty source buffer, releases a partial load for useful delivery.

The colony persists only `CreepMemory.delivering`, a boolean load/use intent.
It contains no target, amount, promise, route, or reservation. Missing or malformed
intent is reconstructed from current load and demand; complete name-based identity
recovery remains unchanged. A reset during a small delivery may cause one extra
loading cycle, but cannot orphan an operation or require migration.

Only withdraw/transfer returning OK decrement projections. Accepted travel,
failed movement, and failed resource intents reserve nothing. Worker withdrawals
and refills retain the same rule. Downstream supplies describe observed energy,
not this tick's pending hauler deposits. Projections are discarded next tick.

## Soft source-buffer ownership and recovery

Haulers execute against the source supply projection first. Workers then normally
lose access to both a healthy operation's source buffer and direct harvesting
only when all of these hold:

- The full effective worker target and Stage 3 activation prerequisites hold.
- A saturating stationary miner has a usable harvest/deposit chain.
- Successful/usable haulers provide the operation's planned CARRY/MOVE capacity.
- A built reachable controller buffer or active owned storage contains at least
  one 50-energy worker load in the remaining observed projection.
- No emergency demand or critical refill minimum is active.

This includes tiny/empty source buffers: downstream energy, rather than a source
backlog, keeps nearby workers from consuming each new miner deposit. A downstream
site, pending delivery, or empty store cannot justify ownership. Miner/hauler loss,
bad damage, missing buffers, unusable paths, blocked intents, worker recovery, or
urgent service opens access immediately. Before downstream infrastructure supports
labor, the established Stage 3 store-access policy remains available.

`planWorkerEnergyAccess` supplies a second safety valve. If remaining general
supplies cannot provide a useful load, or an immobile worker cannot reach them,
it reopens original source supplies in this tick. All workers share those same
projection objects; accepted withdrawals cannot be promised twice. Source access
is reconsidered from observation next tick. There is no persistent ownership,
creep resource promise, or specialist dependency for worker recovery.

Workers benefit from the controller container through the existing supply-cost
planner, especially near the upgrade work area; no dedicated upgrader role or
worker scheduling redesign is introduced. Storage becomes an ordinary energy
supply without exposing spawn/extension/tower stores for withdrawal.

## Controller working buffer

On construction intervals the planner adopts an existing usable controller-area
container/site, excluding source buffers. For a new buffer, it selects a reachable
tile at controller range two, with adjacent room for labor. Spawn distance and
terrain space guide scoring; y/x resolve ties. Borders, walls, natural obstacles,
structures/sites, source tiles/buffers, and the core footprint constrain placement.

A distinct adjacent future controller-link slot within controller range two and
a worker stand within upgrade range three are reserved. The container therefore
does not consume the intended link position. These are layout reservations only;
no link is built or operated. Existing containers/sites are adopted without a
duplicate even when a perfect future footprint cannot fit.

The working reserve target is **500 energy**: ten basic 50-energy worker loads,
well below a container's 2,000 capacity. Its consumer promises only the observed
gap to 500, after critical and normal refills. Once that reserve is satisfied,
surplus can flow to storage. Accepted worker withdrawals naturally create fresh
reserve demand on the next tick. Container loss leaves source/generalist fallback.

## Storage core and RCL4 construction

A pure bounded layout planner reserves a four-tile core: storage, adjacent future
core link, adjacent terminal, and an accessible logistics stand. It favors short
spawn service, controller/source flow, and nearby usable terrain:

```text
core score = 4 * spawn distance + 2 * controller distance
             + sum(source distances) - usable terrain tiles in radius two
```

Candidates are within six tiles of spawn, at least two from spawn, four from the
controller, and three from sources. All slots stay inside coordinates 3..46.
Terrain-space scoring ignores ordinary expansion so building extensions outside
reserved slots does not change that score. Current occupancy and reachability
still constrain eligibility. The compact adjacent link/terminal/stand footprint
preserves mutual access while generic construction expands around it.

Reservations apply before RCL4 to generic extensions, towers, and roads, as well
as protecting source-operation tiles. Existing storage/sites become the durable
anchor. No layout Memory is added. If a reserved slot is already obstructed, a
different valid footprint may be chosen; built infrastructure is not removed.

Reachability checks include current and future obstacles. A transient flood from
spawn access validates the core after storage/link/terminal become obstacles,
preserves access to currently reachable source buffers, and checks controller
work access with its future link. A constrained room can receive no new planned
footprint rather than an unreachable strategic site.

At RCL4 one storage site is attempted **before** the extension-completion gate.
It uses one of the existing four site slots, leaving the rest for extensions.
Actual worker build priorities remain extension 55, tower 54, container 53, and
storage 52. Source containers precede the optional controller container after
the existing extension/tower site prerequisites. Thus storage's strategic site
can be established while its 30,000 construction work remains lower priority.
Duplicate built/site checks apply; controller/storage placement failures do not
require a functioning specialist chain for labor or spawning.

Built active owned storage accepts surplus after immediate consumers and the
controller reserve. It is worker-accessible and provides the long-term reserve.
Source haulers acquire only their own source buffer, never storage or another
operation's buffer; they cannot circulate storage energy back upstream. Full,
inactive, inaccessible, or destroyed storage is omitted as a delivery sink.

## CPU, Memory, and economy impact

Runtime sinks reuse colony structures, sources, demands, and supplies: no extra
room finds. At most two extra built-sink route checks run per tick, each using
the existing local `maxRooms: 1`, `range: 1`, `ignoreCreeps: true`, `maxOps: 2000`
policy. Absent downstream infrastructure incurs no extra sink path query.
Source routes are reused for miner ingress, with no added miner path query.

Layout runs only every 25 ticks when construction runs. It adds periodic
structure/site/source/mineral observations, bounded spawn-radius and controller
candidate scans, and a transient 2,500-cell walkability grid. At most eight
candidate footprints per area receive future-access checks; each flood visits
at most 2,304 interior tiles. No layout path cache, persistent grid/CostMatrix,
map-wide analysis, or cross-room path planner exists. Terrain/anchor scores are
computed once per candidate. Movement retains normal Screeps path reuse.

Heap allocations and all resource projections are tick-local. Serialized Memory
grows only by a load/use boolean per hauler; durable identity is unchanged. No
telemetry schema or infrastructure changes are introduced. Existing spawn logs
now distinguish ingress and hauling estimates; existing sanitized errors cover
optional downstream planning failure.

Each standard local miner saves 100 energy and six spawn ticks per replacement,
about 0.067 energy/tick over 1,500 ticks. Slower ingress and conservative overlap
consume some of that benefit. Batching should reduce small trips, while new sinks
increase useful haul utilization. Hauler population/body estimates are deliberately
unchanged pending live measurement; these are conceptual impacts, not CPU or
economic benchmark claims.

## Validation and independent review

| Check | Current main baseline | Phase 3.1 |
| --- | ---: | ---: |
| Repository tests | 303 | 345 |
| MCP tests | 73 | 73 |
| Combined tests | 376 | 418 |
| Failures / cancellations / skips / todos | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `npm run check`: typecheck, tests, build | Pass | Pass |
| AWS SAM lint | Pass | Pass |
| MCP SAM lint | Pass | Pass |
| `git diff --check` | Pass | Pass |
| Unminified `dist/main.js` | 79,770 bytes | 92,859 bytes |

**42 tests added**, including two focused lifecycle scenarios. Bundle delta is
**+13,089 bytes (+16.408424%)**. The suite covers body/ingress policy, partial
loading, critical overrides, shared reservations, healthy ownership and eleven
degradation cases, same-tick exhaustion and immobile labor, controller/storage
sink order and contention, storage supply/loop prevention, unavailable paths and
optional planning errors, deterministic layout/adoption, protected RCL3 expansion,
RCL4 storage before extensions, site budgets, future obstacle access, and Memory
recovery. Existing Stage 1/2/3, worker, safety, and wipe simulations remain green.

The new multi-tick scenarios resolve deferred intents: small miner deposits with
a nearby empty worker and approaching hauler demonstrate batching/ownership and
hauler-loss fallback; full refill pools demonstrate controller delivery followed
by storage while retaining delivery intent after a partial drop. The simulation
does not model traffic collisions, real terrain fatigue, or every engine intent
ordering rule. Body ingress is tested mechanically, not claimed as live acceptance.

Self-review covers the complete diff, especially resource-only reservations,
source/worker recovery, source-bound acquisition, and reserved-footprint access.
Independent review should focus on the half-load/500-energy thresholds, the
greedy footprint choices in established rooms, conservative one-MOVE ingress,
and CPU spikes on construction intervals. Live acceptance should measure actual
traffic, downstream starvation/fallback frequency, and hauling utilization.

Known limits: footprint selection tests the first eight ranked candidates per
area and can conservatively decline placement; occupancy outside reservations
can change accessibility before infrastructure exists. Built/adopted legacy
infrastructure is retained even if no ideal future slots fit. Worker acquisition
uses existing distance estimates, not an exact worker-to-store route planner.
Sink reachability connects through spawn access rather than simulating every
source-to-sink traffic path. Haul sizing retains its historical refill-detour
estimate and may be inaccurate for the new controller/storage flow. A one-MOVE
miner is intentionally slower to reposition after displacement; replacement is
best effort under worker survival and competing replacement requests.

No merge, deployment, or Phase 3.1 live-world validation is performed here.

## Deferred work

Future RCL5 links can use the reserved distinct controller/core slots after a
separate link policy review. The terminal slot is reserved without implementation.
No links, terminal behavior, labs, factory, bunker layout, or worker-count reduction
is implemented. No remote mining, scouting, reservers, claimers, cross-room travel,
empire logistics, or AWS/MCP deployment is included.

Creep-to-creep handoffs, interception, rendezvous, bucket chains, and persistent
resource-demand requests remain explicitly deferred. Shared structure-consumer
projections keep delivery policy above execution so a future resource-demand
planner can choose structure versus direct delivery without teaching executors
colony strategy. Cross-room travel remains a separate future stage.
