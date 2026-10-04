import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const template = parse(readFileSync(new URL('../../template.yaml', import.meta.url), 'utf8'), {
  customTags: ['Ref', 'Sub', 'GetAtt'].map(name => ({ tag: '!' + name, resolve: value => ({ [name]: value }) }))
});
test('IAM has exactly one invocation resource and only own log stream writes', () => {
  const policies = template.Resources.McpRole.Properties.Policies;
  assert.equal(policies.length, 1);
  const statements = policies[0].PolicyDocument.Statement;
  assert.deepEqual(statements, [
    { Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: { Ref: 'TelemetryQueryFunctionArn' } },
    { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: { GetAtt: 'McpLogGroup.Arn' } }
  ]);
  assert.equal(template.Resources.McpRole.Properties.ManagedPolicyArns, undefined);
  assert.equal(template.Parameters.TelemetryQueryFunctionArn.Default, undefined);
  assert.ok(!template.Parameters.TelemetryQueryFunctionArn.AllowedPattern.includes('*'));
});
test('MCP stack has only boundary resources, no database, secrets, collector or VPC', () => {
  assert.deepEqual(Object.values(template.Resources).map(resource => resource.Type).sort(), [
    'AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage', 'AWS::ApiGatewayV2::Integration',
    'AWS::ApiGatewayV2::Route', 'AWS::ApiGatewayV2::Route', 'AWS::Lambda::Permission',
    'AWS::Lambda::Permission', 'AWS::Logs::LogGroup', 'AWS::IAM::Role', 'AWS::Serverless::Function'
  ].sort());
  const fn = template.Resources.McpFunction.Properties;
  assert.equal(fn.Runtime, 'nodejs22.x');
  assert.deepEqual(fn.Architectures, ['arm64']);
  assert.equal(fn.MemorySize, 128);
  assert.equal(fn.Timeout, 25);
  assert.equal(fn.ReservedConcurrentExecutions, 2);
  assert.equal(fn.VpcConfig, undefined);
  assert.equal(fn.FunctionUrlConfig, undefined);
  assert.equal(template.Resources.McpLogGroup.Properties.RetentionInDays, 7);
  assert.equal(template.Parameters.AllowedSubjectHashes.NoEcho, true);
  assert.equal(template.Parameters.AllowedSubjectHashes.Default, undefined);
});
test('public routes are limited to MCP and required OAuth discovery; no access payload logs', () => {
  const routes = Object.values(template.Resources).filter(resource => resource.Type === 'AWS::ApiGatewayV2::Route');
  assert.deepEqual(routes.map(route => route.Properties.RouteKey).sort(), ['ANY /mcp', 'GET /.well-known/oauth-protected-resource/mcp']);
  assert.equal(template.Resources.McpStage.Properties.AccessLogSettings, undefined);
});
test('production imports contain no direct telemetry read/write or credential path', () => {
  const modules = ['index', 'runtime', 'backend', 'tools', 'auth', 'config'].map(name => readFileSync(new URL(`../${name}.mjs`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(modules, /client-dynamodb|GetItemCommand|QueryCommand|PutItemCommand|UpdateItemCommand|DeleteItemCommand|client-ssm|client-secrets-manager|screeps-api|child_process|eval\(/);
  assert.equal((modules.match(/new InvokeCommand/g) ?? []).length, 1);
  assert.doesNotMatch(modules, /import.*local\.mjs/);
});
