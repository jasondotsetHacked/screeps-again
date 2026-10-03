import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
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

function httpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  if ('status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }

  if (
    'response' in error &&
    typeof (error as { response?: unknown }).response === 'object' &&
    (error as { response?: unknown }).response !== null
  ) {
    const status = (error as { response: { status?: unknown } }).response.status;
    return typeof status === 'number' ? status : null;
  }

  return null;
}

export async function withScreepsRetry<T>(
  operation: () => Promise<T>,
  label: string,
  onRetry?: (message: string) => void,
  maxAttempts = 5
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (httpStatus(error) !== 429 || attempt === maxAttempts) {
        throw error;
      }

      const waitMs = Math.min(8000, 1000 * 2 ** (attempt - 1));
      onRetry?.(
        `Screeps API rate-limited ${label}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxAttempts})...`
      );
      await delay(waitMs);
    }
  }

  throw lastError;
}

export function getScreepsClient(): ScreepsHttpClient {
  loadLocalEnv();

  const token = process.env.SCREEPS_API_TOKEN;
  if (!token) {
    throw new Error(
      'SCREEPS_API_TOKEN is required. Copy .env.example to .env and add a token.'
    );
  }

  return new ScreepsHttpClient({
    url: 'https://screeps.com',
    token
  });
}
