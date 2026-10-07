# Development workflow

This repository is the project-management system. Use GitHub Issues, Milestones,
PRs, docs, and Actions; no separate board or external tracker is required.
Adapted from `jasondotsetHacked/sethacked-site`'s workflow and issue/PR templates
at [`7474e96`](https://github.com/jasondotsetHacked/sethacked-site/tree/7474e96b0d7dc10f0ca7621b70393172b469edb9).
Screeps requires separate automated, accelerated-lab, and official-world evidence.

## Where information belongs

| Place | Purpose |
| --- | --- |
| Issues | Accepted capabilities, defects, verification gaps, and maintenance with observable acceptance criteria |
| Milestones | A small set of usable near-term outcomes with readiness criteria |
| PRs | Implementation scope, reasons, commit-specific checks, and linked follow-ups |
| README | Current capabilities and setup/operating entry points |
| Architecture docs | Ownership boundaries, contracts, limitations, and historical stage decisions |
| `docs/vision.md` | Long-term direction; ideas are not automatically accepted work |
| Actions | Repeatable automated checks without deployment; CI is one evidence layer |

Before implementation, search open and closed issues/PRs and read the affected
architecture docs. Compare historical descriptions with current main. Avoid
duplicate implementation issues for shipped systems and capability twins for
every verification issue. One issue represents one independently completable
capability/problem; neither tiny implementation steps nor unrelated roadmaps.

## Capture actionable work

Use **Bug** for observed behavior that violates an intended outcome; short reports
and unknown details are welcome. Use **Feature/capability** for accepted outcomes
with criteria and exclusions. Use **Verification** when code exists but required
evidence is missing. Use **Chore/infrastructure** for maintenance and operations.
Blank issues remain available. Triage supplies missing scope, dependencies,
verification requirements, area, priority, and milestone before implementation.

Every material unfinished item discovered during implementation must end as an
existing issue, a new issue, or an explicit decision not to pursue it. Link
follow-ups from the discovering PR and relevant capability. Record a reason for
declined work in an issue or durable directional doc. Keep unaccepted ideas in
the vision rather than manufacturing active issues. A deferred accepted item
needs a reason and a revisit condition; it is not current implementation work.

Failures found while verifying belong in linked bugs. Retain the verification
issue until the accepted evidence is complete. Preserve historical bodies and
comments when superseding stale roadmaps; add a disposition with successor links
and close as not planned rather than pretending the whole roadmap shipped.

## Evidence and completion

These are separate evidence fields, not mutually exclusive GitHub state labels.
Record each as satisfied, pending, partial, or not applicable with a reason.

| Field | Meaning |
| --- | --- |
| Implemented | Code exists at a named commit/PR; state whether it is on main or unmerged |
| Automated-test verified | Named repeatable checks passed at that commit, within documented mock/simulation limits |
| Local-lab verified | Behavior observed in the accelerated local Screeps engine, for named scenarios and a reproducible baseline |
| Live-world verified | Behavior observed on official Screeps World, with useful shard/room/tick/time/telemetry evidence |
| Complete | All acceptance criteria and all required evidence are satisfied; close with an evidence summary |

For gameplay capabilities, require automated, local-lab, and live-world evidence
unless the issue explicitly justifies a narrower requirement before closure.
Docs-only work can mark lab/world evidence not applicable with a reason. External
ops work needs actual service/client evidence separately: a mocked Lambda test
or an OAuth login does not prove in-game economy behavior.

Each evidence record should include:

- Tested commit and, when available, CI run or implementation PR.
- Environment: test harness; lab engine/mod versions, baseline, and tick duration;
  or official shard and room. Name client/service configuration versions for ops.
- Scenario, expected outcome, observed result, limitations, and failures.
- Tick start/end and wall-clock start/end with timezone for engine observations.
- Sanitized logs, visuals, or telemetry references with measured controller
  progress, population/replacement, energy/buffers, construction, errors, and
  CPU/bucket as relevant. State missing metrics and sampling gaps.

Do not paste tokens, cookies, raw Memory, backups, private identities, or bulk
private telemetry into this public repo. Link restricted evidence only when
appropriate and provide a safe outcome summary reviewers can assess. Capacity
assignments and accepted intents are not measured delivered work; an accepted
safe-mode intent does not prove the engine applied protection.

`npm run check` runs typecheck, repository tests, isolated credential-free MCP
tests, and the runtime build. The lifecycle harness models selected deferred
intents; it omits real traffic/collisions, fatigue, and parts of intent ordering.
Lab success adds real local-engine evidence but cannot prove official CPU,
competition, account APIs, or established-room behavior. Existing CI also
validates/builds the MCP SAM template without deployment. Validate any changed
YAML and GitHub forms; checks do not authorize deployments.

## Labels and milestones

Use one type and usually one or two areas. Forms apply type labels; dropdowns do
not apply area labels automatically. Triage adds area, priority, and milestone.

| Vocabulary | Purpose |
| --- | --- |
| `type:bug`, `type:feature`, `type:verification`, `type:chore` | Nature of the work |
| `area:runtime`, `area:colony`, `area:logistics`, `area:planning` | Kernel/execution, home economy/recovery, resource flow, layout/forecasting |
| `area:world-intel`, `area:ops`, `area:infra`, `area:security` | Observations/assessment, telemetry/clients, tooling/CI/lab, credential/authorization boundaries |
| `needs-verification` | Required acceptance evidence is missing, including for implemented work |
| `blocked` | A linked dependency prevents meaningful progress; state it and remove when resolved |
| `deferred` | Accepted work postponed with a reason and revisit condition |
| `priority:high`, `priority:normal`, `priority:low` | Readiness blocker, ordinary work, lower urgency |

Do not add todo/in-progress/done/merged labels; GitHub already records state.
Do not add labels for each module or distant idea. Milestones describe readiness,
not guessed dates. Assign an issue to the earliest milestone that requires it and
link downstream dependencies. Uncommitted ops work can remain unmilestoned.

| Near-term milestone | Readiness |
| --- | --- |
| Stable RCL4 Home Colony | One home bootstraps to RCL4, completes accessible controller/storage infrastructure, sustains labor and local source logistics over replacement cycles, and recovers from low energy/population/specialist loss; RoomPlan meets its lab and official brownfield criteria; required evidence is recorded |
| Remote Economy | One supported remote returns useful net energy through bounded cross-room travel and fresh intel/assessment; home recovery wins resource arbitration; uncertainty/threat/route failure pauses safely; replacement and lab/official evidence are recorded |
| Autonomous Expansion | After home/remote readiness, one supported claim/pioneer operation creates a second self-sustaining colony, respects GCL/support capacity and home reserves, recovers or aborts safely, and has lab/official acceptance evidence |

Do not close milestones merely because implementation PRs merged. Revise readiness
explicitly with a reason if scope changes. Advanced combat, industry, market,
inter-shard systems, and forty-room planning remain vision items without distant
speculative milestones.

## Implementation and closure

Start substantive PRs from an issue. Use **Refs #X** or **Implements part of #X**
when acceptance remains. Use **Fixes #X / Closes #X** only when merging satisfies
every acceptance criterion and required verification. Disable automatic issue
closure wording while gameplay verification remains; GitHub auto-close is not
an acceptance system. A capability may remain open after its implementation merges.

Record commands/results and checks not performed in both PR and issue. Review
criteria and evidence before closing; remove `needs-verification` after required
evidence is complete. Declined/superseded issues close as not planned with a reason
and successor links. Preserve useful implementation and verification history.

Issue plans do not grant permission to deploy to Screeps, place a spawn/reboot an
account, reset a lab destructively, or change AWS/MCP infrastructure. Follow the
operator authorization for each operation and the existing credential boundaries.

## Resume human or AI-assisted work

1. Inspect open milestones and readiness definitions.
2. Identify the accepted issue and search relevant open/closed issues and PRs.
3. Read README, `docs/vision.md`, and affected architecture/operating docs.
4. Compare current main and unmerged implementation with issue scope and evidence.
5. Implement only accepted scope; record material follow-ups as issues.
6. Distinguish tests, lab observation, official-world observation, and completion.

Templates become active when merged to the default branch. Ordinary GitHub
history is sufficient; no custom AI metadata or additional status board is needed.

## Governance audit

The initial audit is based on main `27c1398` and draft RoomPlan PR #30 at
`31fa754`, reviewed on 2026-10-07. The linked issues below are the current tracker;
this section records the audit disposition rather than a second task list.

| Audited system/history | Finding and canonical tracking |
| --- | --- |
| README and vision | README describes current foundations; vision remains the architectural north star rather than dozens of active tasks. [#31](https://github.com/jasondotsetHacked/screeps-again/issues/31) tracks this governance change |
| Colony labor/safety, population and local source logistics | Implemented by #19/#20/#25/#26. Stage 3 rollout is recorded in vision/#27; historical initial live snapshots remain in #14. [#32](https://github.com/jasondotsetHacked/screeps-again/issues/32) tracks healthy RCL4 acceptance and [#33](https://github.com/jasondotsetHacked/screeps-again/issues/33) tracks real-engine fault/recovery acceptance |
| Phase 3.1 local refinement | #27 implements batching, soft ownership, controller reserve and RCL4 storage. Documented tests/simulations do not establish a current RCL4 soak or live CPU benchmark; #32/#33 track evidence, not a duplicate implementation |
| World intelligence | #21 implements visible-room versioned facts/freshness; external analysis/start scoring already exists. [#37](https://github.com/jasondotsetHacked/screeps-again/issues/37) travel, [#38](https://github.com/jasondotsetHacked/screeps-again/issues/38) scouting, [#39](https://github.com/jasondotsetHacked/screeps-again/issues/39) assessment/designation and [#40](https://github.com/jasondotsetHacked/screeps-again/issues/40) remote mining are distinct missing capabilities |
| Expansion and forecasting | [#41](https://github.com/jasondotsetHacked/screeps-again/issues/41) is deferred until home/remote readiness; [#42](https://github.com/jasondotsetHacked/screeps-again/issues/42) is a deferred bounded home forecast, not the original giant forecaster roadmap |
| AWS Ops and private MCP | #22/#23/#24 replace the public console with private collector/query/MCP; #24 records real OAuth/ChatGPT telemetry acceptance. [#36](https://github.com/jasondotsetHacked/screeps-again/issues/36) tracks only the expressly pending query concurrency update and paired-call evidence; deployment drift is unknown until read-only inspection |
| Accelerated Windows lab | #29 records bootstrap, local deploy, RCL2 behavior, hidden host shutdown and baseline restore. [#35](https://github.com/jasondotsetHacked/screeps-again/issues/35) tracks its specifically unexercised player-owned Steamless conversion, not the whole lab |
| Current runtime and tests | `main.ts` delegates to the kernel; colonies own labor/population/logistics, specialists execute, and world observation is independent. Governance check passed with 368 repository + 73 MCP tests, typecheck and build. Mock lifecycle coverage omits full engine traffic/fatigue/ordering; no new lab/world acceptance was performed |
| Draft RoomPlan #30 | [#34](https://github.com/jasondotsetHacked/screeps-again/issues/34) owns capability acceptance. #30 at `31fa754` implements committed layout/codec/construction with 405 repository + 73 MCP tests and successful head CI. Actual lab visuals/construction/CPU and official brownfield evidence remain pending; PR stays unmerged/draft |
| Old #1 and #2 | Closed as superseded/not planned with implementation findings and successor links; original roadmap bodies/history preserved. Unaccepted advanced ideas stay in the vision |
| Account recovery #4 | Remains open, narrowed to verification of existing explicit lost/empty reboot; original requirement retained. Colony faults move to #33. Official account-API coverage is event-gated; do not destroy a healthy account to obtain evidence |
| Old console #14 | Closed as retired/superseded by private Ops/MCP; all original command comments and telemetry snapshots preserved |

Recommended first work after this governance PR merges:
[#34 RoomPlan v1 acceptance](https://github.com/jasondotsetHacked/screeps-again/issues/34).
Finish architectural review of #30 and obtain real accelerated-lab construction,
visual, brownfield and CPU evidence before treating it as ready; arrange official
brownfield acceptance separately under explicit operating authorization. If the
player-owned lab identity blocks visual review, complete #35 first. #32/#33 then
establish home readiness before remote activation.
