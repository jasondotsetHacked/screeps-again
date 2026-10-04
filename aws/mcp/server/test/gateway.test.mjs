import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createAuthenticator, subjectHash } from '../auth.mjs';
import { createGateway, createLambdaHandler, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from '../runtime.mjs';
import { createBackend, MAX_BACKEND_BYTES } from '../backend.mjs';
import { queryEvent, TOOLS } from '../tools.mjs';
import { readConfig } from '../config.mjs';

const issuer = 'https://identity.example.invalid/';
const resource = 'https://gateway.example.invalid/mcp';
const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:synthetic-query';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'test-key';
const config = { issuer, resource, functionArn, shard: 'shard2',
  allowedSubjectHashes: [subjectHash('synthetic-owner')], origins: ['https://chatgpt.com'],
  metadataUrl: 'https://gateway.example.invalid/.well-known/oauth-protected-resource/mcp' };
const authenticate = createAuthenticator({ ...config, jwks: createLocalJWKSet({ keys: [jwk] }) });
async function token(claims = {}, key = privateKey) {
  return new SignJWT({ scope: 'telemetry:read', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(claims.iss ?? issuer).setAudience(claims.aud ?? resource)
    .setSubject(claims.sub ?? 'synthetic-owner').setIssuedAt().setExpirationTime(claims.exp ?? '5m').sign(key);
}
const validToken = await token();
const logs = () => {
  const entries = [];
  return { entries, log: entry => entries.push(entry), error: entry => entries.push(entry) };
};
function request(body, accessToken = validToken, extra = {}) {
  return new Request(resource, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
}
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const success = action => ({ ok: true, action, ...(action === 'latest' ? { record: { synthetic: true } } :
  action === 'history' ? { observations: [] } : { diagnostics: { synthetic: true } }) });
const backend = reply => createBackend({ functionArn, client: { send: async () => reply } });
const lambdaReply = value => ({ StatusCode: 200, Payload: Buffer.from(JSON.stringify(value)) });
async function clientFor(t, query, options = {}) {
  const gateway = createGateway({ config, authenticate, query, logger: logs() });
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' }, options);
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { authorization: `Bearer ${validToken}` } },
    fetch: (url, init) => gateway.fetch(new Request(url, init))
  });
  t.after(async () => { await client.close(); await gateway.close(); });
  await client.connect(transport);
  return { client, transport };
}

test('SDK lists exactly three read-only tools with strict optional schemas and OAuth metadata', async t => {
  const { client } = await clientFor(t, async () => assert.fail('listing invoked AWS'), { versionNegotiation: { mode: 'auto' } });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), TOOLS.map(tool => tool.name));
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.properties.room.maxLength, 20);
    assert.equal(tool.inputSchema.properties.room.pattern, '^[WE]\\d+[NS]\\d+$');
    assert.deepEqual(tool.inputSchema.required ?? [], []);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['telemetry:read'] }]);
    assert.deepEqual(Object.keys(tool.inputSchema.properties), tool.name === 'screeps_latest' ? ['room'] : ['room', 'hours']);
    if (tool.name !== 'screeps_latest') {
      assert.equal(tool.inputSchema.properties.hours.maximum, 24);
      assert.equal(tool.inputSchema.properties.hours.exclusiveMinimum, 0);
    }
  }
});
for (const tool of TOOLS) {
  test(`${tool.name} injects configured shard and maps exact action through SDK`, async t => {
    const seen = [];
    const { client } = await clientFor(t, async event => { seen.push(event); return success(event.action); }, { versionNegotiation: { mode: 'auto' } });
    const args = { room: 'E25S47', ...(tool.action === 'latest' ? {} : { hours: 6 }) };
    const result = await client.callTool({ name: tool.name, arguments: args });
    assert.deepEqual(seen, [{ action: tool.action, shard: 'shard2', ...args }]);
    assert.deepEqual(result.structuredContent, success(tool.action));
    assert.deepEqual(JSON.parse(result.content[0].text), success(tool.action));
  });
  test(`${tool.name} omits optional inputs and delegates backend defaults`, () => {
    assert.deepEqual(queryEvent(tool.name, {}, 'shardX'), { action: tool.action, shard: 'shardX' });
  });
}
for (const room of [null, '', 123, 'e25s47', 'E1S1 trailing', 'W' + '1'.repeat(20) + 'N1']) {
  test(`rejects invalid optional room ${JSON.stringify(room)}`, () => {
    assert.throws(() => queryEvent('screeps_latest', { room }, 'shard3'));
  });
}
for (const hours of [null, '6', 0, -1, 24.01, NaN, Infinity]) {
  test(`rejects invalid hours ${String(hours)}`, () => {
    assert.throws(() => queryEvent('screeps_history', { hours }, 'shard3'));
    assert.throws(() => queryEvent('screeps_diagnose', { hours }, 'shard3'));
  });
}
test('accepts fractional and maximum hours and all valid room directions', () => {
  for (const room of ['E0N0', 'W123S456', 'E25S47']) assert.equal(queryEvent('screeps_history', { room, hours: 0.5 }, 'shard3').hours, 0.5);
  assert.equal(queryEvent('screeps_diagnose', { hours: 24 }, 'shard3').hours, 24);
});
for (const input of [null, [], 'text', { hours: 1 }, { shard: 'shard0' }, { action: 'write' }, { FunctionName: 'other' }]) {
  test(`rejects latest input ${JSON.stringify(input)}`, () => assert.throws(() => queryEvent('screeps_latest', input, 'shard3')));
}
test('rejects unknown tool in mapping and through SDK without calling backend', async t => {
  assert.throws(() => queryEvent('invoke_lambda', {}, 'shard3'));
  const { client } = await clientFor(t, async () => assert.fail('unknown tool invoked AWS'));
  await assert.rejects(() => client.callTool({ name: 'invoke_lambda', arguments: {} }), /not found/);
});
test('malformed tool args fail at the protocol boundary without backend invocation', async t => {
  const { client } = await clientFor(t, async () => assert.fail('invalid arguments invoked AWS'));
  for (const args of [{ room: null }, { hours: 25 }, { shard: 'shard0' }]) {
    const result = await client.callTool({ name: 'screeps_history', arguments: args });
    assert.equal(result.isError, true);
  }
});
test('2025-era initialization and calls remain compatible', async t => {
  const { client } = await clientFor(t, async event => success(event.action), { versionNegotiation: { mode: 'legacy' } });
  assert.equal((await client.callTool({ name: 'screeps_latest', arguments: {} })).structuredContent.ok, true);
});
test('Lambda adapter invokes only configured target, synchronously, with exact query payload', async () => {
  let invocation, options;
  const query = createBackend({ functionArn, client: { send: async (command, opts) => {
    invocation = command; options = opts; return lambdaReply(success('history'));
  } } });
  const event = queryEvent('screeps_history', { hours: 2 }, 'shard2');
  assert.deepEqual(await query(event), success('history'));
  assert.equal(invocation.constructor.name, 'InvokeCommand');
  assert.deepEqual(Object.keys(invocation.input).sort(), ['FunctionName', 'InvocationType', 'Payload']);
  assert.equal(invocation.input.FunctionName, functionArn);
  assert.equal(invocation.input.InvocationType, 'RequestResponse');
  assert.deepEqual(JSON.parse(Buffer.from(invocation.input.Payload)), event);
  assert.ok(options.abortSignal instanceof AbortSignal);
});
for (const code of ['NO_TELEMETRY', 'RESPONSE_LIMIT', 'INVALID_REQUEST', 'INVALID_TELEMETRY', 'READ_FAILED', 'CONFIGURATION_ERROR', 'UNKNOWN']) {
  test(`backend ${code} maps safely through MCP without backend message leakage`, async t => {
    const query = backend(lambdaReply({ ok: false, error: { code, message: 'PRIVATE arn:aws secret detail' } }));
    const { client } = await clientFor(t, query);
    const result = await client.callTool({ name: 'screeps_latest', arguments: {} });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|arn:aws|secret detail/);
    assert.ok(result.content[0].text.length < 160);
  });
}
for (const [name, reply] of [
  ['function exception', { StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('private exception') }],
  ['non-200', { StatusCode: 202 }], ['missing payload', { StatusCode: 200 }],
  ['invalid JSON', { StatusCode: 200, Payload: Buffer.from('{') }],
  ['invalid UTF8', { StatusCode: 200, Payload: Buffer.from([255]) }],
  ['null envelope', lambdaReply(null)], ['invalid ok', lambdaReply({ ok: 'yes' })],
  ['wrong action', lambdaReply(success('history'))], ['missing result', lambdaReply({ ok: true, action: 'latest' })],
  ['oversized response', { StatusCode: 200, Payload: Buffer.alloc(MAX_BACKEND_BYTES + 1) }]
]) {
  test(`rejects malformed Lambda response: ${name}`, async () => {
    await assert.rejects(() => backend(reply)({ action: 'latest' }), /Telemetry query failed/);
  });
}
test('AWS exception messages and bearer tokens never enter MCP results or logs', async t => {
  const logger = logs();
  const query = createBackend({ functionArn, client: { send: async () => { throw new Error(`AWS private account ${functionArn} ${validToken}`); } } });
  const gateway = createGateway({ config, authenticate, query, logger });
  t.after(() => gateway.close());
  const response = await gateway.fetch(request(rpc('tools/call', { name: 'screeps_latest', arguments: {} })));
  const output = await response.text();
  assert.match(output, /temporarily unavailable/);
  assert.doesNotMatch(output + logger.entries.join(''), /arn:aws|AWS private|000000000000/);
  assert.ok(!(output + logger.entries.join('')).includes(validToken));
});
for (const [name, claims, status] of [
  ['expired', { exp: 1 }, 401], ['wrong issuer', { iss: 'https://other.example.invalid/' }, 401],
  ['wrong audience', { aud: 'https://other.example.invalid/mcp' }, 401],
  ['future nbf', { nbf: Math.floor(Date.now() / 1000) + 3600 }, 401],
  ['missing read scope', { scope: 'unrelated:read' }, 403],
  ['unrelated authenticated subject', { sub: 'synthetic-unrelated' }, 403]
]) {
  test(`authentication/authorization rejects ${name}`, async t => {
    const logger = logs();
    const gateway = createGateway({ config, authenticate, query: async () => assert.fail('denied caller invoked backend'), logger });
    t.after(() => gateway.close());
    const accessToken = await token(claims);
    const response = await gateway.fetch(request(rpc('tools/list'), accessToken));
    assert.equal(response.status, status);
    assert.match(response.headers.get('www-authenticate'), /resource_metadata="https:\/\/gateway.example.invalid\/.well-known\/oauth-protected-resource\/mcp"/);
    assert.ok(!logger.entries.join('').includes(accessToken));
  });
}
test('missing and forged bearer tokens are rejected', async t => {
  const gateway = createGateway({ config, authenticate, query: async () => assert.fail('unauthenticated backend'), logger: logs() });
  t.after(() => gateway.close());
  const otherKey = await generateKeyPair('RS256');
  for (const accessToken of [null, 'invalid.synthetic.token', await token({}, otherKey.privateKey)]) {
    assert.equal((await gateway.fetch(request(rpc('tools/list'), accessToken))).status, 401);
  }
});
test('missing required JWT claims and non-RS256 signatures are rejected', async () => {
  const missing = await new SignJWT({ scope: 'telemetry:read', sub: 'synthetic-owner' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(resource).sign(privateKey);
  const symmetric = await new SignJWT({ scope: 'telemetry:read' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer).setAudience(resource).setSubject('synthetic-owner').setIssuedAt().setExpirationTime('5m').sign(new Uint8Array(32));
  for (const accessToken of [missing, symmetric]) await assert.rejects(() => authenticate(request(rpc('tools/list'), accessToken)), error => error.status === 401);
});
test('empty subject allowlist fails closed', async () => {
  const denyAll = createAuthenticator({ ...config, allowedSubjectHashes: [], jwks: createLocalJWKSet({ keys: [jwk] }) });
  await assert.rejects(() => denyAll(request(rpc('tools/list'))), error => error.status === 403);
});
test('only OAuth resource discovery is publicly accessible and carries no private identifiers', async t => {
  const gateway = createGateway({ config, authenticate, query: async () => assert.fail('metadata backend'), logger: logs() });
  t.after(() => gateway.close());
  const response = await gateway.fetch(new Request(config.metadataUrl));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { resource, authorization_servers: [issuer], scopes_supported: ['telemetry:read'], bearer_methods_supported: ['header'] });
  assert.equal((await gateway.fetch(new Request(resource))).status, 401);
  assert.equal((await gateway.fetch(new Request('https://gateway.example.invalid/unrelated'))).status, 404);
});
test('rejects unexpected host, browser origin, and query parameters', async t => {
  const gateway = createGateway({ config, authenticate, query: async () => assert.fail('bad origin backend'), logger: logs() });
  t.after(() => gateway.close());
  assert.equal((await gateway.fetch(request(rpc('tools/list'), validToken, { origin: 'https://evil.example.invalid' }))).status, 403);
  assert.equal((await gateway.fetch(request(rpc('tools/list'), validToken, { host: 'evil.example.invalid' }))).status, 403);
  assert.equal((await gateway.fetch(new Request(resource + '?api_key=synthetic'))).status, 400);
});
test('malformed JSON-RPC and oversized requests are bounded without backend work', async t => {
  const gateway = createGateway({ config, authenticate, query: async () => assert.fail('malformed backend'), logger: logs() });
  t.after(() => gateway.close());
  assert.equal((await gateway.fetch(request(' '.repeat(MAX_REQUEST_BYTES + 1)))).status, 413);
  for (const body of ['{', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]), JSON.stringify({ method: 7 })]) {
    const response = await gateway.fetch(request(body));
    const output = await response.text();
    assert.ok(response.status >= 400 || output.includes('"error"'));
  }
});
test('near-limit backend results remain bounded with identical structured content', async t => {
  const result = { ok: true, action: 'latest', record: { synthetic: 'x'.repeat(MAX_BACKEND_BYTES - 200) } };
  const { client } = await clientFor(t, backend(lambdaReply(result)));
  const output = await client.callTool({ name: 'screeps_latest', arguments: {} });
  assert.deepEqual(output.structuredContent, result);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) < MAX_RESPONSE_BYTES);
});
test('API Gateway v2 adapter roundtrip preserves status, challenge, and JSON responses', async t => {
  const gateway = createGateway({ config, authenticate, query: async event => success(event.action), logger: logs() });
  t.after(() => gateway.close());
  const handler = createLambdaHandler(gateway, config);
  const event = { rawPath: '/mcp', rawQueryString: '', requestContext: { http: { method: 'POST' } },
    headers: Object.fromEntries(request('').headers), body: Buffer.from(JSON.stringify(rpc('tools/list'))).toString('base64'), isBase64Encoded: true };
  const output = await handler(event);
  assert.equal(output.statusCode, 200);
  const message = output.body.startsWith('event:') ? output.body.split('\n').find(line => line.startsWith('data: ')).slice(6) : output.body;
  assert.equal(JSON.parse(message).result.tools.length, 3);
  assert.equal(output.headers['cache-control'], 'no-store');
  assert.equal(output.isBase64Encoded, false);
  assert.equal((await handler({ ...event, headers: {} })).statusCode, 401);
  assert.equal((await handler({ ...event, body: 'x'.repeat(MAX_REQUEST_BYTES + 1), isBase64Encoded: false })).statusCode, 413);
});
test('deployment config validates and never exposes its rejected value', () => {
  const env = { MCP_RESOURCE_URL: resource, OAUTH_ISSUER: issuer, SCREEPS_SHARD: 'shard3',
    QUERY_FUNCTION_ARN: functionArn, ALLOWED_SUBJECT_HASHES: subjectHash('synthetic-owner'), ALLOWED_ORIGINS: 'https://chatgpt.com' };
  assert.equal(readConfig(env).shard, 'shard3');
  for (const key of Object.keys(env)) {
    assert.throws(() => readConfig({ ...env, [key]: 'private-invalid-value' }), error => error.message === 'MCP configuration is invalid.');
  }
  assert.throws(() => readConfig({}));
});

test('successful tool logs omit telemetry and request scope', async t => {
  const logger = logs();
  const gateway = createGateway({ config, authenticate, query: async () => ({ ok: true, action: 'latest', record: { synthetic: 'synthetic-private-payload' } }), logger });
  t.after(() => gateway.close());
  await gateway.fetch(request(rpc('tools/call', { name: 'screeps_latest', arguments: { room: 'E25S47' } })));
  assert.deepEqual(logger.entries.map(JSON.parse), [{ event: 'mcp-tool-completed', tool: 'screeps_latest' }]);
});
test('gateway independently caps complete MCP serialization', async t => {
  const gateway = createGateway({ config, authenticate, query: async () => ({ ok: true, action: 'latest', record: { synthetic: 'x'.repeat(MAX_RESPONSE_BYTES) } }), logger: logs() });
  t.after(() => gateway.close());
  const response = await gateway.fetch(request(rpc('tools/call', { name: 'screeps_latest', arguments: {} })));
  assert.equal(response.status, 502);
  assert.ok((await response.text()).length < 100);
});
test('authenticated stateless GET/DELETE and unsupported methods cannot execute tools', async t => {
  const gateway = createGateway({ config, authenticate, query: async () => assert.fail('method invoked backend'), logger: logs() });
  t.after(() => gateway.close());
  for (const method of ['GET', 'DELETE', 'PUT']) {
    assert.equal((await gateway.fetch(new Request(resource, { method, headers: { authorization: `Bearer ${validToken}` } }))).status, 405);
  }
});
