# Agent guidelines

## Goal

Build an autonomous Screeps: World bot with strong world intelligence, planning, forecasting, and recovery behavior.

## Design rules

- Keep `src/main.ts` thin.
- Prefer pure TypeScript planning functions over direct mutation of Screeps globals.
- Colonies decide what work is needed; creeps execute work.
- Recovery from population loss and low-energy states is a core requirement.
- Persist only information that must survive ticks. Recompute cheap runtime state.
- Make decisions explainable through logs, metrics, or visuals.
- Build the smallest playable vertical slice before advanced RCL systems.
- External world-analysis tools belong in `tools/` and must not consume Screeps CPU.

## Security

- Never commit Screeps API tokens, passwords, session cookies, or generated credential files.
- Read local credentials from `.env` or CI secrets only.
- Do not add a fallback that accepts account passwords when an API token is expected.

## Workflow

Use [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md). GitHub Issues,
Milestones, PRs, docs, and Actions are the project-management system.

For every substantive coding session:

1. Inspect open milestones and their readiness criteria.
2. Identify the issue being worked; create a focused issue before substantive
   implementation if accepted work has no issue.
3. Search relevant open **and closed** issues and PRs for existing implementation,
   evidence, dependencies, and earlier decisions. Inspect related unmerged PRs.
4. Read README and relevant architecture docs, especially `docs/vision.md` and
   the affected subsystem's documentation. Historical stage descriptions may
   lag current code; compare them with main and merged PRs.
5. Implement only the accepted issue scope. Preserve recovery and ownership
   boundaries; do not turn a focused issue into a roadmap or unrelated refactor.
6. Record material discovered follow-up work in an existing/new issue and link it
   from the discovering PR, or record an explicit decision not to pursue it with
   a reason in an issue or durable directional doc.
7. Record **Implemented**, **Automated-test verified**, **Local-lab verified**,
   **Live-world verified**, and **Complete** separately. Name commits, commands,
   environments, scenarios, results, and missing evidence. Live evidence needs
   shard/room, tick range, wall-clock time/timezone, and useful sanitized telemetry.
8. Never claim a capability is complete just because tests passed or a PR merged.
   Close only when all acceptance criteria and required verification are met.

Use `Refs #X` or `Implements part of #X` while verification remains. Use
`Fixes #X` / `Closes #X` only when merging satisfies every required criterion.
Keep gameplay verification issues open after implementation merges as needed.

Before opening a PR, run:

```bash
npm run check
```

Record the results and limits in the PR. On Windows, `npm.cmd run check` is the
same command when PowerShell execution policy blocks `npm.ps1`. Validate changed
YAML/forms as well. Automated mocks and lifecycle simulations do not establish
engine behavior, local-lab acceptance, or official-world acceptance.

Issue scope and verification plans do not authorize deployment or account
mutation. Screeps deployment/reboot/spawn placement, destructive lab resets, and
AWS/MCP infrastructure changes require authorization for that operation. Keep
governance-only work limited to documentation and repository metadata.
