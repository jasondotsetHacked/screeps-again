import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('Windows host hides .cmd modules, appends logs, and kills detached descendants on unexpected host exit',
  { skip: process.platform !== 'win32', timeout: 45_000 }, async () => {
    // Include spaces to exercise native command-line quoting.
    const directory = await mkdtemp(join(tmpdir(), 'screeps host test '));
    const fixture = resolve('test/tools/fixtures/windows-host-child.mjs');
    await writeFile(join(directory, 'module.cmd'), `@echo off\r\n"${process.execPath}" "${fixture}" "${directory}" module\r\n`);
    await writeFile(join(directory, 'stdout.log'), 'existing stdout\n');
    await writeFile(join(directory, 'stderr.log'), 'existing stderr\n');
    const host = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve('test/tools/fixtures/windows-host-probe.ps1'), '-Source', resolve('tools/local-screeps/WindowsServerHost.cs'),
      '-Node', process.execPath, '-Fixture', fixture, '-Directory', directory], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    host.stdout.on('data', data => { diagnostics += data; });
    host.stderr.on('data', data => { diagnostics += data; });
    const exited = new Promise(res => host.once('exit', res));
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let pids = [];
    try {
      let ready;
      for (let i = 0; i < 200; i++) {
        try { ready = JSON.parse((await readFile(join(directory, 'ready.json'), 'utf8')).replace(/^\uFEFF/, '')); break; } catch {}
        assert.equal(host.exitCode, null, diagnostics);
        await delay(50);
      }
      assert.ok(ready, `Host not ready: ${diagnostics}`);
      pids = await Promise.all(['parent', 'shim', 'module', 'detached'].map(async name => Number(await readFile(join(directory, `${name}.pid`), 'utf8'))));
      assert.equal(ready.launcher, pids[0]);
      assert.deepEqual(ready.visible, [], 'A descendant opened a visible console');
      assert.ok(pids.every(alive), 'Every module must remain running');
      assert.match(await readFile(join(directory, 'stdout.log'), 'utf8'), /^existing stdout\n[\s\S]*module stdout/);
      assert.match(await readFile(join(directory, 'stderr.log'), 'utf8'), /^existing stderr\n[\s\S]*module stderr/);
      host.kill(); // No taskkill tree walk or graceful finally; job alone must clean up.
      await exited;
      for (let i = 0; i < 100 && pids.some(alive); i++) await delay(50);
      assert.ok(pids.every(pid => !alive(pid)), 'Host death orphaned a module or detached descendant');
    } finally {
      host.kill();
      await exited;
      // The job owns fixtures even when assertions fail. Delete only this exact
      // directory returned by mkdtemp, after the owner has closed its job.
      await rm(directory, { recursive: true, force: true });
    }
  });

test('GUI host reports startup failure quietly while the parent has its log open',
  { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screeps host failure '));
    const executable = join(directory, 'host.exe');
    let log;
    try {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -Path $env:HOST_TEST_SOURCE -OutputAssembly $env:HOST_TEST_EXE -OutputType WindowsApplication'],
      { windowsHide: true, env: { ...process.env, HOST_TEST_SOURCE: resolve('tools/local-screeps/WindowsServerHost.cs'), HOST_TEST_EXE: executable } });
      log = await open(join(directory, 'windows-host.log'), 'a');
      const host = spawn(executable, [join(directory, 'missing-launcher.exe'), directory, join(directory, 'process.json'), directory],
        { windowsHide: true, detached: true, stdio: ['ignore', log.fd, log.fd] });
      const code = await new Promise((res, rej) => { host.once('exit', res); host.once('error', rej); });
      assert.equal(code, 1);
      assert.match(await readFile(join(directory, 'windows-host.log'), 'utf8'), /Win32Exception/);
      await assert.rejects(readFile(join(directory, 'process.json')), { code: 'ENOENT' });
    } finally {
      await log?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
