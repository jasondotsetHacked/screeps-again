import { createMcpHandler, parseJSONRPCMessage } from '@modelcontextprotocol/server';
import { createServer } from './tools.mjs';
import { AccessError, READ_SCOPE, challenge } from './auth.mjs';

export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 2304 * 1024;
const json = (status, error, headers = {}) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store', ...headers } });

export function createGateway({ config, authenticate, query, logger = console }) {
  const mcp = createMcpHandler(() => createServer({ shard: config.shard, query, logger }), {
    responseMode: 'auto', legacy: 'stateless', maxSubscriptions: 0,
    keepAliveMs: 0, maxRequestBodySize: MAX_REQUEST_BYTES,
    onerror: () => logger.error(JSON.stringify({ event: 'mcp-protocol-rejected' }))
  });
  return {
    close: () => mcp.close(),
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const expected = new URL(config.resource);
        if (url.origin !== expected.origin ||
            (request.headers.has('host') && request.headers.get('host') !== expected.host) ||
            (request.headers.has('origin') && !config.origins.includes(request.headers.get('origin')))) return json(403, 'Access denied.');
        if (url.search) return json(400, 'Query parameters are not supported.');
        if (url.href === config.metadataUrl && request.method === 'GET') {
          return Response.json({ resource: config.resource, authorization_servers: [config.issuer],
            scopes_supported: [READ_SCOPE], bearer_methods_supported: ['header'] }, { headers: { 'cache-control': 'no-store' } });
        }
        if (url.pathname !== '/mcp') return json(404, 'Not found.');
        try { await authenticate(request); }
        catch (error) {
          const status = error instanceof AccessError ? error.status : 401;
          logger.log(JSON.stringify({ event: 'mcp-access-denied', status }));
          return json(status, 'Access denied.', { 'www-authenticate': challenge(config, status) });
        }
        if (!['POST', 'GET', 'DELETE'].includes(request.method)) return json(405, 'Method not allowed.', { allow: 'POST, GET, DELETE' });
        if (request.method === 'POST') {
          const body = await request.text();
          if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return json(413, 'Request exceeds the size limit.');
          try { parseJSONRPCMessage(JSON.parse(body)); }
          catch { return json(400, 'Invalid MCP message.'); }
          request = new Request(request.url, { method: 'POST', headers: request.headers, body });
        }
        const response = await mcp.fetch(request);
        // No streaming subscriptions are offered. Bound the complete buffered Lambda response.
        const body = await response.text();
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) return json(502, 'Response exceeds the size limit.');
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'no-store');
        return new Response(body || null, { status: response.status, headers });
      } catch {
        logger.error(JSON.stringify({ event: 'mcp-request-failed' }));
        return json(500, 'Request could not be processed.');
      }
    }
  };
}

export function createLambdaHandler(gateway, config) {
  return async event => {
    try {
      const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return { statusCode: 413, body: '{"error":"Request exceeds the size limit."}' };
      const method = event.requestContext?.http?.method;
      const request = new Request(new URL(event.rawPath + (event.rawQueryString ? '?' + event.rawQueryString : ''), config.resource), {
        method, headers: event.headers, ...(['GET', 'HEAD'].includes(method) ? {} : { body })
      });
      const response = await gateway.fetch(request);
      return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text(), isBase64Encoded: false };
    } catch { return { statusCode: 400, body: '{"error":"Invalid request."}' }; }
  };
}
