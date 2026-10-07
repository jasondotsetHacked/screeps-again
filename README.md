# screeps-again

An autonomous Screeps: World codebase focused on world intelligence, planning, forecasting, self-recovery, and unattended colony growth.

## Long-term vision

The long-term goal is to build a fully autonomous Screeps empire capable of
operating dozens of rooms, expanding, trading, conducting industry, fighting
serious wars, recovering from losses, and improving its decisions from measured
results without requiring routine human control.

The architecture is intentionally growing around explicit observations,
persistent world intelligence, strategic designations, durable operations,
resource requests, bounded planners, and recoverable execution rather than
creep-side strategy or large stateful scripts.

Optional external AI supervision may eventually review the empire through
authenticated MCP interfaces, analyze long-term trends, and issue narrow
high-level strategic directives. The in-game bot must remain independently
autonomous and survivable if every external service disappears.

See [docs/vision.md](docs/vision.md) for the architectural north star and the
principles intended to guide future development.

## Development and project state

Use [the development workflow](docs/DEVELOPMENT-WORKFLOW.md) and [AGENTS.md](AGENTS.md)
for human and AI-assisted work. [Issues](https://github.com/jasondotsetHacked/screeps-again/issues)
track independently completable work; [milestones](https://github.com/jasondotsetHacked/screeps-again/milestones)
define near-term readiness; PRs preserve implementation and validation history.
The vision describes direction rather than a committed task list.

Track **Implemented**, **Automated-test verified**, **Local-lab verified**,
**Live-world verified**, and **Complete** separately. Passing `npm run check` or
merging a PR does not establish gameplay completion. Record local scenarios and
official-world shard/room/tick/time/telemetry evidence against the tested commit.

Current main includes colony labor/safety, population recovery, visible-room
intel, local miner/hauler operations, the Phase 3.1 controller-buffer/storage
transition, private AWS telemetry/MCP, and accelerated local-lab tooling. Some
acceptance evidence remains outstanding; see the workflow's audit and linked
issues. [RoomPlan v1 / PR #30](https://github.com/jasondotsetHacked/screeps-again/pull/30)
is an unmerged draft with automated coverage and pending local-lab and
official-world/brownfield acceptance. Scouting, cross-room travel, remote economy,
autonomous claiming, and a deeper economy forecaster remain future capabilities.

## V1 goals

- Play on the official persistent Screeps World.
- Analyze the live world before choosing a starting room.
- Recommend a starting shard, room, and Spawn1 position.
- Re-run that analysis after a future total account wipe.
- Bootstrap from one spawn with no manual creep spawning.
- Harvest, refill, build, repair, upgrade, and replace aging creeps automatically.
- Build early extensions, source containers, roads, and towers.
- Keep credentials and deployment secrets out of git.

## Local setup

Requires Node.js 22 or newer.

```bash
npm install
npm run mcp:install
cp .env.example .env
```

Create a Screeps API token and put it in your local `.env`:

```text
SCREEPS_API_TOKEN=your-token-here
```

Never commit the token. `.env` and world-analysis cache files are ignored by git.

## Validate and deploy

```bash
npm run check
npm run deploy
```

The deploy command explicitly targets **https://screeps.com**, builds `dist/main.js`, and uploads it to the Screeps code branch configured by `SCREEPS_CODE_BRANCH` (default: `default`).

For a disposable accelerated **native Windows** server, use the
[local Screeps lab](dev/local-screeps/README.md). Start with
`npm run local:bootstrap`; `npm run deploy:local` builds the **same runtime**
but uses separate `.env.local` credentials and a loopback-only API. The lab
defaults to 200 ms/tick and supports saved baseline restore for repeatable tests.
It requires no Docker, Mongo/Redis, AWS, or MCP deployment.

The isolated, read-only remote MCP gateway is documented in [private Screeps MCP](docs/private-screeps-mcp.md). `npm run check` includes its credential-free tests. MCP deployment is a separate, explicitly authorized operation.

## World intelligence

The runtime now records compact versioned observations of visible rooms in private
`Memory.world`, independently of colony ownership. See [world intelligence and the
empire roadmap](docs/world-intelligence.md) for the schema, freshness/recovery
contract, and staged plan. This foundation adds no scouts or strategic actions.

Useful commands:

```bash
npm run world:me
npm run world:shards
npm run world:room -- shard3 E12N34
npm run world:region -- shard3 E12N34 3
npm run world:find-start
```

### Find a starting room

```bash
npm run world:find-start
```

The tool:

1. reads the official shard list;
2. asks the server for a useful start-room search seed on each shard;
3. scans the surrounding region;
4. ranks viable unowned standard rooms;
5. evaluates terrain, sources, controller logistics, neighbors, expansion space, and shard density;
6. plans a recommended Spawn1 tile.

Use `--radius=N` with a value from 1 through 6 to change the regional search radius.

`shardX` is excluded by default because controller actions there require active Access Key access. Only include it intentionally with `--allow-shard-x`.

The scoring model is deliberately explainable and provisional. It is a decision aid that we can improve as the bot gathers more world history.

## Account reboot / first spawn

The same command path is used for today's dead account and a future total wipe.

First run a dry run:

```bash
npm run world:reboot
```

This scans the current world and prints the selected shard/room/Spawn1 tile. It does not mutate the account. The default reboot path excludes premium `shardX`; use `--allow-shard-x` only if you intentionally have active Access Key access.

Before committing a spawn:

1. run `npm run check`;
2. run `npm run deploy`;
3. review the reboot selection.

Then explicitly commit and pin the reviewed target:

```bash
npm run world:reboot -- --commit --expect=shard3/E25S47
```

Replace the example target with the exact `shard/room` printed by your dry run. If the live re-scan selects a different room, the command aborts without placing Spawn1 so the new selection can be reviewed first.

If the account is `lost`, the tool explicitly requests respawn, waits for the account to become `empty`, and then places Spawn1. If the account is already `empty`, it places Spawn1 directly. If the account status is `normal`, it refuses to reboot.

## In-game V1 behavior

Once Spawn1 exists, the runtime:

- detects owned rooms;
- emergency-spawns a 200-energy worker if the population collapses;
- scales worker bodies with room energy capacity;
- forecasts replacement lead time from spawn time + travel + safety buffer;
- keeps a target generalist-worker population;
- assigns workers across sources;
- transitions viable local sources to dedicated stationary-miner and source-bound-hauler operations while retaining generalist fallback;
- batches hauler loads and gives healthy source buffers soft hauler-first ownership without blocking recovery;
- plans a controller working buffer and reserves an RCL4 storage/core footprint for downstream logistics;
- reuses container, tombstone, ruin, and dropped energy through a shared acquisition planner;
- schedules refill, construction, repair, and controller labor centrally;
- chooses nearby worker–target pairs within each urgency tier;
- builds containers, extensions, towers, and limited roads;
- repairs damaged roads/containers;
- reserves ongoing controller upgrading alongside construction and roads;
- overrides routine work below the controller emergency threshold;
- uses towers for defense, healing, and emergency infrastructure repair;
- plans safe-mode requests for imminent critical structure loss or approaching controller attackers;
- arbitrates protection across colonies before issuing one activation intent;
- isolates construction failures so spawning and labor can continue;
- logs colony/runtime errors without intentionally stopping every room.

Ops snapshots distinguish bounded/surplus assigned capacity, worker acquisition,
travel, accepted work intents, and blocked execution. These describe planning
and accepted intents, not measured work delivered by the game engine. The runtime
publishes compact telemetry to private `Memory.ops`; the AWS collector reads only
that path and stores private history in DynamoDB. The former public GitHub issue
ops console is retired. See [AWS Screeps Ops](docs/aws-screeps-ops-foundation.md).

Private read-only history and diagnostics are available through an authenticated
query Lambda. Use `npm run aws:ops -- latest`, `npm run aws:ops -- history --hours 6`,
or `npm run aws:ops -- diagnose --room E25S47 --hours 6` after deploying the query
layer. The helper discovers the function from the CloudFormation stack output.

Workers remain generalists for refill/build/repair/upgrade work and recovery fallback, while viable local sources can transition to dedicated miner -> container -> hauler operations. Phase 3.1 adds batched hauling, soft source-buffer ownership, a controller working reserve, and an RCL4 storage/core transition. Remote mining, cross-room travel, advanced base planning, market logic, combat doctrine, and the deeper forecaster remain future work. See [local logistics refinement](docs/local-logistics-refinement.md), [the colony labor architecture](docs/colony-labor.md), and [the long-term vision](docs/vision.md).

## Public-repo security

- Never commit API tokens, passwords, session cookies, or credential files.
- Local secrets belong in `.env`.
- CI does not require Screeps credentials.
- Account mutation through the reboot tool requires the explicit `--commit` flag.

See [the development workflow](docs/DEVELOPMENT-WORKFLOW.md) for current issue
scope, evidence requirements, and milestone readiness; use [the vision](docs/vision.md)
for longer-term architectural direction.
