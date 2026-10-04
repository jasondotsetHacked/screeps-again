export function readConfig(env = process.env) {
  const resource = env.MCP_RESOURCE_URL;
  const issuer = env.OAUTH_ISSUER;
  const hashes = env.ALLOWED_SUBJECT_HASHES?.split(',').map(value => value.trim()) ?? [];
  const origins = env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  const httpsUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  if (!httpsUrl(resource) || new URL(resource).pathname !== '/mcp' ||
      !httpsUrl(issuer) || new URL(issuer).pathname !== '/' ||
      !issuer.endsWith('/') || !/^shard(?:0|[1-9]\d{0,2}|X)$/.test(env.SCREEPS_SHARD ?? '') ||
      !/^arn:aws(?:-us-gov|-cn)?:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/.test(env.QUERY_FUNCTION_ARN ?? '') ||
      !hashes.length || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) ||
      origins.some(origin => !httpsUrl(origin) || new URL(origin).origin !== origin)) {
    throw new Error('MCP configuration is invalid.');
  }
  return { resource, issuer, shard: env.SCREEPS_SHARD, functionArn: env.QUERY_FUNCTION_ARN,
    allowedSubjectHashes: hashes, origins,
    metadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', resource).href };
}
