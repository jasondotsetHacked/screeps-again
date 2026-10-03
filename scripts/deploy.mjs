import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { ScreepsHttpClient } from 'screeps-api';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const token = process.env.SCREEPS_API_TOKEN;
if (!token) {
  throw new Error('SCREEPS_API_TOKEN is required. Put it in a local .env file; never commit it.');
}

const branch = process.env.SCREEPS_CODE_BRANCH || 'default';
const code = await readFile('dist/main.js', 'utf8');
const api = new ScreepsHttpClient({ url: 'https://screeps.com', token });

async function retry429(operation, label, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : error?.response?.status;

      if (status !== 429 || attempt === maxAttempts) throw error;

      const waitMs = Math.min(8000, 1000 * 2 ** (attempt - 1));
      console.log(
        `Screeps API rate-limited ${label}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxAttempts})...`
      );
      await delay(waitMs);
    }
  }
}

await retry429(() => api.userCodeSet({
  branch,
  modules: {
    main: code
  }
}), 'code upload');

console.log(`Uploaded dist/main.js to Screeps code branch "${branch}".`);

await retry429(
  () => api.userSetActiveBranch(branch, 'activeWorld'),
  'activate World branch'
);

const branches = await retry429(
  () => api.userBranches(),
  'verify active World branch'
);
const deployedBranch = branches.list.find((entry) => entry.branch === branch);

if (!deployedBranch?.activeWorld) {
  throw new Error(
    `Code uploaded, but Screeps did not report branch "${branch}" as the active World branch.`
  );
}

console.log(`Activated Screeps World code branch "${branch}".`);
