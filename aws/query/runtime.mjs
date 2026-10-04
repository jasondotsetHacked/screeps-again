import { LIMITS, QueryError, validateRequest, partitionKey, latestInput, historyInput, historyWindow } from './query.mjs';
import { projectRecord } from './projection.mjs';
import { diagnose } from './diagnostics.mjs';

// The adapter receives only two read operations; tests never need AWS credentials.
export function createQueryHandler({ getItem, query, tableName, now = Date.now, logger = console }) {
  return async function handler(event) {
    let request;
    try {
      request = validateRequest(event);
      if (!tableName) throw new QueryError('CONFIGURATION_ERROR', 'Telemetry query is not configured.');
      const options = { abortSignal: AbortSignal.timeout(10000) };
      let response;
      if (request.action === 'latest') {
        const result = await getItem(latestInput(tableName, request), options);
        if (!result.Item) throw new QueryError('NO_TELEMETRY', 'No telemetry exists for this shard and scope.');
        const record = projectRecord(result.Item, request);
        if (!record) throw new QueryError('INVALID_TELEMETRY', 'The latest telemetry record is invalid or unsupported.');
        response = { ok: true, action: request.action, record };
      } else {
        const window = historyWindow(request, now());
        const samples = [];
        let cursor, pages = 0, readCount = 0, invalidRows = 0;
        const cursors = new Set();
        do {
          const result = await query(historyInput(tableName, request, window, LIMITS.rows - readCount, cursor), options);
          pages += 1;
          const items = result.Items ?? [];
          if (!Array.isArray(items)) throw new QueryError('READ_FAILED', 'Telemetry could not be read.');
          if (items.length > LIMITS.rows - readCount) throw new QueryError('READ_FAILED', 'Telemetry could not be read.');
          readCount += items.length;
          for (const item of items) {
            const record = projectRecord(item, request, true);
            if (record && record.collectedAt >= window.start && record.collectedAt <= window.end) samples.push(record);
            else invalidRows += 1;
          }
          cursor = result.LastEvaluatedKey;
          if (cursor && Object.keys(cursor).length === 0) cursor = undefined;
          if (cursor) {
            if (Object.keys(cursor).length !== 2 || cursor.pk?.S !== partitionKey(request) ||
                typeof cursor.sk?.S !== 'string' || cursor.sk.S < 'SNAPSHOT#' + window.start || cursor.sk.S > 'SNAPSHOT#' + window.end ||
                cursors.has(cursor.sk.S) || (cursors.size && cursor.sk.S >= [...cursors].at(-1))) throw new QueryError('READ_FAILED', 'Telemetry could not be read.');
            cursors.add(cursor.sk.S);
          }
        } while (cursor && pages < LIMITS.pages && readCount < LIMITS.rows);
        samples.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
        const unique = samples.filter((sample, index) => !index || sample.collectedAt !== samples[index - 1].collectedAt);
        const roomNames = new Set(unique.flatMap(sample => sample.telemetry.room ?
          [sample.telemetry.room.name] : sample.telemetry.rooms.map(room => room.name)));
        if (roomNames.size > LIMITS.rooms) throw new QueryError('RESPONSE_LIMIT', 'Too many observed rooms; request a room.');
        const metadata = { shard: request.shard, ...(request.room ? { room: request.room } : {}),
          requestedWindow: window, sampleCount: unique.length,
          coverage: { start: unique[0]?.collectedAt ?? null, end: unique.at(-1)?.collectedAt ?? null },
          truncated: Boolean(cursor), invalidRows, readCount,
          duplicateRows: samples.length - unique.length };
        response = { ok: true, action: request.action, ...metadata,
          ...(request.action === 'history' ? { observations: unique } : { diagnostics: diagnose(unique) }) };
      }
      if (Buffer.byteLength(JSON.stringify(response)) > LIMITS.responseBytes) {
        throw new QueryError('RESPONSE_LIMIT', 'Response exceeds the size limit; request a room or a shorter window.');
      }
      logger.log(JSON.stringify({ event: 'telemetry-query-completed', ...request,
        sampleCount: response.sampleCount ?? 1 }));
      return response;
    } catch (error) {
      const code = error instanceof QueryError ? error.code : 'READ_FAILED';
      logger.error(JSON.stringify({ event: 'telemetry-query-failed', ...(request ?? {}), category: code }));
      return { ok: false, error: { code, message: error instanceof QueryError ? error.message : 'Telemetry could not be read. Try again or check AWS permissions.' } };
    }
  };
}
