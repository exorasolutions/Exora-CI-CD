# Phase 1 — Foundation

## Objective
Establish the repository structure, central Jenkins pipeline contract, project configuration model, and API boundaries without touching production.

## Exit criteria
1. Central repository builds cleanly.
2. Controller has liveness/readiness endpoints.
3. GitHub webhook boundary validates HMAC signatures.
4. Jenkins pipeline is centrally stored.
5. A project can be described without modifying its repository.
6. Deployment worker remains dry-run until the deployment security layer is approved.

## Next phase
- persistent project registry
- Jenkins API integration
- GitHub App integration
- job provisioning strategy
- real build agent onboarding
- artifact storage
- authenticated deployment worker
