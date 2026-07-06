# Agent Team

Sprint 5B adds a professional Agent division-of-work system. It turns a user task plus project context and enabled Domain Packs into a structured multi-agent plan, then records the plan as a Job Center multi-agent job. It does not execute real CAD, PLC, PCB, BIM, process, energy, or materials tools.

## Agent Profile Schema

Core types live in `src/agent-team.ts`:

- `AgentProfile`
- `AgentRole`
- `AgentResponsibility`
- `AgentInput`
- `AgentOutput`
- `AgentReviewChecklist`
- `AgentEscalationRule`

Each profile includes:

- `id`, `name`, and `role`
- supported industrial `domains`
- responsibilities and deliverables
- expected inputs and outputs
- review checklist
- escalation rules
- quality gates
- expected artifact types
- whether software work can enter Patch Arena

Domain Pack `agentProfiles` are converted into `domain-pack-reviewer` profiles only when the pack is installed and enabled.

## Built-In Agents

Sprint 5B includes:

- `product-manager`
- `system-architect`
- `fullstack-engineer`
- `qa-engineer`
- `security-engineer`
- `release-manager`
- `mechanical-cad-engineer`
- `solidworks-engineer`
- `pcb-engineer`
- `plc-automation-engineer`
- `electrical-engineer`
- `bim-architect`
- `process-chemical-engineer`
- `energy-systems-engineer`
- `materials-engineer`
- `manufacturing-engineer`
- `technical-writer`

## Division Rules

The planner uses:

- Current `.hicode/project.json` domains and project type
- User task keywords
- Installed and enabled Domain Packs
- Built-in agent domain coverage

It generates:

- task breakdown
- assigned agents
- expected artifacts
- review chain
- quality gates
- human approval points
- Patch Arena handoff request for software tasks
- industrial artifact/checklist/tool-run plan for industrial tasks

Disabled Domain Packs do not contribute agent profiles, standards, checklists, gates, tool requirements, or plan metadata.

## Multi-Agent Job

Implementation lives in `electron/services/agent-team-service.mjs`.

IPC channels:

- `agent-team:profiles`
- `agent-team:profile:get`
- `agent-team:plan:create`
- `agent-team:plan:list`
- `agent-team:plan:get`
- `agent-team:job:create`

`agent-team:job:create` creates a Job Center job with one task per planned agent. Each task stores:

- agent id and role
- status
- input contract
- output contract
- expected artifacts
- review checklist
- review result
- execution group and dependency metadata

Sequential execution is supported by the ordered `executionGroup`; parallel execution is represented by shared `parallelGroup` values so later runner work can execute group 3 specialists concurrently.

Generated artifacts are written under:

```text
.hicode/generated/agent-team/<planId>/
  agent-plan.json
  artifact-plan.json
  review-chain.json
  tool-run-plan.json
```

These files are attached to Job Center as artifacts. Human approval points are recorded as requested approval records.

## Domain Pack Relationship

Enabled Domain Packs contribute:

- domain reviewer profiles
- quality gates
- template-based artifact plan entries
- checklist plan entries
- dry-run-only tool run plan entries

The tool run plan is descriptive. It never executes external industrial tools and always records `dryRunOnly` plus approval requirements.

## Patch Arena Relationship

Software tasks or tasks that mention coding/API/frontend/backend/Electron can produce a `patchArenaRequest`:

```json
{
  "providerIds": ["hicode-internal"],
  "mode": "auto",
  "reason": "software task can be sent to Patch Arena after human approval"
}
```

Sprint 5B does not automatically launch Patch Arena from the Agent Team panel. The plan and Job Center event make the handoff explicit and auditable.

## Renderer

The UI lives in `renderer/components/agent-team-panel.js` and is mounted inside the Industrial Project page. It supports:

- Viewing agent profiles
- Viewing saved plans
- Generating a division-of-work plan
- Creating a Multi-Agent Job
- Viewing agent tasks, status, expected artifacts, review chain, review results, quality route, and approval points

## Validation

```bash
npm run build
npm run verify
node test/agent-team-tests.mjs
node test/feature-tests.mjs
```
