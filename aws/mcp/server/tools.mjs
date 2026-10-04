import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const room = z.string().max(20).regex(/^[WE]\d+[NS]\d+$/).optional();
const hours = z.number().positive().max(24).optional();
const latest = z.strictObject({ room });
const windowed = z.strictObject({ room, hours });
export const TOOLS = Object.freeze([
  { name: 'screeps_latest', action: 'latest', schema: latest,
    description: 'Get the most recent private telemetry snapshot for the colony or one room.' },
  { name: 'screeps_history', action: 'history', schema: windowed,
    description: 'Get bounded chronological telemetry observations for the colony or one room. hours defaults to 6; maximum 24. History may be incomplete.' },
  { name: 'screeps_diagnose', action: 'diagnose', schema: windowed,
    description: 'Get deterministic facts, trends, and warning signals derived from recent Screeps telemetry. hours defaults to 6; maximum 24. These observations do not prove causation.' }
]);

export function queryEvent(name, input, shard) {
  const tool = TOOLS.find(tool => tool.name === name);
  if (!tool) throw new Error('Unknown telemetry tool.');
  const args = tool.schema.parse(input);
  return { action: tool.action, shard,
    ...(args.room === undefined ? {} : { room: args.room }),
    ...(args.hours === undefined ? {} : { hours: args.hours }) };
}

export function createServer({ shard, query, logger = console }) {
  const server = new McpServer({ name: 'screeps-private-telemetry', version: '0.1.0' });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['telemetry:read'] }] }
    }, async args => {
      try {
        const result = await query(queryEvent(tool.name, args, shard));
        logger.log(JSON.stringify({ event: 'mcp-tool-completed', tool: tool.name }));
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        // Never print exception messages, inputs, identities, or backend payloads.
        logger.error(JSON.stringify({ event: 'mcp-tool-failed', tool: tool.name }));
        return { isError: true, content: [{ type: 'text', text: safeBackendMessage(error) }] };
      }
    });
  }
  return server;
}

// Only our adapter can create these categories; provider/backend messages are discarded.
export class BackendError extends Error {
  constructor(code) { super('Telemetry query failed.'); this.code = code; }
}
export function safeBackendMessage(error) {
  const messages = {
    NO_TELEMETRY: 'No telemetry is available for this scope.',
    RESPONSE_LIMIT: 'Telemetry exceeds the response limit. Request a room or a shorter window.',
    INVALID_REQUEST: 'The telemetry query rejected this request.',
    INVALID_TELEMETRY: 'Telemetry is invalid or unsupported.'
  };
  return error instanceof BackendError && Object.hasOwn(messages, error.code) ? messages[error.code] : 'Telemetry is temporarily unavailable. Try again later.';
}
