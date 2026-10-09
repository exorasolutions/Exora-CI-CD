# Phase 3 — Authenticated deployment worker

## Goal
Replace the Phase 2 deployment dry-run with a controlled deployment boundary. The worker validates a registered target, artifact location, SHA-256 digest and adapter before any deployment operation.

## What is included
- Target registry loaded from `config/targets/*.yaml`.
- Shared-secret authentication using `X-Deploy-Token`.
- Project/target/adapter policy matching.
- Artifact staging-root containment check.
- SHA-256 verification before deployment.
- Per-project/environment in-process deployment lock.
- Static, PM2, systemd, Docker Compose and Python adapters.
- `DEPLOY_EXECUTION_ENABLED=false` remains the safe default.

## Important
This phase contains real adapter code but does not install or enable it on production. Before enabling execution, every target must be reviewed. The deployment account must be least-privileged, and commands/paths must be validated against the actual host.

## Artifact contract
The Jenkins deployment stage must place the approved artifact and its digest under the worker's configured staging root, or upload them through a future authenticated artifact endpoint. The worker never accepts arbitrary paths outside that root.

## Remaining work
- Move locks to PostgreSQL/Redis for multi-instance durability.
- Add HTTP health-check execution and rollback orchestration.
- Replace shared token with mTLS or short-lived signed requests if the topology requires it.
- Add deployment event/audit persistence.
- Add target-specific service users and sudoers rules.
- Test each adapter against a disposable target before production.
