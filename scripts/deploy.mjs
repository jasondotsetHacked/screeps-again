import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

await api.userCodeSet({
  branch,
  modules: {
    main: code
  }
});

console.log(`Uploaded dist/main.js to Screeps code branch "${branch}".`);
