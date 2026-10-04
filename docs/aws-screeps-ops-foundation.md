# AWS Screeps Ops

This replaces the public GitHub issue ops console with a private, serverless AWS telemetry plane.

## Architecture

EventBridge Scheduler runs every 15 minutes by default:

```text
EventBridge Scheduler
  -> Lambda telemetry collector
     -> GET Screeps Memory.ops
     -> DynamoDB
```

The in-game runtime remains the source of the compact `Memory.ops` snapshot. The collector does not evaluate arbitrary console code and does not call a Screeps write endpoint.

AWS resources are defined in `aws/template.yaml` with AWS SAM.

## Resources and cost controls

The stack creates:

- one 128 MB ARM64 Lambda with reserved concurrency 1;
- one EventBridge Scheduler schedule;
- one DynamoDB table using on-demand billing;
- one CloudWatch log group with 7-day retention;
- the minimum IAM permissions needed to read one SSM parameter and batch-write the telemetry table.

It deliberately does **not** create a VPC, NAT Gateway, API Gateway, load balancer, always-running compute, provisioned DynamoDB capacity, or public telemetry endpoint.

Detailed snapshots expire after 30 days by default. `LATEST` records do not expire. At this colony's scale, the design is intended to stay in free-tier/pennies territory, but AWS pricing and account free-tier eligibility vary. Check AWS Billing after deployment and keep a normal account budget alert enabled.

## Secret storage

The Screeps token is an existing SSM Parameter Store **SecureString**. The CloudFormation stack receives only the parameter name. The secret value never becomes a CloudFormation parameter, template value, DynamoDB record, or log field.

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

Requirements:

- AWS CLI authenticated to the target account;
- AWS SAM CLI;
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
  --key '{"pk":{"S":"COLONY#shard3"},"sk":{"S":"LATEST"}}'
```

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

After the AWS deployment is verified, the old GitHub `SCREEPS_API_TOKEN` Actions secret can be removed if no other workflow uses it.

## Next phase

A later PR can add private read/query tools and anomaly detection over DynamoDB history.

Write/remediation support should come after that. It should use separate IAM and Screeps credentials plus an explicit action allowlist. Do not give an agent arbitrary Screeps API or arbitrary console execution.
