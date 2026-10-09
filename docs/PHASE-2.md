# Phase 2 — Jenkins control-plane integration

## Implemented
- Project registry now loads strict YAML project definitions from `config/projects`.
- GitHub webhook HMAC validation uses the exact raw request bytes.
- Push events are filtered by registered repository and production branch.
- Optional GitHub numeric repository ID pinning is supported.
- Duplicate GitHub delivery IDs are suppressed in memory for 24 hours.
- Controller triggers one generic Jenkins job through `buildWithParameters`.
- Jenkins receives exact commit SHA and central policy parameters.
- The shared pipeline checks out and verifies the exact SHA.
- Build/test/package run on a `linux-build` agent, not the controller.
- Monorepo builds can be centrally approved through explicit profile YAML with safe relative package working directories and per-package lockfile checks.
- Artifacts are checksummed, archived and stashed by Jenkins.
- Basic manual approval is included.
- Deployment execution is centrally feature-flagged off by default through Jenkins administrator configuration.
- While disabled, deployment handoff does not request the `production-deploy` agent and does not contact the deploy worker.
- Real deployment is still deliberately disabled in Phase 2.

## Why one generic Jenkins job?
It removes the need for a Jenkinsfile or GitHub Actions workflow in every
application repository. Repository behavior comes from the central project
registry and the central Shared Library.

## Known Phase 2 limitation
Webhook deduplication is currently memory-only. A controller restart forgets
delivery IDs. Before production use, persist webhook delivery IDs in a durable
store (PostgreSQL is the preferred design if a custom control database is added).

## Phase 3
- authenticated deployment worker
- strict target registry
- artifact upload/reference contract
- deploy locks
- PM2/systemd/static adapter implementation
- health checks and rollback
- durable run/audit history
