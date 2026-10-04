import {
  BatchWriteItemCommand,
  DynamoDBClient
} from '@aws-sdk/client-dynamodb';
import {
  GetParameterCommand,
  SSMClient
} from '@aws-sdk/client-ssm';
import {
  buildDynamoItems,
  decodeScreepsData,
  marshallItem,
  normalizeOpsMemory
} from './telemetry.mjs';

const dynamodb = new DynamoDBClient({});
const ssm = new SSMClient({});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getScreepsToken() {
  const result = await ssm.send(
    new GetParameterCommand({
      Name: requiredEnv('SCREEPS_TOKEN_PARAMETER'),
      WithDecryption: true
    })
  );
  const token = result.Parameter?.Value;
  if (!token) throw new Error('Screeps token parameter has no value');
  return token;
}

async function readOpsMemory(token, shard) {
  const url = new URL('https://screeps.com/api/user/memory');
  url.searchParams.set('path', 'ops');
  url.searchParams.set('shard', shard);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Token': token,
        'X-Username': token
      },
      signal: AbortSignal.timeout(8000)
    });

    if (response.status === 429 && attempt < 4) {
      await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
      continue;
    }

    if (!response.ok) {
      throw new Error('Screeps read failed with HTTP ' + response.status);
    }

    const body = await response.json();
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'data')) {
      throw new Error('Screeps response did not include memory data');
    }

    return decodeScreepsData(body.data);
  }

  throw new Error('Screeps read exhausted retry attempts');
}

async function writeBatch(tableName, items) {
  const chunks = [];
  for (let index = 0; index < items.length; index += 25) {
    chunks.push(items.slice(index, index + 25));
  }

  for (const chunk of chunks) {
    let requestItems = {
      [tableName]: chunk.map((item) => ({
        PutRequest: { Item: marshallItem(item) }
      }))
    };

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await dynamodb.send(
        new BatchWriteItemCommand({ RequestItems: requestItems })
      );
      const unprocessed = result.UnprocessedItems?.[tableName] ?? [];
      if (unprocessed.length === 0) break;

      if (attempt === 5) {
        throw new Error(
          'DynamoDB left ' + unprocessed.length + ' telemetry writes unprocessed'
        );
      }

      requestItems = { [tableName]: unprocessed };
      await sleep(Math.min(4000, 250 * 2 ** (attempt - 1)));
    }
  }
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

export async function handler() {
  const shard = process.env.SCREEPS_SHARD ?? 'shard3';
  const tableName = requiredEnv('TELEMETRY_TABLE');
  const retentionDays = Number.parseInt(
    process.env.TELEMETRY_RETENTION_DAYS ?? '30',
    10
  );

  try {
    const token = await getScreepsToken();
    const rawOps = await readOpsMemory(token, shard);
    const telemetry = normalizeOpsMemory(rawOps);

    if (!telemetry) {
      throw new Error(
        'Screeps Memory.ops is missing, invalid, or uses an unsupported version'
      );
    }

    const collectedAt = new Date().toISOString();
    const items = buildDynamoItems(telemetry, {
      shard,
      collectedAt,
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : 30
    });

    await writeBatch(tableName, items);

    console.log(
      JSON.stringify({
        event: 'screeps-telemetry-collected',
        shard,
        tick: telemetry.tick,
        rooms: telemetry.rooms.length,
        creeps: telemetry.creeps.length,
        records: items.length
      })
    );

    return {
      tick: telemetry.tick,
      rooms: telemetry.rooms.length,
      records: items.length
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'screeps-telemetry-collection-failed',
        name: error instanceof Error ? error.name : 'Error',
        message: safeErrorMessage(error)
      })
    );
    throw error;
  }
}
