import { LambdaClient } from '@aws-sdk/client-lambda';
import { createBackend } from './backend.mjs';
import { createAuthenticator } from './auth.mjs';
import { readConfig } from './config.mjs';
import { createGateway, createLambdaHandler } from './runtime.mjs';

const config = readConfig();
const client = new LambdaClient({ maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 17000 } });
export const handler = createLambdaHandler(createGateway({
  config, authenticate: createAuthenticator(config),
  query: createBackend({ client, functionArn: config.functionArn })
}), config);
