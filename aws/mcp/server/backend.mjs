import { InvokeCommand } from '@aws-sdk/client-lambda';
import { BackendError } from './tools.mjs';

export const MAX_BACKEND_BYTES = 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// One AWS operation, one deployment-configured target; never forward caller-selected identifiers.
export function createBackend({ client, functionArn }) {
  return async event => {
    let response;
    try {
      response = await client.send(new InvokeCommand({
        FunctionName: functionArn, InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(event))
      }), { abortSignal: AbortSignal.timeout(17000) });
    } catch {
      throw new BackendError('UNAVAILABLE');
    }
    if (response.StatusCode !== 200 || response.FunctionError || !response.Payload ||
        response.Payload.byteLength > MAX_BACKEND_BYTES) throw new BackendError('UNAVAILABLE');
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.Payload)); }
    catch { throw new BackendError('UNAVAILABLE'); }
    if (!object(result) || typeof result.ok !== 'boolean') throw new BackendError('UNAVAILABLE');
    if (!result.ok) throw new BackendError(object(result.error) ? result.error.code : 'UNAVAILABLE');
    if (result.action !== event.action ||
        (event.action === 'latest' && !object(result.record)) ||
        (event.action === 'history' && !Array.isArray(result.observations)) ||
        (event.action === 'diagnose' && !object(result.diagnostics))) throw new BackendError('UNAVAILABLE');
    // Preserve the query Lambda's bounded schema and diagnostics without interpretation.
    return result;
  };
}
