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

Before opening a PR, run:

```bash
npm run check
```
