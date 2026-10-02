import { existsSync } from 'node:fs';
import process from 'node:process';
import { ScreepsHttpClient } from 'screeps-api';

let envLoaded = false;

function loadLocalEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

export function getScreepsClient(): ScreepsHttpClient {
  loadLocalEnv();

  const token = process.env.SCREEPS_API_TOKEN;
  if (!token) {
    throw new Error('SCREEPS_API_TOKEN is required. Copy .env.example to .env and add a token.');
  }

  return new ScreepsHttpClient({
    url: 'https://screeps.com',
    token
  });
}
