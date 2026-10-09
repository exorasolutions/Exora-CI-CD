# Phase 3 Security Review

1. Keep `DEPLOY_EXECUTION_ENABLED=false` until target-by-target validation is complete.
2. Do not give the deployment worker root SSH keys.
3. If systemd restart requires privilege, use a dedicated service account plus narrowly scoped sudoers entries for exact unit names.
4. For PM2, run under the owning application user rather than root.
5. Docker Compose deployment must only be enabled where Docker Engine is intentionally installed and the compose project is trusted.
6. Artifact paths are accepted only below `ARTIFACT_STAGING_ROOT`.
7. Project, target and adapter must match the central registry.
8. Artifact SHA-256 is verified immediately before deployment.
9. Do not log tokens, credentials or environment variables.
10. Before production enablement, add durable deployment locks and audit records so restarts cannot bypass concurrency or history controls.
