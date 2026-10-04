import { pathToFileURL } from 'node:url';
import { validateRequest } from '../../aws/query/query.mjs';

export const USAGE = 'npm run aws:ops -- <latest|history|diagnose> [--room E25S47] [--hours 6] [--shard shard3] [--stack screeps-again-prod] [--region us-east-1] [--profile name]';

export class OperatorError extends Error {}

export function parseArgs(args) {
  const [action, ...flags] = args;
  const values = {};
  for (let index = 0; index < flags.length; index += 2) {
    const name = flags[index]?.slice(2), value = flags[index + 1];
    if (!flags[index]?.startsWith('--') || !['room', 'hours', 'shard', 'stack', 'region', 'profile'].includes(name) ||
        typeof value !== 'string' || !value || value.startsWith('--') || name in values) {
      throw new Error('Invalid or repeated option. ' + USAGE);
    }
    values[name] = value;
  }
  const event = validateRequest({ action, shard: values.shard ?? 'shard3',
    ...(values.room === undefined ? {} : { room: values.room }),
    ...(values.hours === undefined ? {} : { hours: Number(values.hours) }) });
  const stack = values.stack ?? 'screeps-again-prod', region = values.region ?? 'us-east-1';
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stack)) throw new Error('Invalid stack name.');
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error('Invalid AWS region.');
  if (values.profile && (values.profile.length > 128 || /[\r\n\x00]/.test(values.profile))) throw new Error('Invalid AWS profile.');
  return { event, stack, region, ...(values.profile ? { profile: values.profile } : {}) };
}

export async function invokeOps(options, { describeStacks, invoke }) {
  const stack = await describeStacks({ StackName: options.stack });
  const name = stack.Stacks?.[0]?.Outputs?.find(output => output.OutputKey === 'TelemetryQueryFunctionName')?.OutputValue;
  if (!name) throw new OperatorError('Query function output is missing. Deploy the query layer to this stack first.');
  const result = await invoke({ FunctionName: name, InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(options.event)) });
  if (result.FunctionError) throw new OperatorError('Query Lambda execution failed; check its operational logs.');
  let response;
  try { response = JSON.parse(Buffer.from(result.Payload ?? []).toString('utf8')); }
  catch { throw new OperatorError('Query Lambda returned an invalid response.'); }
  if (response?.ok !== true) {
    const messages = {
      NO_TELEMETRY: 'No telemetry exists for this shard and scope.',
      INVALID_TELEMETRY: 'The telemetry record is invalid or unsupported.',
      INVALID_REQUEST: 'Query request was rejected.',
      CONFIGURATION_ERROR: 'Query Lambda is not configured.',
      RESPONSE_LIMIT: 'Response exceeds the limit; request a room or a shorter window.',
      READ_FAILED: 'Telemetry read failed; check query Lambda permissions or try again.'
    };
    throw new OperatorError(messages[response?.error?.code] ?? 'Query Lambda returned an unsuccessful response.');
  }
  return response;
}

export function operatorError(error, profile) {
  // Never echo arbitrary SDK messages, response bodies, resource names or credentials.
  if (['CredentialsProviderError', 'TokenProviderError', 'UnauthorizedException', 'ExpiredTokenException', 'ExpiredToken', 'InvalidClientTokenId'].includes(error?.name)) {
    return 'AWS credentials are unavailable or expired. For SSO, run aws sso login' +
      (profile ? ' --profile ' + profile : ' for your AWS profile') + ' and retry.';
  }
  if (error?.name === 'AccessDeniedException' || error?.name === 'AccessDenied') return 'AWS access denied. The caller needs cloudformation:DescribeStacks and lambda:InvokeFunction for this stack and query function.';
  return 'AWS operation failed. Check your region, stack, profile and AWS authentication.';
}

export async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  let options;
  try { options = parseArgs(args); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }
  const [{ CloudFormationClient, DescribeStacksCommand }, { LambdaClient, InvokeCommand }, { defaultProvider }] = await Promise.all([
    import('@aws-sdk/client-cloudformation'), import('@aws-sdk/client-lambda'), import('@aws-sdk/credential-provider-node')
  ]);
  const config = { region: options.region, credentials: defaultProvider({ profile: options.profile }),
    maxAttempts: 2, requestHandler: { connectionTimeout: 2000, requestTimeout: 20000 } };
  const cloudformation = new CloudFormationClient(config), lambda = new LambdaClient(config);
  try {
    const result = await invokeOps(options, {
      describeStacks: input => cloudformation.send(new DescribeStacksCommand(input)),
      invoke: input => lambda.send(new InvokeCommand(input))
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof OperatorError ? error.message : operatorError(error, options.profile));
    process.exitCode = 1;
  } finally { cloudformation.destroy(); lambda.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
