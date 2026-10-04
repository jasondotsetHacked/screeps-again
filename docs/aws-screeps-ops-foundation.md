# AWS Screeps Ops

This replaces the public GitHub issue ops console with a private, serverless AWS telemetry plane.

## Architecture

EventBridge Scheduler runs every 15 minutes by default:

```text
EventBridge Scheduler
  -> Lambda telemetry collector
     -> GET Screeps Memory.ops
     -> DynamoDB

Authenticated AWS caller / local operator CLI
  -> private TelemetryQueryFunction
     -> DynamoDB GetItem / Query
     -> bounded JSON facts, trends and signals
```

The in-game runtime remains the source of the compact `Memory.ops` snapshot. The collector does not evaluate arbitrary console code and does not call a Screeps write endpoint.

AWS resources are defined in `aws/template.yaml` with AWS SAM.

## Resources and cost controls

The stack creates:

- one 128 MB ARM64 collector Lambda with reserved concurrency 1 and a 30-second timeout;
- one on-demand 128 MB ARM64 query Lambda with reserved concurrency 1 and a 15-second timeout;
- one EventBridge Scheduler schedule;
- one DynamoDB table using on-demand billing;
- two CloudWatch log groups with 7-day retention;
- the minimum IAM permissions needed to read one SSM parameter and batch-write the telemetry table.

It deliberately does **not** create a VPC, NAT Gateway, API Gateway, load balancer, always-running compute, provisioned DynamoDB capacity, or public telemetry endpoint.

Detailed snapshots expire after 30 days by default. `LATEST` records do not expire. At this colony's scale, the design is intended to stay in free-tier/pennies territory, but AWS pricing and account free-tier eligibility vary. Check AWS Billing after deployment and keep a normal account budget alert enabled.

## Secret storage

The Screeps token is an existing SSM Parameter Store **SecureString**. The CloudFormation stack receives only the parameter name. The secret value never becomes a CloudFormation parameter, template value, DynamoDB record, or log field.

The collector fetches and decrypts the parameter on every invocation. Updating the parameter takes effect on the next invocation, including in a warm Lambda execution environment.

The default parameter name is:

```text
/screeps-again/prod/screeps-api-token
```

Use a Screeps token intended for telemetry access. This collector only performs:

```text
GET https://screeps.com/api/user/memory?path=ops&shard=<shard>
```

Future write/remediation access must use a separate capability boundary and should not reuse this collector.

For the simplest deployment, use the default AWS-managed SSM encryption key. A customer-managed KMS key needs additional `kms:Decrypt` IAM permission, which this first stack intentionally does not grant.

## First deployment

The collector migration in PR #22 is already deployed and verified in `screeps-again-prod`, region `us-east-1`. This section records initial setup; an existing stack does not need a new Screeps token for the query layer. See the query deployment steps below for the additive stack update.

Requirements:

- AWS CLI authenticated to the target account;
- a current AWS SAM CLI with Node.js 22 runtime support;
- Node.js 22 for local repository checks.

Create the SecureString outside CloudFormation:

```bash
export SCREEPS_API_TOKEN='replace-me'
aws ssm put-parameter \
  --name /screeps-again/prod/screeps-api-token \
  --type SecureString \
  --value "$SCREEPS_API_TOKEN" \
  --overwrite
unset SCREEPS_API_TOKEN
```

Validate and build:

```bash
npm run check
npm run aws:validate
npm run aws:build
```

Deploy:

```bash
sam deploy \
  --guided \
  --template-file .aws-sam/build/template.yaml \
  --capabilities CAPABILITY_IAM
```

The defaults are `shard3`, a 15-minute collection interval, and 30-day detailed retention. SAM will let you override them during the guided deployment.

## Data model

The DynamoDB primary key is `pk` + `sk`.

Colony access patterns:

```text
pk=COLONY#shard3  sk=LATEST
pk=COLONY#shard3  sk=SNAPSHOT#<ISO timestamp>
```

Room access patterns:

```text
pk=ROOM#shard3#E25S47  sk=LATEST
pk=ROOM#shard3#E25S47  sk=SNAPSHOT#<ISO timestamp>
```

History records have an `expiresAt` DynamoDB TTL. Latest records do not.

Stored telemetry includes the fields already published by `Memory.ops`: tick, CPU/bucket, RCL/controller progress and downgrade timer, room energy, spawn state, worker population, creep TTLs, infrastructure progress, construction sites, hostiles, labor state, safety state, and recent runtime errors.

The collector normalizes those fields before storage. It does not persist the raw Screeps API response.

## Verify collection

After deployment, get the stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name <stack-name> \
  --query 'Stacks[0].Outputs'
```

You can invoke the collector once without waiting for the schedule:

```bash
aws lambda invoke \
  --function-name <TelemetryCollectorFunctionName> \
  /tmp/screeps-collector.json
cat /tmp/screeps-collector.json
```

Then read the private latest record:

```bash
aws dynamodb get-item \
  --table-name <TelemetryTableName> \
  --consistent-read \
  --key '{"pk":{"S":"COLONY#shard3"},"sk":{"S":"LATEST"}}'
```

Confirm the invocation has no `FunctionError`, its response reports a collected tick, and the `LATEST` item contains that tick and a current `collectedAt` timestamp. Use the deployed shard in the key if you changed the default. Complete this verification before merging the PR.

CloudWatch logs contain only collection metadata or a short error message. The collector never intentionally logs the token, request headers, or raw Screeps response.

## Tear down

Delete the stack:

```bash
sam delete --stack-name <stack-name>
```

The SSM token is intentionally outside the stack. Remove it separately if it is no longer needed:

```bash
aws ssm delete-parameter --name /screeps-again/prod/screeps-api-token
```

## GitHub migration

`.github/workflows/screeps-ops.yml` and the public `/screeps` issue-command bridge are removed by this migration. Issue #14 can remain as historical information, but it is no longer a runtime dependency.

The completed PR #22 handoff used this order:

1. Validate, build, and deploy the AWS stack from this PR branch.
2. Invoke the collector and verify the DynamoDB colony `LATEST` record as described above.
3. Merge the PR to retire the GitHub ops workflow and Issue #14's live updates.

After the AWS deployment is verified, the old GitHub `SCREEPS_API_TOKEN` Actions secret can be removed if no other workflow uses it.

## Private read-only query capability

`TelemetryQueryFunction` is invoked synchronously through authenticated AWS Lambda invocation. It has no public endpoint, scheduled event, VPC, Function URL or API Gateway. It reads the existing collector schema (version 1); it never contacts Screeps or writes to the telemetry table. The collector's permissions and code are unchanged.

The query execution role has exactly these permissions:

| Actions | Resource |
| --- | --- |
| `dynamodb:GetItem`, `dynamodb:Query` | The existing `TelemetryTable` ARN |
| `logs:CreateLogStream`, `logs:PutLogEvents` | The pre-created query log group and its streams |

Its trust policy permits `sts:AssumeRole` only for `lambda.amazonaws.com`. There are no table writes, Scan, SSM permissions or Screeps credentials in this capability. No Lambda resource policy is added; callers need their own AWS `lambda:InvokeFunction` permission on this function. The local CLI also needs `cloudformation:DescribeStacks` for the selected stack. Scope both permissions to the intended resources.

The runtime is Node.js 22 / ARM64, 128 MB, a 15-second timeout, concurrency 1, and 7-day log retention. DynamoDB reads share a 10-second abort deadline, with at most two SDK attempts per read. There is no idle compute execution. Like the collector, it uses the SDK v3 clients included in the Lambda runtime; see [AWS runtime documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html#nodejs-sdk-included).

### Event contract

```json
{ "action": "latest", "shard": "shard3", "room": "E25S47" }
```

```json
{ "action": "history", "shard": "shard3", "hours": 6 }
```

```json
{ "action": "diagnose", "shard": "shard3", "room": "E25S47", "hours": 6 }
```

`action` is required. `shard` defaults to `shard3`; `room` is optional, selecting a colony partition when omitted. `hours` defaults to 6 for history/diagnose and is rejected for latest. Shards must be `shard0` through `shard999` or `shardX`. Room syntax matches `shared/world/rooms.ts`, with a 20-character input limit; parity tests keep the standalone JavaScript validator compatible with the TypeScript parser.

Unknown event fields are rejected, including keys, table names, expressions and pagination tokens. Every storage key and time bound is derived inside the function.

| Action | Response |
| --- | --- |
| `latest` | `ok`, `action`, and `record`: a current allowlisted normalized colony or room record, including creep details |
| `history` | Scope, requested window, coverage, completeness metadata, and chronological compact `observations` |
| `diagnose` | The same coverage metadata plus `diagnostics.facts`, `diagnostics.trends`, and `diagnostics.signals` |

Responses contain no table names, resource names or DynamoDB AttributeValue encoding. Compact history retains the existing room, CPU, labor, infrastructure, safety and error field names; it replaces per-creep details with `creepCount`. Missing numeric metrics remain `null` and are excluded from calculations rather than interpreted as zero.

Failures return `{ "ok": false, "error": { "code": "NO_TELEMETRY", "message": "..." } }`. Expected codes are `INVALID_REQUEST`, `NO_TELEMETRY`, `INVALID_TELEMETRY`, `CONFIGURATION_ERROR`, `READ_FAILED`, and `RESPONSE_LIMIT`. This application failure envelope is distinct from AWS Lambda's `FunctionError`; the CLI handles both and exits unsuccessfully. Empty history is a successful response with zero samples and null coverage.

### Bounds and interpretation

- Time windows are greater than zero and at most **24 hours**, ending at server time.
- At most **100 rows** are read, including malformed rows; at most **8 internal Query pages** are requested.
- Queries read newest snapshots first, then return the selected observations in chronological order. `truncated: true` means the requested window is incomplete because a read/page cap was reached.
- Malformed or unsupported rows are skipped and counted in `invalidRows`; duplicate timestamps are counted separately. No cursor is returned. Use a shorter window when coverage is incomplete.
- At most **32 distinct rooms** are analyzed, with at most 1,000 creep records per stored observation. Output is capped at **1 MiB**; larger responses fail clearly and suggest a room or shorter window.
- All actions use strongly consistent reads. Separate pages are not an atomic snapshot of the table. AWS documents [Query ordering, limits and pagination](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html).

Facts include observed RCL/construction/infrastructure changes, spawn activity, population deficits, labor emergency, hostiles, separate safety request/attempt/accept counts, and unique runtime errors. Trends include comparable controller progress and rates, downgrade timer, energy, CPU and bucket summaries, and labor worker activity. Signals identify population deficits, unmet minimum work, unsatisfied desired work in at least three consecutive returned samples, flat controller progress across at least four advancing-tick samples, labor emergencies, hostiles and runtime errors.

Signals describe sampled observations. They do not prove uninterrupted conditions between samples or attribute one metric's change to another. Worker percentages use only samples with known effective/target values. Missing room or metric observations break consecutive runs. Controller deltas/rates cover only adjacent comparable same-RCL samples with advancing ticks and nonnegative progress; RCL transitions, tick/progress resets and missing observations are excluded and counted. They are not a total cross-RCL progress estimate. Bucket direction compares the first and last known values.

Runtime errors are deduplicated by tick/scope/subject/message; at most 50 unique error details are returned, with an explicit truncation flag and total observed unique count. Room errors retain the collector's existing subject-based filtering. CPU/bucket values remain colony-wide even in a room query. Safety acceptance records an accepted intent and does not prove the game applied protection. At a 15-minute cadence, brief hostiles, safe-mode actions, population changes and errors may be missed, and `LATEST` may be stale; inspect `collectedAt`. Thirty-day stored retention does not imply a 30-day query window. There is no blocking telemetry gap requiring changes to `Memory.ops` in this v1.

### Local operator CLI

Install repository dependencies with `npm ci`. The CLI uses the [AWS SDK default credential chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), including existing profiles and AWS SSO, and creates no credential or temporary payload files. It discovers `TelemetryQueryFunctionName` through the CloudFormation stack outputs; it never queries DynamoDB directly or needs its physical table name.

```bash
npm run aws:ops -- latest
npm run aws:ops -- latest --room E25S47
npm run aws:ops -- history --hours 6
npm run aws:ops -- history --room E25S47 --hours 6
npm run aws:ops -- diagnose --hours 6
npm run aws:ops -- diagnose --room E25S47 --hours 6
```

Defaults are stack `screeps-again-prod`, region `us-east-1`, shard `shard3`. Overrides:

```bash
npm run aws:ops -- diagnose --hours 6 --stack test-stack --region us-west-2 --shard shard2 --profile ops
npm run aws:ops -- --help
```

The CLI prints readable JSON and exits with a nonzero status on failure. Expired/missing AWS credentials produce a generic authentication message suggesting `aws sso login --profile <profile>`. SDK failure bodies and raw Lambda errors are never printed. No AWS configuration is written by this helper.

### Deploy and verify the query layer after review

These are operator steps for a later authorized deployment; creating the draft query PR does not deploy or change production.

```bash
npm run check
npm run aws:validate
npm run aws:build
sam deploy --guided --stack-name screeps-again-prod --region us-east-1 --template-file .aws-sam/build/template.yaml --capabilities CAPABILITY_IAM
```

Use the existing stack and preserve its current shard, token parameter, collection schedule and retention parameter values in the guided prompts. This adds the query role, log group, function and output to the existing table. No generated physical table/function name is needed by tooling.

After that deployment, use the six CLI commands above. Verify latest shows the expected shard, room and recent `collectedAt`; history is chronological with valid coverage and completeness metadata; diagnostics has facts, trends and signals. These invoke only the query Lambda. A failed caller authentication should produce the safe local error described above. CI runs only local mocked reads and never needs live AWS access.

Logs contain only bounded action/shard/room/hour metadata, sample counts and generic failure categories. Query payloads, stored rows, runtime error details and AWS error bodies are not intentionally logged.

## Next phase

A later PR can expand private diagnostics using the observed history and add carefully scoped client integrations.

Write/remediation support should come after that. It should use separate IAM and Screeps credentials plus an explicit action allowlist. Do not give an agent arbitrary Screeps API or arbitrary console execution.
