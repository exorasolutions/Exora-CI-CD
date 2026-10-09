# Phase 5 — Release Engine & Rollback

Release layout:

/var/www/example/
  releases/
    20261009-142-8a72c91/
    20261008-141-73bc1e2/
  current -> releases/20261009-142-8a72c91

A complete release is prepared before switching `current`. Activation uses an
atomic symlink replacement.

Failure flow:
prepare -> activate -> health check
health failure -> identify previous known-good release -> switch back ->
restart/reload if required -> health check -> ROLLED_BACK or ROLLBACK_FAILED.

Safety:
- validate archive paths before extraction
- restrict release IDs
- use centrally registered target roots
- never execute repository-provided shell commands
- keep production execution disabled until adapter testing is complete

Recommended states:
STARTED, ARTIFACT_VERIFIED, RELEASE_PREPARED, ACTIVATED,
HEALTH_CHECKING, SUCCEEDED, HEALTH_FAILED, ROLLING_BACK,
ROLLED_BACK, ROLLBACK_FAILED, FAILED.

Next phase: implement artifact extraction/copy and actual least-privilege
PM2/systemd/static/Compose helpers, then test against a disposable app.
