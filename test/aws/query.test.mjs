import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoomName } from '../../shared/world/rooms.ts';
import { LIMITS, validateRequest, validRoom, partitionKey, historyWindow, historyInput } from '../../aws/query/query.mjs';
import { projectRecord, unmarshallItem } from '../../aws/query/projection.mjs';
import { createQueryHandler } from '../../aws/query/runtime.mjs';
import { NOW, ROOM, row, historyRequest } from './queryFixtures.mjs';

function adapter(overrides = {}) {
  const logs = [];
  return { logs, handler: createQueryHandler({ tableName: 'private-table', now: () => NOW,
    getItem: async () => ({ Item: row({ latest: true }) }), query: async () => ({ Items: [] }),
    logger: { log: value => logs.push(value), error: value => logs.push(value) }, ...overrides }) };
}

test('request validation allowlists actions and defaults', () => {
  assert.deepEqual(validateRequest({ action: 'latest' }), { action: 'latest', shard: 'shard3' });
  assert.equal(validateRequest({ action: 'diagnose' }).hours, 6);
  assert.equal(validateRequest({ action: 'history', hours: 0.5 }).hours, 0.5);
});

test('malformed requests and caller-controlled database fields are rejected', () => {
  for (const event of [null, [], 'latest', {}, { action: 'scan' }, { action: 'latest', hours: 6 },
    ...['pk', 'sk', 'table', 'TableName', 'ExpressionAttributeValues', 'cursor', 'limit'].map(key => ({ action: 'latest', [key]: 'secret' }))]) {
    assert.throws(() => validateRequest(event), error => error.code === 'INVALID_REQUEST');
  }
});

test('shard identifiers are bounded and validated without coercion', () => {
  for (const shard of ['shard0', 'shard3', 'shard99', 'shard999', 'shardX']) assert.equal(validateRequest({ action: 'latest', shard }).shard, shard);
  for (const shard of [null, 3, '', 'shard03', 'shard1000', 'shard-1', 'shardx', 'shard3#ROOM', 'shard3\n']) {
    assert.throws(() => validateRequest({ action: 'latest', shard }));
  }
});

test('room syntax agrees with shared world parser for ordinary room names', () => {
  for (const name of ['E0S0', 'W0N0', 'E25S47', 'W19S7', 'E01N02', 'e1s1', 'sim', 'E1', 'E1S-1', 'E1S1#LATEST']) {
    let accepted = true; try { parseRoomName(name); } catch { accepted = false; }
    assert.equal(validRoom(name), accepted, name);
  }
  for (const room of [null, 12, 'E' + '1'.repeat(50) + 'S1']) assert.throws(() => validateRequest({ action: 'latest', room }));
});

test('partition keys are derived from validated scope', () => {
  assert.equal(partitionKey(validateRequest({ action: 'latest' })), 'COLONY#shard3');
  assert.equal(partitionKey(validateRequest({ action: 'latest', room: ROOM })), 'ROOM#shard3#E25S47');
});

test('history bounds enforce hard window limits and a closed snapshot range', () => {
  for (const hours of [0, -1, 25, '6', null, NaN, Infinity]) assert.throws(() => validateRequest({ action: 'history', hours }));
  const request = validateRequest({ action: 'history', hours: 24 });
  const window = historyWindow(request, NOW);
  assert.equal(Date.parse(window.end) - Date.parse(window.start), 86400000);
  const input = historyInput('private-table', request, window, 100);
  assert.equal(input.ExpressionAttributeValues[':start'].S, 'SNAPSHOT#' + window.start);
  assert.equal(input.ExpressionAttributeValues[':end'].S, 'SNAPSHOT#' + window.end);
  assert.equal(input.ScanIndexForward, false);
  assert.equal(input.ConsistentRead, true);
  assert.equal(input.FilterExpression, undefined);
});

test('latest colony reads only derived LATEST and hides storage attributes', async () => {
  const { handler } = adapter({ getItem: async input => {
    assert.deepEqual(input, { TableName: 'private-table', Key: { pk: { S: 'COLONY#shard3' }, sk: { S: 'LATEST' } }, ConsistentRead: true });
    return { Item: row({ latest: true }) };
  } });
  const response = await handler({ action: 'latest' });
  assert.equal(response.ok, true); assert.equal(response.record.telemetry.rooms[0].name, ROOM);
  for (const text of ['private-table', 'COLONY#', 'PutRequest', 'expiresAt', 'roomName']) assert.ok(!JSON.stringify(response).includes(text));
  assert.equal(response.record.tick, 100);
});

test('latest room reads the derived room partition and preserves schema', async () => {
  const { handler } = adapter({ getItem: async input => {
    assert.equal(input.Key.pk.S, 'ROOM#shard3#' + ROOM);
    return { Item: row({ room: true, latest: true }) };
  } });
  const response = await handler({ action: 'latest', room: ROOM });
  assert.equal(response.record.telemetry.room.name, ROOM);
  assert.equal(response.record.telemetry.rooms, undefined);
});

test('latest with no telemetry gives a clear bounded error', async () => {
  const { handler } = adapter({ getItem: async () => ({}) });
  assert.equal((await handler({ action: 'latest' })).error.code, 'NO_TELEMETRY');
});

test('history internally paginates and returns chronological compact observations', async () => {
  let calls = 0;
  const cursor = { pk: { S: 'COLONY#shard3' }, sk: row({ index: 1 }).sk };
  const { handler } = adapter({ query: async input => {
    calls += 1;
    if (calls === 1) { assert.equal(input.Limit, LIMITS.rows); return { Items: [row({ index: 3 }), row({ index: 2 }), row({ index: 1 })], LastEvaluatedKey: cursor }; }
    assert.deepEqual(input.ExclusiveStartKey, cursor); assert.equal(input.Limit, LIMITS.rows - 3);
    return { Items: [row()] };
  } });
  const response = await handler(historyRequest);
  assert.equal(calls, 2); assert.deepEqual(response.observations.map(sample => sample.tick), [100, 101, 102, 103]);
  assert.equal(response.truncated, false); assert.equal(response.observations[0].telemetry.creeps, undefined);
  assert.equal(response.observations[0].telemetry.creepCount, 0);
  assert.ok(!JSON.stringify(response).includes('ExclusiveStartKey'));
});

test('room history queries work without colony records', async () => {
  const { handler } = adapter({ query: async input => {
    assert.equal(input.ExpressionAttributeValues[':pk'].S, 'ROOM#shard3#' + ROOM);
    return { Items: [row({ room: true })] };
  } });
  const response = await handler({ ...historyRequest, room: ROOM });
  assert.equal(response.observations[0].telemetry.room.name, ROOM);
});

test('hard row cap stops pagination even when telemetry rows are invalid', async () => {
  let calls = 0;
  const { handler } = adapter({ query: async () => {
    calls += 1;
    return { Items: Array.from({ length: 100 }, () => ({})), LastEvaluatedKey: { pk: { S: 'COLONY#shard3' }, sk: row().sk } };
  } });
  const response = await handler(historyRequest);
  assert.equal(calls, 1); assert.equal(response.readCount, 100); assert.equal(response.invalidRows, 100);
  assert.equal(response.sampleCount, 0); assert.equal(response.truncated, true);
});

test('hard page cap bounds empty internal pages and reports truncation', async () => {
  let calls = 0;
  const { handler } = adapter({ query: async () => {
    const time = new Date(NOW - (++calls) * 60000).toISOString();
    return { Items: [], LastEvaluatedKey: { pk: { S: 'COLONY#shard3' }, sk: { S: 'SNAPSHOT#' + time } } };
  } });
  const response = await handler(historyRequest);
  assert.equal(calls, LIMITS.pages); assert.equal(response.truncated, true);
});

test('repeated or wrong-partition cursors fail safely', async () => {
  for (const pk of ['COLONY#shard3', 'COLONY#other']) {
    const { handler } = adapter({ query: async () => ({ Items: [], LastEvaluatedKey: { pk: { S: pk }, sk: row().sk } }) });
    assert.equal((await handler(historyRequest)).error.code, 'READ_FAILED');
  }
});

test('empty history and diagnostics are successful with explicit zero coverage', async () => {
  const { handler } = adapter();
  const history = await handler(historyRequest);
  assert.deepEqual(history.observations, []); assert.deepEqual(history.coverage, { start: null, end: null });
  const result = await handler({ action: 'diagnose' });
  assert.equal(result.diagnostics.facts.sampleCount, 0);
  assert.equal(result.diagnostics.trends.cpuUsed.average, null);
});

test('malformed telemetry is rejected; history skips and counts bad records', async () => {
  const bad = row({ mutate: item => { item.schemaVersion = 2; } });
  assert.equal(projectRecord(bad, historyRequest), null);
  const { handler } = adapter({ query: async () => ({ Items: [bad, row(), { pk: { B: 'not-supported' } }] }) });
  const response = await handler(historyRequest);
  assert.equal(response.invalidRows, 2); assert.equal(response.sampleCount, 1);
  const latest = adapter({ getItem: async () => ({ Item: bad }) }).handler;
  assert.equal((await latest({ action: 'latest' })).error.code, 'INVALID_TELEMETRY');
});

test('schema envelope, timestamps, room identity and nested malformed arrays are checked', () => {
  for (const mutate of [item => { item.tick = -1; }, item => { item.collectedAt = 'bad'; },
    item => { item.sk = 'SNAPSHOT#wrong'; }, item => { item.telemetry.tick = 999; },
    item => { item.telemetry.rooms[0].spawns = null; }, item => { item.telemetry.rooms[0].rcl = 9; }]) {
    assert.equal(projectRecord(row({ mutate }), historyRequest), null);
  }
  assert.equal(projectRecord(row({ room: true, mutate: item => { item.roomName = 'E1S1'; } }), { ...historyRequest, room: ROOM }), null);
});

test('unknown numeric metrics remain unknown instead of becoming zero', () => {
  const record = projectRecord(row({ mutate: item => { delete item.telemetry.cpu.used; item.telemetry.rooms[0].workerPopulation.effective = 'bad'; } }), historyRequest, true);
  assert.equal(record.telemetry.cpu.used, null); assert.equal(record.telemetry.rooms[0].workerPopulation.effective, null);
});

test('out-of-window records are discarded and duplicate sample timestamps are explicit', async () => {
  const { handler } = adapter({ query: async () => ({ Items: [row(), row(), row({ index: 100 })] }) });
  const response = await handler(historyRequest);
  assert.equal(response.invalidRows, 1); assert.equal(response.duplicateRows, 1); assert.equal(response.sampleCount, 1);
});

test('DynamoDB failures and invalid caller input never expose raw errors or logs', async () => {
  const secret = 'token-secret arn:aws:dynamodb:private-table raw-telemetry';
  const { handler, logs } = adapter({ getItem: async () => { throw new Error(secret); } });
  assert.equal((await handler({ action: 'latest' })).error.code, 'READ_FAILED');
  assert.equal((await handler({ action: secret })).error.code, 'INVALID_REQUEST');
  assert.ok(!JSON.stringify(logs).includes(secret));
  assert.ok(!JSON.stringify(await handler({ action: 'latest' })).includes(secret));
});

test('successful logs contain bounded metadata rather than telemetry', async () => {
  const { handler, logs } = adapter(); await handler({ action: 'latest' });
  const log = JSON.parse(logs[0]);
  assert.deepEqual(Object.keys(log).sort(), ['action', 'event', 'sampleCount', 'shard']);
  assert.ok(!logs[0].includes('cpu'));
});

test('read operations receive an invocation-wide abort deadline', async () => {
  const { handler } = adapter({ getItem: async (_input, options) => {
    assert.ok(options.abortSignal instanceof AbortSignal); return { Item: row({ latest: true }) };
  } });
  assert.equal((await handler({ action: 'latest' })).ok, true);
});

test('attribute decoding rejects nonfinite numbers, unsupported types and excessive nesting', () => {
  for (const value of [{ N: 'NaN' }, { N: '' }, { SS: ['a'] }, { S: 'a', N: '1' }]) assert.throws(() => unmarshallItem({ field: value }));
  let value = { S: 'test' }; for (let i = 0; i < 15; i += 1) value = { M: { child: value } };
  assert.throws(() => unmarshallItem({ field: value }));
});

test('oversized output fails with a bounded response instead of overflowing Lambda limits', async () => {
  const large = row({ latest: true, mutate: item => {
    item.telemetry.creeps = Array.from({ length: 1000 }, () => ({ name: 'x'.repeat(300), room: 'x'.repeat(300),
      kind: 'x'.repeat(300), home: 'x'.repeat(300), sourceId: 'x'.repeat(300) }));
  } });
  const { handler } = adapter({ getItem: async () => ({ Item: large }) });
  assert.equal((await handler({ action: 'latest' })).error.code, 'RESPONSE_LIMIT');
});

test('distinct-room cap bounds analysis across changing colony snapshots', async () => {
  const items = [0, 1].map(index => row({ index, mutate: item => {
    const source = item.telemetry.rooms[0];
    item.telemetry.rooms = Array.from({ length: 20 }, (_, n) => ({ ...source, name: `E${index * 20 + n}S1` }));
  } }));
  const { handler } = adapter({ query: async () => ({ Items: items }) });
  assert.equal((await handler({ action: 'diagnose' })).error.code, 'RESPONSE_LIMIT');
});

test('unsupported and duplicate labor kinds are malformed telemetry', () => {
  for (const mutate of [item => { item.telemetry.rooms[0].labor.kinds[0].kind = 'arbitrary'; },
    item => { item.telemetry.rooms[0].labor.kinds.push(item.telemetry.rooms[0].labor.kinds[0]); }]) {
    assert.equal(projectRecord(row({ mutate }), historyRequest), null);
  }
});

test('reverse-moving pagination cursors are required and row-limit violations fail', async () => {
  let call = 0;
  const { handler } = adapter({ query: async () => ({ Items: [], LastEvaluatedKey: {
    pk: { S: 'COLONY#shard3' }, sk: row({ index: call++ }).sk
  } }) });
  assert.equal((await handler(historyRequest)).error.code, 'READ_FAILED');
  const excessive = adapter({ query: async () => ({ Items: Array(101).fill({}) }) }).handler;
  assert.equal((await excessive(historyRequest)).error.code, 'READ_FAILED');
});
