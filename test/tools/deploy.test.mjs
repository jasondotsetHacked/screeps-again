import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { deploymentConfig, deploymentEnv, localServerUrl } from '../../scripts/deploy-config.mjs';
import { deployRuntime } from '../../scripts/deploy-runtime.mjs';
import { localRequest, localDeployClient } from '../../scripts/local-api.mjs';

test('production URL and branch ignore every local setting', () => {
  const config = deploymentConfig('world', {
    SCREEPS_API_TOKEN: 'mmo-test-token', SCREEPS_CODE_BRANCH: 'production',
    SCREEPS_URL: 'http://localhost:21025', SCREEPS_LOCAL_URL: 'http://localhost:21025',
    SCREEPS_LOCAL_API_TOKEN: 'local-test-token', SCREEPS_LOCAL_CODE_BRANCH: 'local-dev'
  });
  assert.equal(config.url, 'https://screeps.com');
  assert.equal(config.branch, 'production');
  assert.equal(config.token, 'mmo-test-token');
  assert.equal(deploymentConfig('world', { SCREEPS_API_TOKEN: 'test' }).branch, 'default');
  assert.equal(deploymentConfig('world', { SCREEPS_API_TOKEN: 'test', SCREEPS_CODE_BRANCH: 'existing.branch' }).branch, 'existing.branch');
});

test('environment files are isolated, shell values win, and malformed local target stays fenced', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), 'screeps-deploy-test-'));
  try {
    await writeFile(join(dir, '.env'), 'SCREEPS_API_TOKEN=mmo-fixture\nSCREEPS_CODE_BRANCH=production\n');
    await writeFile(join(dir, '.env.local'), 'SCREEPS_LOCAL_API_TOKEN=local-fixture\nSCREEPS_LOCAL_URL=https://screeps.com\n');
    process.chdir(dir);
    const world = await deploymentEnv('world', { SCREEPS_CODE_BRANCH: 'shell-branch' });
    const local = await deploymentEnv('local', {});
    assert.equal(world.SCREEPS_LOCAL_API_TOKEN, undefined);
    assert.equal(world.SCREEPS_CODE_BRANCH, 'shell-branch');
    assert.equal(local.SCREEPS_API_TOKEN, undefined);
    assert.throws(() => deploymentConfig('local', local), /loopback/);
  } finally {
    process.chdir(cwd);
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('MMO entry point refuses a command-line target override before authentication or network', async () => {
  const file = fileURLToPath(new URL('../../scripts/deploy.mjs', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [file, '--local'], {
    cwd: tmpdir(), env: { PATH: process.env.PATH }, windowsHide: true
  }), error => error.code === 1 && /accepts no target overrides/.test(error.stderr));
});

test('local credentials and branch are separate, with no password/MMO fallback', () => {
  assert.throws(() => deploymentConfig('local', { SCREEPS_API_TOKEN: 'mmo', SCREEPS_LOCAL_PASSWORD: 'password' }), /SCREEPS_LOCAL_API_TOKEN.*local:bootstrap/);
  assert.throws(() => deploymentConfig('world', { SCREEPS_LOCAL_API_TOKEN: 'local' }), /SCREEPS_API_TOKEN is required/);
  assert.throws(() => deploymentConfig('local', { SCREEPS_LOCAL_API_TOKEN: '  ' }), /required/);
  const config = deploymentConfig('local', { SCREEPS_LOCAL_API_TOKEN: 'local', SCREEPS_CODE_BRANCH: 'production' });
  assert.equal(config.branch, 'local');
  assert.equal(config.url, 'http://127.0.0.1:21025');
  assert.equal(deploymentConfig('local', { SCREEPS_LOCAL_API_TOKEN: 'local', SCREEPS_LOCAL_CODE_BRANCH: 'experiment-1' }).branch, 'experiment-1');
});

test('local fence refuses MMO, arbitrary remote hosts, malformed and credential URLs', () => {
  for (const url of ['https://screeps.com', 'https://screeps.com/api', 'https://example.org',
    'http://192.168.1.5:21025', 'http://0.0.0.0:21025', 'http://localhost.example.com',
    'http://localhost@screeps.com', 'http://screeps.com@localhost', 'http://localhost:21025/api',
    'http://localhost:21025/?redirect=screeps.com', 'http://localhost/#x', 'ftp://localhost', 'invalid']) {
    assert.throws(() => deploymentConfig('local', { SCREEPS_LOCAL_URL: url, SCREEPS_LOCAL_API_TOKEN: 'test' }), /local Screeps URL|Local Screeps URL/);
  }
  assert.equal(localServerUrl('http://localhost:21025'), 'http://127.0.0.1:21025');
  assert.equal(localServerUrl('http://[::1]:21025'), 'http://[::1]:21025');
  assert.throws(() => deploymentConfig('unknown', {}), /target/);
  assert.throws(() => deploymentConfig('local', { SCREEPS_LOCAL_API_TOKEN: 'test', SCREEPS_LOCAL_CODE_BRANCH: '../production' }), /branch/);
});

test('local API refuses redirects before forwarding credentials', async () => {
  let remoteRequests = 0;
  const remote = createServer((_req, res) => { remoteRequests++; res.end('unexpected'); });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  const server = createServer((_req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${remote.address().port}/api/auth/me` }); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await assert.rejects(localRequest(`http://127.0.0.1:${server.address().port}`, '/api/auth/me', { token: 'test' }));
    assert.equal(remoteRequests, 0);
  } finally { server.close(); remote.close(); }
});

function fakeApi(code, active = true) {
  const calls = [];
  return {
    calls,
    userCodeSet: async data => calls.push(['upload', data]),
    userCodeGet: async branch => { calls.push(['read', branch]); return { modules: { main: code } }; },
    userSetActiveBranch: async (branch, name) => calls.push(['activate', branch, name]),
    userBranches: async () => ({ list: [{ branch: 'experiment', activeWorld: active }] })
  };
}

test('same runtime is uploaded and selected branch is verified for both targets', async () => {
  for (const target of ['world', 'local']) {
    const api = fakeApi('same bundle');
    await deployRuntime(api, { branch: 'experiment', target }, 'same bundle');
    assert.deepEqual(api.calls[0], ['upload', { branch: 'experiment', modules: { main: 'same bundle' } }]);
    assert.deepEqual(api.calls.at(-1), ['activate', 'experiment', 'activeWorld']);
    assert.equal(api.calls.some(call => call[0] === 'read'), target === 'local');
  }
});

test('local upload mismatch prevents activation, and inactive branch fails verification', async () => {
  const mismatch = fakeApi('wrong bundle');
  await assert.rejects(deployRuntime(mismatch, { branch: 'experiment', target: 'local' }, 'same bundle'), /upload verification failed/);
  assert.equal(mismatch.calls.some(call => call[0] === 'activate'), false);
  await assert.rejects(deployRuntime(fakeApi('same bundle', false), { branch: 'experiment', target: 'local' }, 'same bundle'), /active World branch/);
});

test('private API creates a missing branch before upload and reuses an existing branch', async () => {
  for (const exists of [false, true]) {
    const calls = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls.push({ path: req.url, body: raw ? JSON.parse(raw) : null });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url === '/api/user/branches'
        ? { ok: 1, list: exists ? [{ branch: 'experiment' }] : [{ branch: 'default' }] }
        : { ok: 1 }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const api = localDeployClient({ url: `http://127.0.0.1:${server.address().port}`, token: 'local-fixture' });
      await api.userCodeSet({ branch: 'experiment', modules: { main: 'same bundle' } });
      assert.equal(calls[0].path, '/api/user/branches');
      assert.deepEqual(calls.at(-1), { path: '/api/user/code', body: { branch: 'experiment', modules: { main: 'same bundle' } } });
      const clone = calls.find(call => call.path === '/api/user/clone-branch');
      assert.equal(Boolean(clone), !exists);
      if (clone) assert.deepEqual(clone.body, { branch: 'default', newName: 'experiment' });
    } finally { server.close(); }
  }
});
