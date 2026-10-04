export const LIMITS = Object.freeze({ hours: 24, rows: 100, pages: 8, rooms: 32, responseBytes: 1024 * 1024 });

export class QueryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Same syntax as shared/world/rooms.ts; parity tests protect this standalone JS boundary.
export function validRoom(room) {
  return typeof room === 'string' && room.length <= 20 && /^([WE])(\d+)([NS])(\d+)$/.test(room);
}

export function validateRequest(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).some(key => !['action', 'shard', 'room', 'hours'].includes(key))) {
    throw new QueryError('INVALID_REQUEST', 'Expected only action, shard, optional room and hours.');
  }
  if (!['latest', 'history', 'diagnose'].includes(event.action)) {
    throw new QueryError('INVALID_REQUEST', 'Action must be latest, history or diagnose.');
  }
  const shard = 'shard' in event ? event.shard : 'shard3';
  if (typeof shard !== 'string' || !/^shard(?:0|[1-9]\d{0,2}|X)$/.test(shard)) {
    throw new QueryError('INVALID_REQUEST', 'Shard must be shard0 through shard999, or shardX.');
  }
  if ('room' in event && !validRoom(event.room)) {
    throw new QueryError('INVALID_REQUEST', 'Room must be a Screeps room name, for example E25S47.');
  }
  if (event.action === 'latest' && 'hours' in event) {
    throw new QueryError('INVALID_REQUEST', 'latest does not accept hours.');
  }
  const hours = event.action === 'latest' ? undefined : ('hours' in event ? event.hours : 6);
  if (hours !== undefined && (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > LIMITS.hours)) {
    throw new QueryError('INVALID_REQUEST', 'hours must be a number greater than 0 and at most 24.');
  }
  return { action: event.action, shard, ...(event.room ? { room: event.room } : {}), ...(hours === undefined ? {} : { hours }) };
}

export function partitionKey(request) {
  return request.room ? `ROOM#${request.shard}#${request.room}` : `COLONY#${request.shard}`;
}

export function historyWindow(request, now) {
  return { start: new Date(now - request.hours * 3600000).toISOString(), end: new Date(now).toISOString() };
}

export function latestInput(table, request) {
  return { TableName: table, Key: { pk: { S: partitionKey(request) }, sk: { S: 'LATEST' } }, ConsistentRead: true };
}

export function historyInput(table, request, window, limit, cursor) {
  return {
    TableName: table,
    KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
    ExpressionAttributeValues: {
      ':pk': { S: partitionKey(request) },
      ':start': { S: 'SNAPSHOT#' + window.start }, ':end': { S: 'SNAPSHOT#' + window.end }
    },
    ScanIndexForward: false, ConsistentRead: true, Limit: limit,
    ...(cursor ? { ExclusiveStartKey: cursor } : {})
  };
}
