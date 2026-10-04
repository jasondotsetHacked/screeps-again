# Private Screeps MCP gateway

This gateway is **READ ONLY**. It exposes exactly three private telemetry tools to authenticated, authorized MCP clients. This PR implements the boundary for independent review; nothing has been deployed. Do not run the deployment section until a separate deployment is authorized.

## Architecture and capability boundary

```text
ChatGPT / Codex -- HTTPS + OAuth bearer token --> HTTP API /mcp
                                                   |
                                              MCP Lambda
                                                   | lambda:InvokeFunction (one exact ARN)
                                     existing private telemetry query Lambda
                                                   | GetItem / Query
                                            existing telemetry history
```

The separate stack is `screeps-again-mcp`, in `us-east-1`. `screeps-again-prod` retains all collector/query/database resources and permissions. The query Lambda stays private. No telemetry template changes or live stack changes are required.

The gateway validates tool arguments, injects the configured shard, synchronously invokes the existing query Lambda, checks the returned envelope/byte limit, and returns its result unchanged as MCP structured content and JSON text. It does not derive database keys, read DynamoDB, project telemetry, calculate diagnostics, cache results, store queries, call Screeps, run an LLM, or offer remediation.

An IAM role explicitly permits only:

- `lambda:InvokeFunction` on `TelemetryQueryFunctionArn` (one exact deployment parameter, no wildcard).
- `logs:CreateLogStream` and `logs:PutLogEvents` on the gateway's own log group/streams.

It has no managed policies and no `logs:CreateLogGroup`, DynamoDB, SSM, Secrets Manager, collector, console, or other AWS permissions. API Gateway has separate resource policies allowing it to invoke only the gateway routes. An operator supplying the ARN must verify that it is the intended query function, rather than another Lambda. IAM cannot infer a function's behavior from its ARN.

## Protocol and tools

Requirements were checked against current official guidance on 2026-10-04:

- [MCP July 2026 Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
- [Official TypeScript SDK HTTP serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md) and [legacy compatibility](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md).
- [OpenAI remote MCP authentication guidance](https://developers.openai.com/plugins/build/auth) and [Codex MCP support](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

The official `@modelcontextprotocol/server` 2.3.0 SDK implements stateless **Streamable HTTP** at `/mcp`, including 2026-07-28 discovery and 2025-era initialization. Each request builds a fresh server. Modern calls return JSON; legacy calls can return a finite SSE response buffered by Lambda. There are no persistent SSE connections, sessions, resumability, subscriptions, or unsolicited notifications. The SDK rejects subscription requests (`maxSubscriptions: 0`). HTTP GET/DELETE session operations return 405 in stateless mode. JSON-RPC parsing, discovery, method dispatch, schema validation, and compatibility are SDK-owned.

| Tool | Optional input | Constructed query event |
| --- | --- | --- |
| `screeps_latest` | `room` | `{ action: "latest", shard, ...room }` |
| `screeps_history` | `room`, `hours` | `{ action: "history", shard, ...room, ...hours }` |
| `screeps_diagnose` | `room`, `hours` | `{ action: "diagnose", shard, ...room, ...hours }` |

`room` must match `^[WE]\d+[NS]\d+$` and be at most 20 characters. `hours` must be a finite number greater than zero and at most 24; fractional hours are accepted. Omitted hours are left to the existing query Lambda's six-hour default. Extra properties, shard input, null values, arbitrary actions, resource identifiers, and JSON passthrough are rejected. Deployment defaults `ScreepsShard` to `shard3`.

All tools carry `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`, plus top-level `securitySchemes` for OAuth scope `telemetry:read`, mirrored under `_meta.securitySchemes` for backward compatibility as required by the [OpenAI tool descriptor reference](https://developers.openai.com/plugins/reference). A small `tools/list` adapter preserves these top-level extensions, which SDK 2.3.0 otherwise filters out. Diagnostic descriptions explicitly avoid causal claims.

Requests are bounded to 16 KiB. The backend payload must fit the existing query's 1 MiB ceiling. The complete MCP response is independently capped at 2.25 MiB, including duplicated text/structured serialization; unusually escape-heavy results may require a room or shorter window. Query errors are mapped through a small safe message allowlist. Raw SDK exceptions, invocation failures, malformed payloads, and unknown backend categories become a generic temporary-unavailability error. The adapter never forwards backend failure messages. Operational logs contain only fixed event names, an allowlisted tool name, and denial status; no identities, rooms, tokens, headers, telemetry, payloads, or exception strings. API access logging is disabled. Metadata and successful MCP replies use `Cache-Control: no-store`.

## Managed OAuth and private authorization

**Selected provider: Auth0 Auth for MCP**, external to the AWS stack. Auth0 owns authorization-code flow, S256 PKCE, login, consent, refresh, client registration, and discovery. This code is only an OAuth resource server. It has no OAuth client secret, password database, token-issuing endpoint, or custom authorization server.

Cognito was evaluated first. Its [authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html) supports S256 and its [resource binding](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html) supports audience-bound access tokens. Those capabilities alone do not establish the entire required discovery/client-registration contract. We did not establish Cognito's native MCP-compatible discovery advertising S256 and CIMD/DCR; we chose Auth0's [documented MCP support](https://auth0.com/ai/docs/mcp/overview) rather than adding a discovery/registration proxy. This is a compatibility decision, not a claim that Cognito cannot ever be integrated.

Configure a dedicated Auth0 API with identifier equal to the **exact** `McpEndpoint` URL, RS256 access-token signing, and permission `telemetry:read`. Enable the [Resource Parameter Compatibility Profile](https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/) in tenant settings so the RFC 8707 `resource` parameter becomes the intended token audience. Enable Auth for MCP client identification/discovery using approved CIMD clients where supported; a pre-registered public PKCE client or DCR is acceptable when required by the client. Restrict registration and API access to intended clients. Do not enable unrestricted registration merely to troubleshoot. Copy actual client metadata/callback URLs from the connecting client's management interface; never assume a universal callback.

Before connecting, inspect the tenant's real `/.well-known/oauth-authorization-server` or `/.well-known/openid-configuration`. Verify its exact issuer, HTTPS authorization/token endpoints, `code_challenge_methods_supported` containing `S256`, advertised token endpoint auth methods, and selected client-identification mechanism. Configure public clients for authorization code + mandatory S256 PKCE and no implicit/password/client-credentials grants. Verify authorize/token requests with `resource=<exact McpEndpoint>` produce an RS256 access token whose `aud` includes that endpoint and whose scope includes `telemetry:read`. Use short access-token lifetimes. RFC 9207 stable callbacks apply only if the provider advertises issuer identification and returns matching `iss` on success and error callbacks; otherwise use the callback-specific URL shown by ChatGPT. Do not fabricate discovery fields to make a client accept an incompatible tenant.

The only anonymously accessible route is required RFC 9728 resource metadata at `/.well-known/oauth-protected-resource/mcp`. It advertises the exact resource, authorization issuer, and read scope. Every `/mcp` request requires a bearer token in its header. Missing/invalid tokens receive 401 plus a `WWW-Authenticate` metadata challenge. Tokens must pass signature, RS256 algorithm, exact issuer, resource audience, expiry, not-before, required issuance/subject claims, and read-scope checks. Wrong scope or subject receives 403. ID tokens without the API audience/scope are rejected.

Authentication alone grants no colony access. Supply SHA256 hashes of intended Auth0 `sub` values as `AllowedSubjectHashes` (`NoEcho`, required with no permissive default). The gateway hashes the verified subject and performs an exact allowlist check on **every request**, including listing/discovery through MCP. Email/profile claims are not used. Subject hashes are pseudonymous configuration, not passwords or substitutes for JWT validation; protect their configuration. All authorized subjects see the same colony. Do not commit subject values, subject hashes, personal emails, client secrets, tokens, or deployment configuration. Keep local sensitive configuration in ignored `.env` files or approved CI secrets. Configure the provider to deny unrelated accounts as a second boundary; even a valid unrelated provider token fails the gateway allowlist.

Only the configured issuer's HTTPS JWKS endpoint is fetched; token-supplied key URLs are not followed. Public signing keys are cached for rotation with bounded network timeout. Removing a subject hash takes effect after a Lambda configuration update; provider revocation alone may not invalidate an already issued JWT before its expiry. Removing a client connection/revoking refresh tokens plus short token lifetimes limits that window.

Host and Origin checks guard the MCP route. Production accepts only its configured endpoint host and exact deployment-configured browser origins (`https://chatgpt.com` default). Clients without an Origin header are accepted subject to OAuth. There is no broad CORS policy or query-string authentication. API Gateway must invoke the handler using the included v2 integration; do not add an alternate unauthenticated function URL.

## Local development and credential-free checks

From repository root, on Node.js 22+:

```bash
npm ci
npm run mcp:install
npm run check
npm run mcp:validate
npm run mcp:build
git diff --check
```

On PowerShell systems that block `npm.ps1`, use `npm.cmd` for these commands. MCP dependencies and their lockfile are isolated under `aws/mcp/server`; root/in-game dependencies are unchanged. CI installs both lockfiles and runs these checks without AWS or ChatGPT credentials. Tests use synthetic data and ephemeral locally generated signing keys, including real SDK clients for both protocol generations and real JWT signature checks.

For a synthetic tool/transport preview:

```bash
npm run mcp:local
npx @modelcontextprotocol/inspector
```

In Inspector select Streamable HTTP, URL `http://127.0.0.1:3000/mcp`, and no authentication. List/call all three tools, try invalid arguments, and verify there are no write tools. This dedicated entry binds only loopback, has no AWS adapter, and returns empty/synthetic data. Its intentional local authentication bypass is never imported by Lambda. It does **not** verify OAuth or production connectivity. Do not expose this preview through a tunnel or publish it. Local config can be loaded from the repository's ignored `.env`; no credentials are needed for the synthetic preview.

After a separately authorized deployment, use [Inspector's Auth settings](https://auth0.com/ai/docs/mcp/guides/test-your-mcp-server-with-mcp-inspector) with the HTTPS endpoint and configured Auth0 tenant to inspect actual metadata, PKCE, resource binding, access token claims, and refresh behavior. Do not paste tokens into terminal arguments, issues, or logs. Verify absent credentials get 401; unrelated identities and wrong scopes get 403; intended identities can list exactly three tools and read telemetry. These live integration steps remain unperformed in this PR.

## Later deployment, after independent review

These commands describe a **future** operation; they were not executed for this PR. Use existing operator AWS SSO/profile credentials. The gateway runtime never needs CloudFormation listing, STS, or `lambda:GetFunction` permissions.

Resolve the existing cross-stack contract without changing `screeps-again-prod` (Bash example):

```bash
query_name=$(aws cloudformation describe-stacks --stack-name screeps-again-prod --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='TelemetryQueryFunctionName'].OutputValue | [0]" --output text)
query_arn=$(aws lambda get-function --function-name "$query_name" --region us-east-1 \
  --query 'Configuration.FunctionArn' --output text)
```

Stop if either result is missing, `None`, unexpected, or not the intended telemetry query function. The operator's read-only metadata permission supplies `TelemetryQueryFunctionArn`. There is no hard-coded physical name, runtime discovery, CloudFormation export/import dependency, or deletion coupling. If the query function is replaced later, explicitly refresh this parameter. Do not supply the collector ARN.

Load `OAUTH_ISSUER` and `ALLOWED_SUBJECT_HASHES` from local ignored `.env` configuration into the operator environment; use tenant-admin tooling privately to hash the intended subjects. Do not print those subjects or store `samconfig.toml` with private values. Then, when deployment is authorized:

```bash
npm run mcp:build
sam deploy --template-file .aws-sam/mcp-build/template.yaml \
  --stack-name screeps-again-mcp --region us-east-1 --capabilities CAPABILITY_IAM \
  --resolve-s3 --confirm-changeset \
  --parameter-overrides "TelemetryQueryFunctionArn=$query_arn" "ScreepsShard=shard3" \
    "OAuthIssuer=$OAUTH_ISSUER" "AllowedSubjectHashes=$ALLOWED_SUBJECT_HASHES"
```

No `--guided` config saving is required. Review the changeset: it must affect **only the MCP stack**. The endpoint is not known until creation; initially the gateway rejects any token not bound to that newly generated URL. Read the `McpEndpoint` output, finish the Auth0 API identifier/client setup described above, and verify discovery before use. Keep the existing telemetry stack untouched.

The ten declared stack resources are: HTTP API, default throttled stage, Lambda integration, two routes, two route-scoped Lambda invoke permissions, MCP Lambda, explicit IAM role, and seven-day log group. The function is Node.js 22, ARM64, 128 MB, 25-second timeout, reserved concurrency two, no VPC. The backend invocation deadline is 17 seconds to accommodate the existing query's 15-second Lambda timeout; JWKS fetches have a three-second deadline. There is no retry amplification (`maxAttempts: 1`). Route throttling is two requests/second with burst five; AWS throttles are best effort, not a hard spending cap.

## ChatGPT and Codex connections

After deployment/OAuth verification, [add a private MCP connection in ChatGPT developer mode](https://developers.openai.com/plugins/quickstart). Supply the HTTPS `McpEndpoint`, select OAuth, copy the exact redirect/client metadata identifiers shown by the connection UI to Auth0, authenticate as an allowlisted identity, and verify all three tools. Keep the connection personal or restricted to the intended workspace members. Do not publish it in a public plugin directory. Developer mode and connection controls vary by plan/workspace.

For a [Codex host supporting remote OAuth](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), add a private entry to your **local** Codex configuration:

```toml
[mcp_servers.screeps_private]
url = "https://YOUR_MCP_API_HOST/mcp"
```

Run `codex mcp login screeps_private` and authorize the intended identity. Codex supports CIMD/DCR and predefined clients; if a tenant requires a pre-registered client, use `codex mcp add screeps_private --url <McpEndpoint> --oauth-client-id <public-client-id>` and register the exact callback shown by Codex. No bearer token, static API key, or OAuth secret goes in the TOML or prompts. The desktop app/IDE can use their MCP settings and Authenticate controls instead. Verify the connection lists only `screeps_latest`, `screeps_history`, and `screeps_diagnose`.

## Teardown, cost, and limitations

For a later authorized teardown, remove client connections/revoke provider grants, delete only `screeps-again-mcp` (`aws cloudformation delete-stack --stack-name screeps-again-mcp --region us-east-1`), and remove its dedicated Auth0 API/clients if no longer used. The telemetry stack and history remain independent.

AWS idle compute cost is near zero: Lambda and HTTP API are request-driven, reserved concurrency does not reserve paid running instances, and there is no NAT, VPC endpoint, ALB, ECS, EC2, provisioned concurrency, or custom domain. Seven-day log storage and any SAM packaging S3 artifacts can have small storage charges. Invocations also incur the existing query Lambda/DynamoDB read charges. Auth0 is external and plan-dependent; confirm [current Auth0 pricing](https://auth0.com/pricing) and tenant feature entitlement before deployment. Internet traffic, including rejected requests, can incur AWS invocation charges; throttling bounds normal use but is not a billing guarantee.

Known limits: one configured shard/colony, no user-specific data partitioning, no caching, no writes, no live AWS/ChatGPT acceptance test yet, no continuous streams or resumability, and provider/client setup required before connection. The gateway inherits telemetry freshness, sampling gaps, bounded 24-hour windows, result truncation, and causal restraint from the query Lambda. 128 MB and the 25-second budget need observation during the first authorized deployment; cold starts, JWKS rotation/outages, backend concurrency-one throttling, and client timeouts may produce safe temporary failures. Verify tenant discovery and OAuth resource behavior with Inspector before calling the integration production-ready.
