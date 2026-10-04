import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const READ_SCOPE = 'telemetry:read';
export const subjectHash = subject => createHash('sha256').update(subject).digest('hex');
export class AccessError extends Error {
  constructor(status) { super('Access denied.'); this.status = status; }
}

export function createAuthenticator({ issuer, resource, allowedSubjectHashes, jwks }) {
  const keys = jwks ?? createRemoteJWKSet(new URL('.well-known/jwks.json', issuer), {
    timeoutDuration: 3000, cooldownDuration: 30000, cacheMaxAge: 600000
  });
  const allowlist = new Set(allowedSubjectHashes);
  return async request => {
    const header = request.headers.get('authorization');
    if (!header || header.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(header)) throw new AccessError(401);
    let payload;
    try {
      ({ payload } = await jwtVerify(header.slice(7), keys, {
        algorithms: ['RS256'], issuer, audience: resource,
        requiredClaims: ['exp', 'iat', 'sub'], clockTolerance: 0
      }));
    } catch { throw new AccessError(401); }
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.scope !== 'string' ||
        !payload.scope.split(' ').includes(READ_SCOPE)) throw new AccessError(403);
    if (!allowlist.has(subjectHash(payload.sub))) throw new AccessError(403);
  };
}

export function challenge(config, status) {
  const error = status === 401 ? 'invalid_token' : 'insufficient_scope';
  return `Bearer resource_metadata="${config.metadataUrl}", scope="${READ_SCOPE}", error="${error}"`;
}
