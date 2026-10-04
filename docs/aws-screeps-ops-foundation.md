# AWS Screeps Ops Foundation

This branch starts the migration from the public GitHub Issue-based Screeps Ops console to a private, low-cost AWS operations plane.

## Goal

Replace the runtime dependency on GitHub issue #14 with a private serverless AWS foundation that can later support richer diagnostics and narrowly constrained remediation.

GitHub remains source control, CI, and deployment infrastructure. It should no longer be the live operations interface.

## Initial architecture

EventBridge Scheduler
→ telemetry collector Lambda
→ Screeps API
→ DynamoDB

CloudWatch provides basic operational logging with limited retention.

Use the simplest secure secret storage that fits this scale. Evaluate SSM Parameter Store SecureString versus Secrets Manager with cost as a first-class factor.

## First PR scope

1. Inspect and remove obsolete GitHub Issue #14 runtime machinery where safe.
2. Preserve and reuse trusted Screeps telemetry/query logic where practical.
3. Add infrastructure as code for the AWS foundation.
4. Add a scheduled read-only telemetry collector Lambda.
5. Store compact, versioned private telemetry in DynamoDB.
6. Use DynamoDB on-demand billing and TTL-based retention.
7. Add least-privilege IAM.
8. Keep Screeps access read-only in this PR.
9. Add concise deployment, credential setup, cost, verification, retention, security, and teardown documentation.
10. Add tests that do not require live AWS or Screeps credentials.

## Telemetry to capture

When available, persist structured fields for:

- game tick
- CPU usage, limit, and bucket
- owned rooms
- RCL and controller progress
- controller downgrade timer
- room energy
- spawn activity
- worker live/spawning/aging/effective/target counts
- creep TTLs
- extensions
- containers
- towers
- roads
- construction sites
- hostiles
- recent runtime errors

Do not store large raw API responses by default.

## Security requirements

- No Screeps credentials in source, committed environment files, DynamoDB records, logs, outputs, or public systems.
- No public unauthenticated telemetry API.
- Collector has Screeps read access only.
- Do not add generic arbitrary Screeps API execution.
- Do not add remediation/write credentials in this PR.
- Use least-privilege IAM.

## Cost requirements

Design for effectively zero or pennies per month at this scale.

Avoid:

- always-running compute
- NAT Gateways
- unnecessary VPC resources
- provisioned DynamoDB capacity
- verbose or indefinite CloudWatch logging
- unnecessary orchestration services

Document any resource that can create recurring cost.

## DynamoDB access patterns

The schema should support:

- latest colony state
- recent room history
- telemetry over a time range
- future anomaly detection

Use TTL expiration for detailed telemetry. Choose and document a sensible initial retention period.

## Out of scope

Do not add in this PR:

- autonomous remediation
- AI agents
- arbitrary Screeps writes
- dashboards
- a large API layer

## End-of-PR report

Document:

- architecture decisions
- AWS resources introduced
- security decisions
- expected cost characteristics
- tests run
- manual configuration required
- recommended next PR
