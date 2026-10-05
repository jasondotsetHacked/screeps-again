import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, copyFile, open, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { parseEnv, promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline/promises';
import YAML from 'yaml';
import { deploymentEnv, LOCAL_URL } from '../../scripts/deploy-config.mjs';
import { localRequest } from '../../scripts/local-api.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lab = resolve(root, '.local/screeps');
const runtime = resolve(lab, 'runtime');
const launcher = resolve(lab, 'screeps-launcher.exe');
const pidFile = resolve(lab, 'process.json');
const hostSource = resolve(root, 'tools/local-screeps/WindowsServerHost.cs');
const hostExecutable = resolve(lab, 'windows-server-host.exe');
const powershell = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const baseline = resolve(lab, 'backups/baseline.gz');
const version = 'v1.17.0';
const offlineSteamKey = 'offline-local-lab-no-steam-login';
const hashes = {
  x64: 'de72dbad1d501f1e258f0c673fdb65d5d4f94258e737f3c3e7e5ffde5c07a9b1',
  arm64: 'f37ca663ab3d047da5c43ece93274fddf5c01d0f584295d8a7ac13eefc47dd0c'
};
process.chdir(root);

async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function config() { return YAML.parse(await readFile(resolve(runtime, 'config.yml'), 'utf8')); }
async function saveConfig(value) { await writeFile(resolve(runtime, 'config.yml'), YAML.stringify(value)); }

async function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid managed process ID.');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ExecutablePath,CreationDate,ParentProcessId | ConvertTo-Json -Compress`],
  { windowsHide: true });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

async function managedProcess() {
  if (!existsSync(pidFile)) return null;
  const saved = await json(pidFile);
  const actual = await processInfo(saved.pid);
  if (!actual) { await rm(pidFile); return null; }
  if (actual.ExecutablePath?.toLowerCase() !== launcher.toLowerCase() || actual.CreationDate !== saved.created) {
    throw new Error('Managed PID belongs to a different process; refusing to control it. Inspect .local/screeps/process.json.');
  }
  if (saved.host) {
    const host = await processInfo(saved.host.pid);
    if (!host || host.ExecutablePath?.toLowerCase() !== hostExecutable.toLowerCase() ||
        host.CreationDate !== saved.host.created || actual.ParentProcessId !== saved.host.pid) {
      throw new Error('Managed Windows host ownership mismatch; refusing to control it. Inspect .local/screeps/process.json.');
    }
  }
  return saved;
}

export async function cli(command) {
  const response = await fetch('http://127.0.0.1:21026/cli', {
    method: 'POST', body: command, redirect: 'error', signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Local admin CLI returned HTTP ${response.status}.`);
  const text = (await response.text()).trim();
  if (text.startsWith('Error:')) throw new Error('Local admin command failed. Check server logs.');
  return text;
}

export async function cliValue(expression) {
  return JSON.parse(await cli(`Promise.resolve(${expression}).then(value => JSON.stringify(value))`));
}

async function runLauncher(args) {
  await verifyLauncher();
  await mkdir(resolve(lab, 'profile'), { recursive: true });
  await new Promise((res, rej) => {
    const child = spawn(launcher, args, { cwd: runtime, windowsHide: true, stdio: 'inherit', env: serverEnv() });
    child.on('error', rej);
    child.on('exit', code => code === 0 ? res() : rej(new Error(`Launcher ${args[0]} failed (${code}). Check native build prerequisites and local logs.`)));
  });
}

function serverEnv() {
  // Never give server children MMO/AWS credentials inherited by the shell.
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(AWS_|SCREEPS_|STEAM_KEY$|SERVER_PASSWORD$|GITHUB_|GITLAB_)/i.test(key))),
    USERPROFILE: resolve(lab, 'profile'),
    YARN_CACHE_FOLDER: resolve(lab, 'cache'),
    npm_config_devdir: resolve(lab, 'node-gyp')
  };
}

async function verifyLauncher() {
  const bytes = await readFile(launcher);
  if (createHash('sha256').update(bytes).digest('hex') !== hashes[process.arch]) {
    throw new Error('Launcher SHA-256 mismatch. Delete .local/screeps/screeps-launcher.exe and rerun bootstrap.');
  }
}

async function downloadLauncher() {
  if (existsSync(launcher)) return verifyLauncher();
  const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
  const url = `https://github.com/screepers/screeps-launcher/releases/download/${version}/screeps-launcher_windows_${arch}.exe`;
  console.log(`Downloading pinned launcher ${version} for Windows ${process.arch}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Launcher download failed (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== hashes[process.arch]) throw new Error('Downloaded launcher SHA-256 mismatch.');
  await writeFile(launcher + '.part', bytes);
  await rename(launcher + '.part', launcher);
}

async function health() {
  const data = await localRequest(LOCAL_URL, '/api/version');
  const features = data.serverData?.features ?? [];
  for (const name of ['screepsmod-auth', 'screepsmod-admin-utils']) {
    if (!features.some(feature => feature.name === name)) throw new Error(`Local API is missing ${name}.`);
  }
  return data;
}

async function compileHost() {
  // Windows PowerShell's built-in .NET Framework compiler; no installed SDK,
  // downloaded wrapper, upstream fork, or persistent execution-policy change.
  const sourceHash = createHash('sha256').update(await readFile(hostSource)).digest('hex');
  const receipt = hostExecutable + '.sha256';
  if (existsSync(hostExecutable) && existsSync(receipt)) {
    const [source, binary] = (await readFile(receipt, 'utf8')).trim().split(' ');
    if (source === sourceHash && binary === createHash('sha256').update(await readFile(hostExecutable)).digest('hex')) return;
  }
  await rm(hostExecutable, { force: true });
  await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -Path $env:SCREEPS_HOST_SOURCE -OutputAssembly $env:SCREEPS_HOST_OUTPUT -OutputType WindowsApplication'],
  { windowsHide: true, env: { ...process.env, SCREEPS_HOST_SOURCE: hostSource, SCREEPS_HOST_OUTPUT: hostExecutable } });
  const binaryHash = createHash('sha256').update(await readFile(hostExecutable)).digest('hex');
  await writeFile(receipt, `${sourceHash} ${binaryHash}\n`);
}

async function start() {
  await verifyLauncher();
  await mkdir(resolve(lab, 'profile'), { recursive: true });
  if (await managedProcess()) { await health(); console.log('Local server is already running.'); return; }
  // Refuse to adopt or mutate a different server on these fixed lab ports.
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 21025,21026,21027 } | Select-Object -ExpandProperty LocalPort'],
  { windowsHide: true });
  if (stdout.trim()) throw new Error('Lab ports 21025/21026/21027 are occupied by an unmanaged process; stop it first.');
  await compileHost();
  const hostLog = await open(resolve(lab, 'windows-host.log'), 'a');
  const child = spawn(hostExecutable, [launcher, runtime, pidFile, lab],
    { cwd: runtime, windowsHide: true, detached: true, stdio: ['ignore', hostLog.fd, hostLog.fd], env: serverEnv() });
  try {
    await new Promise((res, rej) => { child.once('spawn', res); child.once('error', rej); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Windows host exited during startup. See .local/screeps/windows-host.log.');
      if (existsSync(pidFile)) {
        const owned = await managedProcess();
        if (owned?.host?.pid !== child.pid) throw new Error('Another start owns the lab; refusing to adopt it.');
        break;
      }
      if (attempt === 99) throw new Error('Windows host startup timed out. See .local/screeps/windows-host.log.');
      await delay(100);
    }
  } catch (error) {
    // The child handle targets this exact host; closing its job kills even a
    // suspended launcher if initialization/ownership publication failed.
    child.kill();
    throw error;
  } finally {
    child.unref();
    await hostLog.close();
  }
  console.log('Waiting for local API and admin CLI...');
  for (let attempt = 0; attempt < 90; attempt++) {
    if (!await managedProcess()) throw new Error('Launcher exited. See .local/screeps/launcher.stderr.log.');
    try {
      await health();
      await cli('utils.reloadConfig()');
      const wanted = (await config()).serverConfig.tickRate;
      await cli(`system.setTickDuration(${wanted})`);
      if (Number(await cliValue('system.getTickDuration()')) !== wanted) throw new Error('Tick duration has not applied.');
      console.log(`Local API ready at ${LOCAL_URL}; minimum tick duration ${wanted} ms. Simulation retains its saved pause state.`);
      return;
    } catch { await delay(1000); }
  }
  throw new Error('Local server health timed out. See .local/screeps/runtime/logs and launcher.stderr.log; use local:stop before retrying.');
}

async function stop(force = false) {
  const owned = await managedProcess();
  if (!owned) { console.log('Managed local server is stopped.'); return; }
  if (!force) {
    try { await cli('system.pauseSimulation()'); }
    catch { throw new Error('Local CLI is unavailable. Inspect logs; use local:stop -- --force to stop a failed server (unsaved state may be lost).'); }
    // Built-in storage autosaves every 10 seconds. Let the current tick finish,
    // then cross one whole autosave interval before terminating the Windows tree.
    console.log('Pausing and waiting for built-in storage to autosave...');
    await delay(12_000);
    const tick = await cliValue('storage.env.get("gameTime")');
    const db = await json(resolve(runtime, 'db.json'));
    const savedEnv = db.collections.find(collection => collection.name === 'env')?.data[0];
    if (String(savedEnv?.data?.gameTime) !== String(tick) || Number(savedEnv?.data?.mainLoopPaused) !== 1) throw new Error('Storage has not saved the paused tick; refusing to stop. Retry local:stop.');
  }
  const current = await managedProcess();
  if (!current || current.pid !== owned.pid || current.created !== owned.created ||
      current.host?.pid !== owned.host?.pid || current.host?.created !== owned.host?.created) {
    throw new Error('Managed server changed before stop; refusing to terminate it.');
  }
  // Legacy PID files remain stoppable. New hosts own a kill-on-close job, so
  // kernel cleanup also catches descendants that escape taskkill's tree walk.
  await exec('taskkill.exe', ['/PID', String(owned.host?.pid ?? owned.pid), '/T', '/F'], { windowsHide: true });
  for (let attempt = 0; ; attempt++) {
    if (!await processInfo(owned.pid) && (!owned.host || !await processInfo(owned.host.pid))) break;
    if (attempt === 9) throw new Error('Managed processes have not exited; retaining ownership file for inspection.');
    await delay(100);
  }
  await rm(pidFile, { force: true });
  console.log(force ? 'Force-stopped managed local server; unsaved state may be lost.' : 'Stopped local server. Next start remains paused; use local:resume.');
}

async function localEnvFile() {
  const file = resolve(root, '.env.local');
  return { file, values: existsSync(file) ? parseEnv(await readFile(file, 'utf8')) : {} };
}

async function saveLocalEnv(file, values) {
  const text = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  await writeFile(file, text, { mode: 0o600 });
}

export function interactiveSteamConfigured(env) {
  const value = env.SCREEPS_LOCAL_STEAM_KEY?.trim();
  return Boolean(value && value !== offlineSteamKey);
}

async function writeCredentials(token, username) {
  const { file, values: env } = await localEnvFile();
  const values = { ...env, SCREEPS_LOCAL_URL: LOCAL_URL, SCREEPS_LOCAL_CODE_BRANCH: env.SCREEPS_LOCAL_CODE_BRANCH || 'local', SCREEPS_LOCAL_USERNAME: username, SCREEPS_LOCAL_API_TOKEN: token };
  await saveLocalEnv(file, values);
  console.log(`Saved persistent local API token for "${username}" to ignored .env.local (token not printed).`);
}

async function clearLocalIdentity() {
  const { file, values } = await localEnvFile();
  delete values.SCREEPS_LOCAL_USERNAME;
  delete values.SCREEPS_LOCAL_API_TOKEN;
  await saveLocalEnv(file, values);
}

async function auth(username = 'local-bot') {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(username)) throw new Error('Use a username of 1-40 letters, numbers, underscores, or hyphens.');
  const token = await cliValue(`auth.createAuthToken(${JSON.stringify(username)}, "screeps-again local deploy")`);
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error(`Local user "${username}" does not exist. Run local:bootstrap or create it in the client first.`);
  await localRequest(LOCAL_URL, '/api/auth/me', { token });
  await writeCredentials(token, username);
}

async function account() {
  const env = await deploymentEnv('local');
  if (env.SCREEPS_LOCAL_API_TOKEN) {
    try { await localRequest(LOCAL_URL, '/api/auth/me', { token: env.SCREEPS_LOCAL_API_TOKEN }); }
    catch { throw new Error('Existing local API token was refused. Run npm run local:auth -- <username> to regenerate it for this world; clear any stale SCREEPS_LOCAL_API_TOKEN shell override.'); }
    return 'selected';
  }
  // A real Steam Web API key means the operator intends to use Steam/OpenID
  // (including the Steamless browser client). Do not silently create a second
  // API-only owner before the human account has had a chance to sign in.
  if (interactiveSteamConfigured(env)) {
    console.log('Steam/OpenID account mode is configured. No API-only local-bot was created.');
    console.log('Sign in to the local server with Steam, then run npm run local:auth -- <YourLocalUsername>.');
    return 'interactive-pending';
  }

  const username = 'local-bot';
  const result = await fetch(LOCAL_URL + '/api/register/check-username?username=' + username, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!result.ok) throw new Error('Could not check local account.');
  const check = await result.json();
  if (check.ok === 1) {
    await localRequest(LOCAL_URL, '/api/register/submit', {
      // Used only to satisfy registration; never persisted or used for deploy.
      body: { username, email: 'local-bot@localhost', password: randomBytes(32).toString('hex') }
    });
    console.log('Created API-only local-bot through screepsmod-auth registration.');
  } else if (check.error !== 'User Exists') throw new Error('Local registration unavailable; see the client/account checkpoint in dev/local-screeps/README.md.');
  await auth(username);
  return 'api-only';
}

async function backup() {
  if (await managedProcess()) throw new Error('Stop the server with local:stop before taking a consistent baseline.');
  if (existsSync(baseline)) throw new Error('Baseline already exists. Move it aside explicitly before taking a new one.');
  const db = await json(resolve(runtime, 'db.json'));
  if (Number(db.collections.find(collection => collection.name === 'env')?.data[0]?.data?.mainLoopPaused) !== 1) {
    throw new Error('A baseline must be paused. Start, stop normally, then capture the baseline.');
  }
  await mkdir(dirname(baseline), { recursive: true });
  await runLauncher(['backup', baseline]);
  if (!existsSync(baseline)) throw new Error('Launcher did not create baseline.');
  console.log('Saved baseline world, users, code, memory, tick and config. Keep its .env.local token: credentials must match the restored world.');
}

async function reset(confirm) {
  if (confirm !== '--confirm') throw new Error('Reset replaces the local world. Use npm run local:reset -- --confirm after saving a baseline.');
  if (!existsSync(baseline)) throw new Error('No baseline exists. Run local:stop, then local:baseline first.');
  await stop();
  await runLauncher(['backup', resolve(lab, `backups/before-reset-${Date.now()}.gz`)]);
  await runLauncher(['restore', baseline]);
  await start();
  console.log('Restored baseline; simulation is paused. Deploy with deploy:local, then local:resume.');
}

async function playerSetup(confirm) {
  if (confirm !== '--confirm') {
    throw new Error('Player setup replaces the disposable local runtime. Add SCREEPS_LOCAL_STEAM_KEY to .env.local, then use npm run local:player-setup -- --confirm.');
  }
  const env = await deploymentEnv('local');
  if (!interactiveSteamConfigured(env)) {
    throw new Error('SCREEPS_LOCAL_STEAM_KEY must contain a real Steam Web API key before player setup. The offline placeholder cannot authenticate Steam/OpenID.');
  }

  await stop();
  await mkdir(resolve(lab, 'backups'), { recursive: true });
  const stamp = Date.now();
  if (existsSync(resolve(runtime, 'db.json')) && existsSync(resolve(runtime, 'config.yml'))) {
    const recovery = resolve(lab, `backups/before-player-setup-${stamp}.gz`);
    await runLauncher(['backup', recovery]);
    console.log(`Saved the current API-only lab as ${recovery}.`);
  }
  if (existsSync(baseline)) {
    const archived = resolve(lab, `backups/baseline-before-player-setup-${stamp}.gz`);
    await rename(baseline, archived);
    console.log(`Archived the old baseline as ${archived}.`);
  }

  // Rebuild only the disposable private-server runtime. Keep the verified
  // launcher, caches, Steam key, and archived recovery snapshots.
  await rm(runtime, { recursive: true, force: true });
  await rm(pidFile, { force: true });
  await clearLocalIdentity();
  await bootstrap();
  console.log('Player-owned lab is ready for the manual Steam/OpenID checkpoint.');
  console.log('In Steamless: open the local server, Sign Out if shown as Guest, then click the Steam icon.');
  console.log('After sign-in: npm run local:auth -- <YourLocalUsername>, npm run local:seed, npm run local:stop, npm run local:baseline.');
}

async function bootstrap() {
  console.log(`Local lab: ${process.platform}/${process.arch}, launcher ${version}.`);
  await mkdir(runtime, { recursive: true });
  const initialize = !existsSync(resolve(runtime, '.lab-initialized'));
  await downloadLauncher();
  if (!existsSync(resolve(runtime, 'config.yml'))) {
    await copyFile(resolve(root, 'dev/local-screeps/config.template.yml'), resolve(runtime, 'config.yml'));
  }
  // Yarn set-version searches upwards before the launcher creates package.json.
  if (!existsSync(resolve(runtime, 'package.json'))) {
    await writeFile(resolve(runtime, 'package.json'), '{"name":"screeps-private-server","private":true}\n');
  }
  const lock = resolve(root, 'dev/local-screeps/yarn.lock');
  if (!existsSync(resolve(runtime, 'yarn.lock')) && existsSync(lock)) await copyFile(lock, resolve(runtime, 'yarn.lock'));
  const env = await deploymentEnv('local');
  if (env.SCREEPS_LOCAL_STEAM_KEY) {
    const value = await config();
    value.env.backend.STEAM_KEY = env.SCREEPS_LOCAL_STEAM_KEY;
    await saveConfig(value);
  }
  if (!await managedProcess()) await runLauncher(['apply']);
  await start();
  if (initialize) {
    // On first boot, built-in storage upgrades can exceed the launcher's fixed
    // 3-second head start. Engine modules then keep waiting on a failed initial
    // storage connection. Restart after API-ready proves upgrades completed.
    console.log('Finishing first-world storage initialization with a controlled restart...');
    await stop();
    await start();
    await writeFile(resolve(runtime, '.lab-initialized'), 'Storage initialized; initial engine reconnect completed.\n');
  }
  const accountMode = await account();
  if (accountMode === 'interactive-pending') {
    console.log('Bootstrap ready and paused. Complete Steam/OpenID sign-in, then local:auth, local:seed, local:stop, and local:baseline. See dev/local-screeps/README.md.');
  } else {
    console.log('Bootstrap ready. Next: local:seed, local:stop, local:baseline, local:start, deploy:local, local:resume. See dev/local-screeps/README.md.');
  }
}

async function main() {
  if (process.platform !== 'win32' || !hashes[process.arch]) throw new Error('This first local lab supports native Windows x64/arm64 only.');
  const [command, arg, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Too many local command arguments.');
  switch (command) {
    case 'bootstrap': return bootstrap();
    case 'start': return start();
    case 'stop':
      if (arg && arg !== '--force') throw new Error('Usage: local:stop [--force]');
      return stop(arg === '--force');
    case 'status': {
      const owned = await managedProcess();
      if (!owned) { console.log('Managed local server is stopped.'); return; }
      await health();
      console.log(`Local launcher PID ${owned.pid}; ${LOCAL_URL}; tick duration ${await cliValue('system.getTickDuration()')} ms; tick ${await cliValue('storage.env.get("gameTime")')}; paused ${await cliValue('storage.env.get("mainLoopPaused")')}.`);
      return;
    }
    case 'auth': await requireManaged(); return auth(arg);
    case 'baseline': return backup();
    case 'reset': return reset(arg);
    case 'player-setup': return playerSetup(arg);
    case 'pause': await requireManaged(); console.log(await cli('system.pauseSimulation()')); return;
    case 'resume': await requireManaged(); console.log(await cli('system.resumeSimulation()')); return;
    case 'tickrate': {
      const value = Number(arg);
      if (!Number.isInteger(value) || value < 100 || value > 60_000) throw new Error('Tick duration must be an integer from 100 through 60000 ms (default 200).');
      const conf = await config(); conf.serverConfig.tickRate = value; await saveConfig(conf);
      if (await managedProcess()) {
        await cli(`system.setTickDuration(${value})`);
        if (Number(await cliValue('system.getTickDuration()')) !== value) throw new Error('Tick duration verification failed.');
      }
      console.log(`Persisted minimum tick duration: ${value} ms.`);
      return;
    }
    case 'cli': {
      await requireManaged();
      if (arg) { console.log(await cli(arg)); return; }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      console.log('Local admin CLI only. Type exit to quit. Use help() for commands.');
      try { while (true) { const line = await rl.question('local> '); if (line === 'exit') break; console.log(await cli(line)); } }
      finally { rl.close(); }
      return;
    }
    default: throw new Error('Use local:bootstrap/start/stop/status/auth/cli/tickrate/pause/resume/baseline/reset/player-setup.');
  }
}

export async function requireManaged() {
  if (!await managedProcess()) throw new Error('Managed local server is stopped. Run npm run local:start.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
