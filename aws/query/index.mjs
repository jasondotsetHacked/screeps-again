import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { createQueryHandler } from './runtime.mjs';

const client = new DynamoDBClient({ maxAttempts: 2, requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 } });
export const handler = createQueryHandler({
  tableName: process.env.TELEMETRY_TABLE,
  getItem: (input, options) => client.send(new GetItemCommand(input), options),
  query: (input, options) => client.send(new QueryCommand(input), options)
});
