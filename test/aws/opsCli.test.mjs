import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, invokeOps, operatorError } from '../../tools/aws/ops.mjs';
import { ROOM } from './queryFixtures.mjs';

test('operator CLI defaults to the production stack region and shard', () => {
  assert.deepEqual(parseArgs(['latest']), { stack: 'screeps-again-prod', region: 'us-east-1', event: { action: 'latest', shard: 'shard3' } });
});

test('operator CLI accepts scope hours and AWS configuration overrides', () => {
  const options = parseArgs(['diagnose', '--room', ROOM, '--hours', '6', '--stack', 'test-stack', '--region', 'eu-west-1', '--shard', 'shard2', '--profile', 'ops']);
  assert.deepEqual(options.event, { action: 'diagnose', room: ROOM, hours: 6, shard: 'shard2' });
  assert.equal(options.stack, 'test-stack'); assert.equal(options.region, 'eu-west-1'); assert.equal(options.profile, 'ops');
});

test('operator CLI rejects missing unknown duplicate unsafe and invalid options', () => {
  for (const args of [[], ['latest', '--hours', '6'], ['history', '--hours', 'garbage'],
    ['latest', '--table', 'secret'], ['latest', '--room'], ['latest', '--room', ROOM, '--room', ROOM],
    ['latest', '--stack', 'bad/stack'], ['latest', '--region', 'region!'], ['latest', '--profile', 'secret\n']]) assert.throws(() => parseArgs(args));
});

test('operator CLI discovers function output and invokes structured JSON without table names or files', async () => {
  let calls = 0;
  const response = await invokeOps(parseArgs(['history', '--hours', '6']), {
    describeStacks: async input => { assert.equal(input.StackName, 'screeps-again-prod'); return { Stacks: [{ Outputs: [{ OutputKey: 'TelemetryQueryFunctionName', OutputValue: 'discovered-query' }] }] }; },
    invoke: async input => { calls += 1; assert.equal(input.FunctionName, 'discovered-query'); assert.equal(input.InvocationType, 'RequestResponse');
      assert.deepEqual(JSON.parse(input.Payload.toString()), { action: 'history', shard: 'shard3', hours: 6 });
      return { Payload: Buffer.from(JSON.stringify({ ok: true, observations: [] })) }; }
  });
  assert.equal(calls, 1); assert.equal(response.ok, true);
});

test('missing stack output gives a clear deployment instruction', async () => {
  await assert.rejects(invokeOps(parseArgs(['latest']), { describeStacks: async () => ({ Stacks: [{ Outputs: [] }] }) }), /Deploy the query layer/);
});

test('Lambda execution failures and malformed responses hide raw payloads', async () => {
  for (const result of [{ FunctionError: 'Unhandled', Payload: Buffer.from('secret') }, { Payload: Buffer.from('secret') }]) {
    await assert.rejects(invokeOps(parseArgs(['latest']), {
      describeStacks: async () => ({ Stacks: [{ Outputs: [{ OutputKey: 'TelemetryQueryFunctionName', OutputValue: 'query' }] }] }),
      invoke: async () => result
    }), error => !error.message.includes('secret'));
  }
});

test('query errors use local allowlisted messages instead of server-supplied error text', async () => {
  await assert.rejects(invokeOps(parseArgs(['latest']), {
    describeStacks: async () => ({ Stacks: [{ Outputs: [{ OutputKey: 'TelemetryQueryFunctionName', OutputValue: 'query' }] }] }),
    invoke: async () => ({ Payload: Buffer.from(JSON.stringify({ ok: false, error: { code: 'NO_TELEMETRY', message: 'secret' } })) })
  }), error => /No telemetry exists/.test(error.message) && !error.message.includes('secret'));
});

test('expired SSO credentials and permission failures have safe actionable messages', () => {
  assert.match(operatorError({ name: 'CredentialsProviderError', message: 'secret' }, 'ops'), /aws sso login --profile ops/);
  assert.match(operatorError({ name: 'ExpiredTokenException', message: 'secret' }), /expired/);
  assert.match(operatorError({ name: 'AccessDeniedException', message: 'secret' }), /lambda:InvokeFunction/);
  assert.ok(!operatorError({ name: 'Error', message: 'secret' }).includes('secret'));
});
