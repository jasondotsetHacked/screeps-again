import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export const MMO_URL = 'https://screeps.com';
export const LOCAL_URL = 'http://127.0.0.1:21025';

export function localServerUrl(value = LOCAL_URL) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid local Screeps URL. Use http://127.0.0.1:21025.'); }
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Local Screeps URL must be a loopback HTTP(S) origin (localhost, 127.0.0.1, or [::1]); remote hosts and URL paths/credentials are refused.');
  }
  // Avoid depending on DNS for localhost, including a modified hosts file.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}

export function deploymentConfig(target, env) {
  if (!['world', 'local'].includes(target)) throw new Error('Deployment target must be world or local.');
  const local = target === 'local';
  const url = local ? localServerUrl(env.SCREEPS_LOCAL_URL) : MMO_URL;
  const tokenKey = local ? 'SCREEPS_LOCAL_API_TOKEN' : 'SCREEPS_API_TOKEN';
  const token = env[tokenKey]?.trim();
  if (!token) throw new Error(local
    ? 'SCREEPS_LOCAL_API_TOKEN is required in .env.local. Run npm run local:bootstrap, then npm run local:auth -- <username>. No MMO token or password is used.'
    : 'SCREEPS_API_TOKEN is required. Put it in a local .env file; never commit it.');
  const branch = env[local ? 'SCREEPS_LOCAL_CODE_BRANCH' : 'SCREEPS_CODE_BRANCH'] || (local ? 'local' : 'default');
  if (local && !/^[a-zA-Z0-9_-]{1,30}$/.test(branch)) throw new Error('Invalid local Screeps code branch: use 1-30 letters, numbers, underscores, or hyphens.');
  return { target, url, token, branch };
}

export async function deploymentEnv(target, env = process.env) {
  const file = target === 'local' ? '.env.local' : '.env';
  const values = existsSync(file) ? parseEnv(await readFile(file, 'utf8')) : {};
  return { ...values, ...env };
}
