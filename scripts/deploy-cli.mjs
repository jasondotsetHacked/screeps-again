import { readFile } from 'node:fs/promises';
import { ScreepsHttpClient } from 'screeps-api';
import { deploymentConfig, deploymentEnv } from './deploy-config.mjs';
import { deployRuntime } from './deploy-runtime.mjs';
import { localDeployClient } from './local-api.mjs';

export async function runDeployment(target) {
  try {
    if (process.argv.length > 2) throw new Error('Deployment accepts no target overrides. Use npm run deploy or npm run deploy:local.');
    const config = deploymentConfig(target, await deploymentEnv(target));
    const api = target === 'local' ? localDeployClient(config) : new ScreepsHttpClient({ url: config.url, token: config.token });
    await deployRuntime(api, config, await readFile('dist/main.js', 'utf8'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
