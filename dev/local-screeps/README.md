# Accelerated local Screeps lab

This is a disposable **native Windows** Screeps: World server. It runs the same
`src/main.ts` bundle as MMO, using built-in JSON storage; no Docker, WSL, Mongo,
Redis, AWS, or MCP provisioning is involved.

| Command | Destination | Credentials | Default code branch |
| --- | --- | --- | --- |
| `npm run deploy` | **https://screeps.com**, fixed in code | `.env`: `SCREEPS_API_TOKEN` | `SCREEPS_CODE_BRANCH`, or `default` |
| `npm run deploy:local` | Loopback local API only | `.env.local`: `SCREEPS_LOCAL_API_TOKEN` | `SCREEPS_LOCAL_CODE_BRANCH`, or `local` |

Both build and upload `dist/main.js` as the `main` module and activate
`activeWorld`. Local deployment creates the branch if needed, downloads the
uploaded code to compare it byte for byte, and verifies branch activation.
Local deployment never reads `.env`, uses MMO credentials, or falls back to a
password. Its URL fence accepts only `localhost`, `127.0.0.1`, and `[::1]`
HTTP(S) origins, without paths, query parameters, fragments, or user info.
`localhost` is normalized to `127.0.0.1`; redirects are refused.
There is no remote-host escape hatch.

## Prerequisites and pins

- Windows x64 (tested here) or arm64 (release asset supported, not tested).
- Node.js 22+ and the repository's npm dependencies: `npm ci`.
- Internet access for GitHub, nodejs.org, and npm package downloads.
- Screeps' native modules require Python and Visual Studio C++ Build Tools
  (the Desktop development with C++ workload). The launcher compiles them.
  Bootstrap uses existing tools; it does **not** install machine-wide build
  tools. If compilation fails, install these explicitly and rerun bootstrap.
- Steam/Screeps client and a Steam Web API key are **optional** for an
  API-only lab. A real Steam Web API key is required for a player-owned
  Steam/OpenID session in the Steamless browser client; see the player section.

In PowerShell, use `npm.cmd` in place of `npm` if script execution policy
blocks `npm.ps1`. No execution-policy change is needed.

Verified 2026-10-04: the current
[screepers launcher release](https://github.com/screepers/screeps-launcher/releases/tag/v1.17.0)
is **v1.17.0**. Bootstrap downloads that exact Windows asset and checks its
published SHA-256 (also checked on subsequent starts).
The template pins launcher-managed Node **v24.14.0**, Screeps **4.3.0**,
`screepsmod-auth` **2.9.0**, and `screepsmod-admin-utils` **1.36.4**.
The committed server `yarn.lock` fixes transitive package resolution on a fresh
bootstrap; existing runtime locks are preserved. Do not use launcher
`upgrade` for repeatable experiments. The launcher's own Yarn setup selects
1.22.21. Its dependencies and package cache stay under the lab directory.
Launcher children receive a project-scoped Windows user profile and node-gyp
cache so Yarn configuration and native build downloads stay in the lab too.

## First-time bootstrap and a playable baseline

Run from the repository root:

```powershell
npm ci
npm run local:bootstrap
npm run local:seed
npm run local:stop
npm run local:baseline
npm run local:start
npm run deploy:local
npm run local:resume
npm run local:status
```

Bootstrap detects the architecture, verifies/downloads the launcher, prepares
the isolated runtime, applies the package/mod configuration, starts the hidden
server, and waits for the API, both mods, and admin CLI. It applies and verifies
the **200 ms minimum tick duration**.
The first bootstrap performs a controlled restart after storage upgrades finish:
the upstream launcher's fixed three-second head start can otherwise leave
engine modules waiting on their first storage connection. It finishes paused.

Without a real `SCREEPS_LOCAL_STEAM_KEY`, the pinned auth mod's supported
`/api/register/submit` endpoint creates `local-bot` without Steam. Bootstrap
gives it a random one-time registration password, discards that password, and
obtains a persistent token using `auth.createAuthToken`. Only the token is
saved in ignored `.env.local`.

If a real `SCREEPS_LOCAL_STEAM_KEY` is already present and there is no selected
local API token, bootstrap deliberately **does not** create `local-bot`. It
leaves the server paused so a Steam/OpenID account can be created first, then
selected with `npm run local:auth -- <username>`. This prevents the common
"the bot is another player" split when the lab is meant to be watched through
Steamless.

Bootstrap is resumable: it preserves existing config, world, account, and valid
credentials. After replacing/deleting a world, an old token may no longer work;
run `npm run local:auth -- <username>` to generate a matching token.

`local:seed` pauses simulation and places Spawn1 in the bundled neutral room
**W8N3**, using the repo's existing initial-spawn planner. Pass another room
with `npm run local:seed -- W8N2`. It requires an empty account and a neutral
controller; it never respawns or replaces an existing colony. Room objects are
read through the server CLI because the private backend lacks the MMO
room-objects endpoint. Placement uses the supported game API; no database
mutation is used for seeding. The bundled world is the initial map.

`local:baseline` captures that exact world after seeding and before running
the bot. This is the reproducibility boundary: restore the snapshot instead
of regenerating rooms. Supported `map.generateRoom(name, options)` is available
in `local:cli`, but generation has random placement even with fixed terrain
options. Save a new snapshot to repeat a custom map exactly.

## Start, stop, inspect, and tick duration

```powershell
npm run local:start
npm run local:status
npm run local:pause
npm run local:resume
npm run local:tickrate -- 100
npm run local:tickrate -- 200
npm run local:cli
npm run local:cli -- "system.getTickDuration()"
npm run local:stop
```

The launcher and all its modules run in the background without visible command
windows. On first start (and when its source changes), Windows PowerShell's
built-in .NET Framework compiler builds our small Windows GUI host into
`.local/screeps/windows-server-host.exe`. No SDK installation or launcher fork
is needed. The host gives the launcher's `.cmd` modules a hidden console to
inherit and owns every descendant in a Windows Job Object. An exclusive file
lock prevents concurrent hosts from starting two servers.

Logs remain under `.local/screeps/`: `launcher.stdout.log`,
`launcher.stderr.log`, and `runtime/logs/` retain their existing streams.
Host startup failures go to `windows-host.log`. Game/API port **21025**, admin
CLI **21026**, and built-in storage **21027** all bind to **127.0.0.1**. Commands refuse to adopt another
process occupying these ports. Stop checks executable path and process creation
time against the saved PID before terminating only the owned Windows process
tree. New ownership records also verify the host's executable, creation time,
and its parent relationship to the launcher. Servers started before the host
was introduced can still be stopped normally before restarting.

Stop pauses the simulation, waits 12 seconds for the current tick and the
built-in storage's 10-second autosave, verifies the paused tick was persisted,
then terminates the host and tree. Closing the host's non-inherited job handle
also kills detached descendants, including on an unexpected host exit. If the
launcher exits, the host closes the job and exits as well. Abrupt exits cannot
guarantee autosave; use normal `local:stop` for persistence.
If persistence verification fails it leaves the server
running and asks you to retry. Startup retains the saved pause state: use
`local:resume` to run again. A baseline or reset always leaves a paused world.
For a failed startup with an unavailable admin CLI, inspect the logs, then use
`npm run local:stop -- --force`. This still checks process ownership, but skips
persistence and can lose unsaved state. It is not the normal snapshot path.

Tick duration changes persist in the ignored runtime `config.yml` and use
supported `system.setTickDuration/getTickDuration`. The tool allows 100 through
60000 ms; **200 ms is the default**. 100 ms is an experiment, not a throughput
guarantee: actual ticks can take longer because of CPU load and simulation size.
At a sustained 200 ms, 10,000 ticks take about 33 minutes.

The admin CLI supports arbitrary server JavaScript and is unauthenticated.
Keep it loopback-bound. `system.resetAllData()` destroys users and tokens as well
as world data; use the snapshot reset below for normal experiments.

## Reset and repeat

```powershell
npm run local:reset -- --confirm
npm run deploy:local
npm run local:resume
```

Reset requires a baseline. It stops/persists the managed server, saves a
`before-reset-<timestamp>.gz` recovery backup, restores the baseline using
launcher `restore`, then restarts **paused**. Baseline restore covers users,
tokens, code, Memory, world objects, game time, and server config, including its
tick duration. Redeploy and resume for the next run.

Baseline capture refuses to overwrite an existing baseline. To establish a
different one, stop the server, move `backups/baseline.gz` aside, then run
`local:baseline`. Keep the matching `.env.local` token. If you generated a
new token after capture, restoring may remove it; `local:auth -- <username>`
regenerates a token through the supported auth CLI.

Launcher backup/restore also includes local server mods and assets. Treat
backups as private credentials-bearing files. Restore only your own trusted
backups: the upstream format contains file paths and is not an untrusted archive
import boundary.

## Player-owned lab and Steamless

The API-only `local-bot` account is sufficient for unattended deployment, but
a Steamless browser session authenticates through Steam/OpenID. Those are
different users unless the lab is intentionally initialized around the
Steam-linked player. For a visual simulation lab, the recommended end state is:

```text
Steamless player = local deployment account = room owner
```

Obtain your own
[Steam Web API key](https://steamcommunity.com/dev/apikey) and add it to the
ignored **`.env.local`**:

```text
SCREEPS_LOCAL_STEAM_KEY=your-key-here
```

On a brand-new lab, set the key before `local:bootstrap`. Bootstrap will start
the server but skip creation of `local-bot`. In Steamless, open the local
server, choose **Sign Out** if the client shows Guest, then click the Steam icon
and complete Steam sign-in. After the server creates that user:

```powershell
npm run local:auth -- YourLocalUsername
npm run local:seed
npm run local:stop
npm run local:baseline
npm run local:start
npm run deploy:local
npm run local:resume
```

If the lab was already seeded under `local-bot`, use the explicit conversion
command instead of trying to make two owners coexist:

```powershell
npm run local:player-setup -- --confirm
```

Player setup normally stops and persists the current server, saves a timestamped
launcher recovery backup, archives the old `baseline.gz`, removes only the
disposable private-server runtime, clears only the local username/API token,
and bootstraps a fresh paused runtime with the existing Steam key. It preserves
the verified launcher, caches, archived backups, code-branch setting, and Steam
key. It never reads or changes `.env`, MMO credentials, AWS state, or production
Screeps.

After `local:player-setup` finishes, complete the Steamless sign-in checkpoint,
then run `local:auth`, `local:seed`, `local:stop`, and `local:baseline` as
shown above. The manual Steam sign-in is intentionally not automated or stored.
Future resets restore the player-owned baseline, so the room, bot code, Memory,
and browser identity all refer to the same local player.

For the Steam desktop client, the same account model applies: choose **Private
Server**, host **127.0.0.1**, port **21025**, server password **blank**, sign in,
then select that username with `local:auth`.

The launcher insists on a nonempty Steam key even for API-only operation, so
the default template uses an explicit **offline placeholder, not a secret**.
The backend retries Steam validation and logs HTTP 403 messages without a real
key; these do not block the local API or runner. Steam/OpenID login requires a
real key. This upstream behavior can grow backend logs during long runs; stop
and remove old logs between experiments.

## Data location and removal

- `dev/local-screeps/`: committed template, dependency lock, and these docs.
- `.local/screeps/screeps-launcher.exe`: verified native launcher.
- `.local/screeps/runtime/`: launcher Node/Yarn, server packages, assets,
  `db.json`, private config, component logs, and mods.
- `.local/screeps/cache/`: project-scoped package cache.
- `.local/screeps/profile/` and `node-gyp/`: child profile/config and native
  build cache.
- `.local/screeps/backups/`: private snapshots.
- `.local/screeps/process.json` and launcher logs: process management.
- `.env.local`: local API token, branch, URL, username, optional Steam key.
  `local:player-setup` preserves the Steam key and non-identity settings while
  clearing the old local username/token.

All `.local/` and `.env.local` content is ignored. To reclaim **all** local
server data from this checkout:

```powershell
npm run local:stop
Remove-Item -LiteralPath .local/screeps -Recurse -Force
Remove-Item -LiteralPath .env.local -Force
```

Run deletion only after stop succeeds. This removes backups and credentials too.
It does not remove `.env` or change MMO/AWS settings. Bootstrap recreates the lab.

## Runtime compatibility and telemetry

No separate local bot or runtime flags are introduced. The runtime uses standard
room/creep/CPU/Memory APIs and has no shard-name, MMO-host, or AWS network
dependency. Local `Memory.ops` stays in local storage: the AWS collector still
reads the official MMO only. Local scripts never invoke AWS helpers or the
production world-analysis/reboot commands; those commands remain MMO-only.

The private engine version, CPU limits/bucket behavior, shard identity, map,
player competition, wall-clock speed, and unavailable services/history can
differ from MMO. Tick-based recovery and forecasting still run unchanged.
Local success is useful simulation evidence, not proof of MMO performance.

Interfaces investigated:
[launcher](https://github.com/screepers/screeps-launcher/tree/v1.17.0),
[auth](https://github.com/ScreepsMods/screepsmod-auth),
[admin-utils](https://github.com/ScreepsMods/screepsmod-admin-utils),
[server CLI](https://github.com/screeps/screeps#command-line-interface-cli).
