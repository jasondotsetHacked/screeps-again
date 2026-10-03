# screeps-again

An autonomous Screeps: World codebase focused on world intelligence, planning, forecasting, self-recovery, and unattended colony growth.

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

The deploy command builds `dist/main.js` and uploads it to the Screeps code branch configured by `SCREEPS_CODE_BRANCH` (default: `default`).

## World intelligence

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
- reuses container, tombstone, ruin, and dropped energy through a shared acquisition planner;
- schedules refill, construction, repair, and controller labor centrally;
- chooses nearby worker–target pairs within each urgency tier;
- builds containers, extensions, towers, and limited roads;
- repairs damaged roads/containers;
- reserves ongoing controller upgrading alongside construction and roads;
- overrides routine work below the controller emergency threshold;
- uses towers for defense, healing, and emergency infrastructure repair;
- requests available safe mode for immediate armed threats to owned spawns/towers;
- isolates construction failures so spawning and labor can continue;
- logs colony/runtime errors without intentionally stopping every room.

Ops snapshots distinguish bounded/surplus assigned capacity, worker acquisition,
travel, accepted work intents, and blocked execution. These describe planning
and accepted intents, not measured work delivered by the game engine.

Workers remain generalists. Dedicated miners/haulers, remote mining, advanced base planning, market logic, combat doctrine, and the deeper forecaster are future work. See [the colony labor architecture](docs/colony-labor.md) for the runtime pipeline, budgets, and transitional systems.

## Public-repo security

- Never commit API tokens, passwords, session cookies, or credential files.
- Local secrets belong in `.env`.
- CI does not require Screeps credentials.
- Account mutation through the reboot tool requires the explicit `--commit` flag.

See the project issues for the longer-term architecture and forecasting roadmap.
