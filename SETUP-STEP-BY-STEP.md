# Setup checklist (existing VPS only)

## Stage 0 — Safety checks
- [ ] Keep a current VPS snapshot/backup.
- [ ] Check `free -h`, `df -h /`, `nproc`, active services, and listening ports.
- [ ] Do not install Jenkins until disk/RAM headroom is confirmed.
- [ ] Keep production deploy execution disabled.

## Stage 1 — Inspect the project locally
- [ ] Install a supported Node.js LTS version on your development machine.
- [ ] Read root README and phase docs.
- [ ] Inspect `controller/package.json` and `deploy-worker/package.json`.
- [ ] Run `npm install` and package build/tests in each package directory, where scripts exist.
- [ ] Fix compilation/test failures before copying to the VPS.

## Stage 2 — Server layout
Use `/opt/central-cicd` for platform code and `/opt/cicd` for controlled artifacts/workspaces. Do not place build workspaces inside `/var/www`. Do not recursively change ownership of `/var/www`.

## Stage 3 — Jenkins
- [ ] Install Jenkins LTS only after confirming resources and reviewing current official installation instructions.
- [ ] Put Jenkins behind Nginx + HTTPS; do not expose port 8080 publicly.
- [ ] Configure controller built-in executors to 0 when a separate agent is available. If forced to use the same VPS temporarily, use one executor maximum and enforce resource limits; do not run concurrent builds.
- [ ] Store credentials in Jenkins Credentials, never in Git.
- [ ] Configure the central shared library/job; application repositories must not contain Jenkinsfiles or GitHub Actions workflows.

## Stage 4 — Control API and database
- [ ] Create a dedicated database and restricted DB user.
- [ ] Apply the schema/migrations documented for the deploy worker.
- [ ] Create server-only environment files with restrictive permissions.
- [ ] Run the API under a dedicated unprivileged systemd service account.
- [ ] Expose webhook endpoints only through HTTPS and verify webhook HMAC signatures.

## Stage 5 — Safe dry run
- [ ] Register one disposable test repository and a test target with `enabled: false` until reviewed.
- [ ] Test webhook verification and branch/repository filtering.
- [ ] Test exact commit SHA checkout, build/test, artifact checksum, and Jenkins approval.
- [ ] Test deploy worker authentication and dry-run path only.
- [ ] Test archive path traversal, wrong checksum, invalid target, duplicate request, and concurrent deployment cases.

## Stage 6 — Before real deployment
- [ ] Implement and review actual artifact extraction/copy and each adapter's fixed allowlisted operations.
- [ ] Use a least-privilege deployment account and narrowly scoped helper/sudo rules; never give Jenkins arbitrary root shell.
- [ ] Test failed health check and rollback against a disposable app.
- [ ] Back up target data/config and verify recovery procedure.
- [ ] Enable execution only for one test target after explicit approval.
