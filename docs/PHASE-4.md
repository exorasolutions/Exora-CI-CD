# Phase 4 — Controlled Artifact Handoff

## Adds
- Jenkins -> deployment worker contract
- authentication
- target validation
- SHA-256 artifact verification
- PostgreSQL deployment locks
- persisted deployment records
- HTTP health checks
- Jenkins deployment-stage integration
- dry-run default

## Important
The actual production adapter execution is intentionally NOT enabled. `DEPLOY_EXECUTION_ENABLED=false` is the safe default.

Before production execution:
1. finalize artifact storage
2. create least-privilege deployment account
3. validate every target path and process
4. implement/test each adapter on a disposable application
5. implement release switching and rollback
6. verify health endpoints
7. test failure and concurrency scenarios
8. only then enable execution

Application repositories still receive no Jenkinsfiles or GitHub Actions workflow files.
