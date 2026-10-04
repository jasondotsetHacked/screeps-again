# Vision: an autonomous Screeps empire

## Purpose

The goal of this project is not merely to create a bot that can survive in
Screeps or automate a collection of creep roles.

The long-term ambition is to build an autonomous empire that can compete at the
highest levels of Screeps: World: operate 40+ rooms, expand intelligently,
develop efficient economies, trade and manufacture, fight serious wars against
strong human opponents, recover from losses, and continue improving without
routine human control.

The target is not a pile of increasingly complicated scripts.

The target is a system that can:

- observe reality;
- preserve useful knowledge;
- form explicit objectives;
- allocate resources;
- act through bounded executors;
- measure the result;
- recover from failure;
- expose bad assumptions;
- revise strategy;
- continue operating.

The development ethos is simple: formalize vague problems, automate decisions,
instrument the system, let the live world expose wrong assumptions, and keep
removing unnecessary human intervention from the loop.

---

## Competitive ambition

A mature version of this bot should be able to:

- operate dozens of owned colonies;
- bootstrap and recover colonies without manual creep spawning;
- scout and understand a large region of the world;
- select and manage profitable remotes;
- expand deliberately rather than opportunistically;
- move resources between colonies;
- use storage, links, terminals, labs, factories, power infrastructure, and the
  market;
- maintain strategic reserves;
- defend against sophisticated attacks;
- plan and execute offensive campaigns;
- use boosts and military logistics deliberately;
- coordinate multiple colonies during war;
- learn from historical economic and combat outcomes;
- remain operational through partial failures and Memory loss;
- function unattended for long periods.

The aspiration is not simply "high rank." The architecture should be capable of
supporting a bot that could eventually contend for the top of the persistent
world.

---

## Core architectural model

Keep facts, decisions, intent, resource allocation, and execution separate.

A useful long-term model is:

    Observation
        ↓
    World / colony facts
        ↓
    Intel
        ↓
    Assessment
        ↓
    Designation / strategic intent
        ↓
    Operation
        ↓
    Resource requests
        ↓
    Colony / empire arbitration
        ↓
    Assignments
        ↓
    Creep / structure execution
        ↓
    Measured outcome

Each layer answers a different question.

### Observation

What is visible right now?

Examples:

- room ownership;
- structures;
- sources;
- hostile creeps;
- resource amounts;
- controller state;
- creep positions;
- construction sites.

Observation describes reality without assigning strategic meaning.

### Intel

What durable facts have we learned about the world?

Intel should preserve useful observations with timestamps and confidence while
remaining separate from strategic conclusions.

A room being owned by another player is intel.

Whether attacking that room is desirable is not.

### Assessment

What does the available evidence imply for a particular purpose?

Examples:

- remote mining suitability;
- expansion quality;
- military risk;
- economic value;
- route quality;
- confidence based on intel freshness.

Assessment should remain derived and recomputable where practical.

### Designation

What has the empire deliberately decided?

Examples:

- this room is an approved remote;
- this room is an expansion target;
- this border is strategically important;
- this room is being evacuated;
- this player or region has a particular strategic posture.

Designations represent durable intent rather than raw observations.

### Operations

Operations turn strategic intent into ongoing objectives.

Examples:

- local source operation;
- remote mining operation;
- reservation operation;
- scouting operation;
- defense operation;
- expansion operation;
- power-bank operation;
- military campaign.

Operations may request resources and capabilities.

They should not directly seize them.

---

## Ownership and decision boundaries

### Creeps execute

A creep should generally know:

- its identity;
- its home;
- its operation or assignment;
- what immediate action it has been told to execute.

A creep should not decide empire strategy.

A miner should not decide whether a remote is economically worthwhile.

A scout should not approve expansion.

A soldier should not decide whether a war should begin.

Execution code should remain as small and replaceable as practical.

### Colonies decide local work

A colony should own its local resources:

- spawn capacity;
- local energy;
- local infrastructure;
- local worker allocation;
- local defense;
- local logistics.

Operations request colony resources rather than spawning or consuming those
resources directly.

This preserves recovery priorities and prevents one subsystem from bypassing the
rest of the economy.

### The empire decides strategic allocation

As multiple colonies appear, an empire layer should coordinate decisions that
cannot be solved correctly by one room alone.

Examples:

- which colony should support a remote;
- where the next colony should be founded;
- which colony should spawn military units;
- where boosts should come from;
- which terminal should supply resources;
- whether a weak frontier colony should be reinforced or abandoned;
- how much energy should be retained for war versus expansion.

The empire layer should coordinate colonies rather than replacing their local
decision-making.

Avoid creating a single god planner that duplicates every colony decision.

A useful future pattern is:

    Empire objective
        ↓
    capability/resource requests
        ↓
    colonies report cost and capacity
        ↓
    empire selects support plan
        ↓
    colonies execute local commitments

---

## Persist strategy, recompute tactics

Persistent state should be used primarily for durable facts and commitments.

Examples worth persisting:

- an approved remote;
- an active invasion;
- a colony ownership relationship;
- a diplomatic or strategic designation;
- an evacuation order;
- an expansion target.

Short-lived tactical choices should generally be recomputed.

Examples:

- which hostile to focus this tick;
- which worker services a repair demand;
- which hauler serves a particular sink;
- which adjacent tile a creep should use;
- which damaged creep should receive healing right now.

A useful rule is:

> Persist commitments. Recompute execution.

This reduces stale state while still allowing the empire to make decisions that
require commitment across many ticks.

---

## Recovery is a first-class capability

The bot should be designed around imperfect states.

It should not require an ideal colony before useful behavior can resume.

Important recovery cases include:

- total creep loss;
- specialist loss;
- spawn loss;
- infrastructure destruction;
- broken logistics chains;
- stale world intel;
- failed operations;
- partial Memory corruption;
- complete Memory reset;
- temporary CPU pressure;
- route failure;
- colony collapse.

Whenever a specialized system becomes unavailable, the bot should degrade toward
simpler behavior instead of becoming inert.

A powerful bot that only works when healthy is fragile.

A top-level bot should be difficult to permanently disable.

---

## Logistics should evolve toward resource flow

Early logistics can use explicit roles and bounded pipelines:

    source
      ↓
    miner
      ↓
    source buffer
      ↓
    hauler
      ↓
    consumer

That is appropriate while the architecture is young.

Long term, logistics should increasingly reason about:

- supply;
- demand;
- transport capacity;
- distance;
- urgency;
- resource type;
- opportunity cost.

Examples of supply:

- source containers;
- storage;
- terminals;
- labs;
- factory output;
- remote rooms.

Examples of demand:

- spawn energy;
- towers;
- controller buffers;
- builders;
- workers in the field;
- labs;
- factory inputs;
- terminal reserves;
- military staging.

Transport mechanisms may include:

- creeps;
- creep-to-creep transfer;
- links;
- terminals.

The eventual goal is not to create a separate hard-coded logistics system for
every new structure.

The goal is a general resource-flow model capable of selecting an appropriate
transport mechanism.

A future worker should be able to express something like "I need 150 energy near
this job" and allow logistics to decide whether the best answer is a nearby store,
a hauler delivery, a direct creep handoff, or another transport layer.

---

## Movement is infrastructure

Cross-room travel should not become a collection of moveTo calls scattered
through creep code.

Movement will eventually need to account for:

- room routes;
- border transitions;
- arrival conditions;
- stuck detection;
- repathing;
- highway preference;
- source-keeper danger;
- hostile rooms;
- portals;
- traffic;
- formation movement;
- roads;
- route cost;
- CPU usage.

The travel abstraction should begin simple but remain replaceable so more
advanced routing can be introduced without rewriting every creep executor.

At large scale, pathfinding and movement are resource-management problems.

---

## CPU is an empire resource

A bot operating dozens of rooms cannot treat CPU as an unlimited implementation
detail.

The kernel should eventually behave like a small operating system.

Critical work should run every tick:

- combat execution;
- movement;
- spawning;
- critical logistics;
- safety.

Other work can run at different cadences:

- room planning;
- route refresh;
- intel assessment;
- base planning;
- market analysis;
- strategic optimization.

Optional expensive work should respond to bucket health.

When CPU is constrained, the bot should shed lower-priority thinking before it
sheds survival behavior.

Long-term instrumentation should make CPU cost visible by subsystem rather than
only reporting one total number.

At scale, the bot should be able to answer questions such as:

- how much CPU does combat consume?
- how much goes to colony logistics?
- how much goes to world assessment?
- which planners are responsible for bucket pressure?
- what can safely be delayed?

---

## Base planning is strategic infrastructure

Early construction may reasonably place useful structures opportunistically.

That cannot remain the final model.

A mature colony needs a durable concept of its physical layout, including:

- storage/core;
- spawns;
- extensions;
- towers;
- terminal;
- labs;
- factory;
- links;
- observer;
- power spawn;
- nuker;
- roads;
- controller logistics;
- source logistics;
- defensive ramparts;
- traffic lanes.

Base geometry affects:

- logistics efficiency;
- CPU;
- travel time;
- tower coverage;
- siege resistance;
- nuke resistance;
- repair throughput;
- spawn redundancy;
- combat movement.

The eventual base planner may be terrain-aware rather than one universal bunker,
but structure placement should become deliberate and explainable.

Phase 3.1's controller buffer and RCL4 core/storage reservations are early steps
toward that larger model, not the final base planner.

---

## Combat is a first-class AI domain

Serious warfare cannot be reduced to an attack role.

Long-term combat systems will need to reason about:

- hostile body composition;
- boosts;
- melee damage;
- ranged damage;
- ranged mass attack;
- healing;
- ranged healing;
- dismantle;
- fatigue;
- tower damage and falloff;
- ramparts;
- terrain;
- formations;
- focus fire;
- kiting;
- breach paths;
- retreat;
- reinforcement;
- replacement timing;
- attrition;
- boost cost;
- energy cost;
- nuke timing;
- staging;
- terminal support.

Military operations should eventually combine strategic planning with fast
tactical execution.

A useful future capability is limited combat simulation:

> If this force attacks that defense under these conditions, what is likely to
> happen over the next N ticks?

The bot should avoid committing expensive boosted armies based only on simplistic
rules.

Top-tier combat also means defending against an opponent who deliberately tries
to exploit the bot's assumptions.

---

## Adversarial thinking

A competitive Screeps opponent is actively trying to break assumptions.

Future systems should be reviewed not only by asking:

> Does this work?

but also:

> How would a strong player make this fail?

Examples include:

- blocking routes;
- exploiting borders;
- manipulating target selection;
- timing attacks around creep replacement;
- draining tower energy;
- forcing inefficient spawn decisions;
- threatening multiple colonies simultaneously;
- baiting military forces;
- exploiting stale intel;
- using unusual body compositions;
- attacking logistics instead of the obvious military target.

Adversarial testing should eventually become part of normal development.

---

## Measure the empire

A sophisticated bot needs feedback.

Important metrics may eventually include:

- source utilization;
- mined energy per tick;
- energy transported per hauler-life;
- average hauler fill percentage;
- spawn utilization;
- travel cost;
- controller progress;
- repair burden;
- storage growth;
- remote profitability;
- remote downtime;
- reservation cost;
- colony energy balance;
- boost consumption;
- military losses;
- damage inflicted;
- operation success rate;
- colony recovery time;
- CPU by subsystem.

The purpose is not telemetry for its own sake.

The purpose is to replace assumptions with observed results.

Instead of permanently encoding:

    three haulers should be enough

the bot should eventually be able to observe:

    this route historically reaches full throughput with two haulers

Instead of:

    remote rooms under distance X are good

the bot should eventually reason from actual net return.

This does not require machine learning.

Measurement, history, and adaptive heuristics alone can create a much stronger
system.

---

## Live reality outranks elegant assumptions

Simulation and unit tests are essential, but Screeps contains emergent behavior
that simplified tests will miss.

Examples include:

- traffic;
- congestion;
- creep collisions;
- intent timing;
- unexpected resource competition;
- hostile behavior;
- pathing edge cases.

When live behavior exposes a bad assumption, the architecture should make that
assumption easy to identify and revise.

The Stage 3 live rollout is the model: the architecture worked, but the real room
immediately exposed source-buffer contention, tiny hauler trips, idle loaded
haulers, and missing downstream sinks. Phase 3.1 then refined policy rather than
defending the original implementation.

The development loop should favor:

    design
      ↓
    simulate
      ↓
    deploy
      ↓
    observe
      ↓
    measure
      ↓
    revise

Do not defend an abstraction merely because it is elegant.

The game is the final integration test.

---

## AI strategic supervision

External AI can eventually become an additional strategic layer above the
in-game autonomous system.

A possible architecture is:

    Screeps runtime
        ↓
    private telemetry / intel
        ↓
    authenticated MCP
        ↓
    AI strategic supervisor

The AI supervisor may periodically inspect:

- colony health;
- logistics;
- economy;
- world intel;
- operation history;
- CPU;
- remote profitability;
- military conditions;
- market conditions.

This review may happen on scheduled cadences such as:

- hourly operational review;
- daily strategic review;
- event-triggered incident review.

The AI may notice cross-domain patterns that fixed planners do not yet model
well.

Examples:

- a remote has been losing value for several hours;
- one colony is consistently overproducing haulers;
- an enemy border is weakening;
- the empire is expanding faster than its reserves support;
- a recurring telemetry pattern indicates a planner defect.

An external AI should operate like a strategic supervisor or staff officer, not
a replacement tick loop.

### AI must not be required for survival

This is a hard architectural rule.

If ChatGPT, AWS, MCP, or every external service disappears, the Screeps empire
must continue operating.

External AI is supervision and strategic augmentation, not the life-support
system.

### AI writes should be narrow

If writable MCP capability is introduced later, avoid arbitrary execution
controls such as:

- move creep X to tile Y;
- write arbitrary Memory;
- spawn this body now.

Prefer narrow strategic directives such as:

- approve remote;
- pause operation;
- change strategic posture;
- designate expansion target;
- request military assessment;
- set reserve target.

The runtime must validate all directives against its own safety and resource
rules.

AI directives should ideally include:

- provenance;
- timestamp;
- reason;
- expiration or lease;
- scope.

The bot should remain capable of rejecting or overriding directives when
survival requires it.

---

## Two-speed autonomy

A mature system may effectively operate at multiple speeds.

### Fast layer

Runs continuously in Screeps:

- movement;
- combat micro;
- hauling;
- spawning;
- immediate defense;
- local recovery.

### Medium layer

Runs periodically inside the bot:

- operation planning;
- remote evaluation;
- economic balancing;
- route refresh;
- expansion preparation;
- stockpile planning.

### Slow AI layer

Runs externally when available:

- strategic review;
- anomaly analysis;
- cross-domain reasoning;
- long-horizon planning;
- architecture diagnosis.

The fast layer keeps the civilization alive.

The slower layers improve what the civilization chooses to do.

---

## External services are optional observability

AWS, MCP, dashboards, historical telemetry, and other external tools are highly
valuable.

They should help humans and AI understand the empire.

They should not become required runtime dependencies.

A useful rule is:

> External systems may observe and advise the empire. The empire must survive
> their disappearance.

---

## What we do not want to become

### A god planner

One giant system should not decide every creep action, colony decision, resource
movement, and empire objective.

Prefer composable planners with explicit ownership boundaries.

### Creep-side strategy

Creep execution should not quietly accumulate strategic decisions over time.

### Role-file sprawl

Do not solve every new problem by creating another self-contained role that
duplicates spawning, movement, logistics, and recovery logic.

### Persistent procedural state everywhere

Memory should not become a serialized copy of the runtime.

Persist durable facts and commitments.

Recompute temporary decisions.

### Cloud-dependent survival

External AI or infrastructure must not be required for basic operation.

### Special-case logistics everywhere

Prefer reusable supply/demand/resource-flow abstractions over one-off transport
systems.

### Feature development without recovery

Every major system should answer:

> What happens when this fails?

before it is considered mature.

### Optimization without measurement

Do not optimize based purely on intuition when telemetry can provide evidence.

---

## Development principles

When evaluating a new feature, ask:

1. Is this a fact, assessment, designation, operation, or execution concern?
2. Who owns this decision: creep, colony, operation, or empire?
3. Does this subsystem request resources or bypass arbitration?
4. What state truly needs to persist?
5. What happens after partial failure?
6. What happens after total Memory loss?
7. Can this planner remain deterministic and testable?
8. What is its CPU cost at forty colonies?
9. Can we measure whether it actually works?
10. How would an adversarial player break the assumptions?
11. Does this abstraction make future systems easier, or merely solve today's
    example?
12. Can the empire survive if this entire subsystem disappears?

These questions matter more than preserving any particular implementation.

---

## Current foundation

The current codebase is intentionally much smaller than this vision, but several
foundations already point in the desired direction:

- persistent versioned world observations;
- explicit population requests and spawn arbitration;
- recoverable creep identity;
- colony-level worker scheduling;
- local source operations;
- dedicated stationary miners and source-bound haulers;
- soft logistics fallback to generalist workers;
- controller working buffers;
- RCL4 storage/core planning;
- isolated colony execution;
- global safety arbitration;
- private telemetry and read-only MCP diagnostics.

These are building blocks, not claims that the larger vision is already solved.

---

## Long-term success condition

The final goal is not a bot that contains the largest number of features.

A successful system should be able to:

    observe the world
        ↓
    understand enough of it to act
        ↓
    choose objectives
        ↓
    allocate resources
        ↓
    execute those objectives
        ↓
    measure the outcome
        ↓
    recover from failure
        ↓
    revise bad assumptions
        ↓
    continue operating

At sufficient scale, that should apply to:

- economy;
- expansion;
- logistics;
- industry;
- markets;
- diplomacy;
- defense;
- warfare.

The desired end state is an empire that feels less like a pile of Screeps
scripts and more like an autonomous organization operating inside the game.
