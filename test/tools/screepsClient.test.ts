import assert from 'node:assert/strict';
import test from 'node:test';
import { withScreepsRetry } from '../../tools/lib/screepsClient';

test('retries HTTP 429 and returns the eventual result', async () => {
  let attempts = 0;
  const messages: string[] = [];

  const result = await withScreepsRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw { response: { status: 429 } };
      }
      return 'ok';
    },
    'test operation',
    (message) => messages.push(message),
    3
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.equal(messages.length, 2);
});

test('does not retry non-429 failures', async () => {
  let attempts = 0;

  await assert.rejects(
    withScreepsRetry(
      async () => {
        attempts += 1;
        throw { response: { status: 500 } };
      },
      'test operation',
      undefined,
      3
    )
  );

  assert.equal(attempts, 1);
});
