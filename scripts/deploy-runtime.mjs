import { setTimeout as delay } from 'node:timers/promises';

export async function retry429(operation, label, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      const status = error?.status ?? error?.response?.status;
      if (status !== 429 || attempt === maxAttempts) throw error;
      const waitMs = Math.min(8000, 1000 * 2 ** (attempt - 1));
      console.log(`Screeps API rate-limited ${label}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxAttempts})...`);
      await delay(waitMs);
    }
  }
}

export async function deployRuntime(api, { branch, target }, code) {
  await retry429(() => api.userCodeSet({ branch, modules: { main: code } }), 'code upload');
  if (target === 'local') {
    const uploaded = await retry429(() => api.userCodeGet(branch), 'verify uploaded code');
    if (uploaded.modules?.main !== code) throw new Error('Local upload verification failed: main differs from dist/main.js.');
  }
  console.log(`Uploaded dist/main.js to ${target} code branch "${branch}".`);
  await retry429(() => api.userSetActiveBranch(branch, 'activeWorld'), 'activate World branch');
  const branches = await retry429(() => api.userBranches(), 'verify active World branch');
  if (!branches.list.find(entry => entry.branch === branch)?.activeWorld) {
    throw new Error(`Code uploaded, but Screeps did not report branch "${branch}" as the active World branch.`);
  }
  console.log(`Verified active ${target} World code branch "${branch}".`);
}
