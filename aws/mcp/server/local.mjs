import { createServer } from 'node:http';
import { createGateway, MAX_REQUEST_BYTES } from './runtime.mjs';

// Deliberately synthetic and loopback-only. This entry point is never imported by Lambda.
const config = { resource: 'http://127.0.0.1:3000/mcp', shard: process.env.SCREEPS_SHARD ?? 'shard3',
  issuer: 'https://example.invalid/', metadataUrl: 'http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp',
  origins: ['http://localhost:6274', 'http://127.0.0.1:6274'] };
const gateway = createGateway({ config, authenticate: async () => {}, query: async event => ({
  ok: true, action: event.action,
  ...(event.action === 'latest' ? { record: { synthetic: true } } :
    event.action === 'history' ? { observations: [], synthetic: true } : { diagnostics: { synthetic: true } })
}) });
const server = createServer(async (req, res) => {
  try {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const response = await gateway.fetch(new Request(new URL(req.url, config.resource), {
      method: req.method, headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) })
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(400).end(); }
});
server.listen(3000, '127.0.0.1', () => console.log('Synthetic MCP only: http://127.0.0.1:3000/mcp'));
process.on('SIGINT', async () => { await gateway.close(); server.close(); });
