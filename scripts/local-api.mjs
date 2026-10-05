import { localServerUrl } from './deploy-config.mjs';

export async function localRequest(origin, path, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const url = localServerUrl(origin);
  if (!path.startsWith('/api/')) throw new Error('Local API path must start with /api/.');
  const response = await fetch(new URL(path, url), {
    method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: {
      ...(token ? { 'X-Token': token, 'X-Username': token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }).catch(() => { throw new Error('Local Screeps API request failed: check that the server is running; redirects are refused.'); });
  if (!response.ok) throw Object.assign(new Error(`Local Screeps API ${path.split('?')[0]} returned HTTP ${response.status}.`), { status: response.status });
  const data = await response.json();
  if (data.error || data.ok !== 1) throw new Error(`Local Screeps API ${path.split('?')[0]} refused the request. Check local auth/server logs.`);
  return data;
}

export function localDeployClient({ url, token }) {
  const call = (path, body) => localRequest(url, path, { token, body });
  return {
    userCodeSet: async body => {
      const branches = await call('/api/user/branches');
      // Unlike MMO upload, the private backend needs a branch created first.
      if (!branches.list.some(entry => entry.branch === body.branch)) {
        await call('/api/user/clone-branch', { branch: 'default', newName: body.branch });
      }
      return call('/api/user/code', body);
    },
    userCodeGet: branch => call(`/api/user/code?branch=${encodeURIComponent(branch)}`),
    userSetActiveBranch: (branch, activeName) => call('/api/user/set-active-branch', { branch, activeName }),
    userBranches: () => call('/api/user/branches')
  };
}
