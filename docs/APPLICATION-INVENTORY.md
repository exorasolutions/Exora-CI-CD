# Existing Application Inventory

This inventory reconciles local repository inspection with read-only Docker, `/srv/apps`, gateway, systemd, and deploy-worker environment output from the production VPS. Secret values were not captured. Production remains unchanged: no containers, files, gateway routes, services, databases, targets, or deployment flags were modified.

Deployment safety was verified from `/opt/central-cicd-worker/deploy-worker/.env`: `DEPLOY_EXECUTION_ENABLED=false`. The central controller and worker systemd units are running. Every additional target introduced by this preparation remains disabled.

## Readiness Definitions

- Build readiness: the central Jenkins profile can produce an artifact or source bundle from repository files.
- Dry-run readiness: the project and target YAML load through the runtime schemas and can be selected without enabling live deployment.
- Deployment readiness: the deploy worker has a tested live adapter, health policy, rollback path, installed restricted helper where needed, target enabled by approval, and staging/prod validation for the verified runtime. `exora-static` and the historical `exora-production` adapter have existing live execution paths. The Compose helper now independently validates target contracts, stages artifacts, and locks per target, but live Compose mutation remains blocked until candidate build-context mapping and health contracts are validated for each app.

## Confirmed Application Inventory

| Application | Repository | Branch | Central project -> target | Build profile | Verified production runtime | Readiness | Remaining deployment work |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Exora static website | `yeshwanth1127/exora` | `master` | `exora` -> `exora-static` | `node-npm-static-site-v1` | Container `exora-web`, image `exora-web:static-staging`, healthy, `127.0.0.1:8110->80`, root `/srv/apps/exora-website`, gateway `exora.solutions` proxies to `127.0.0.1:8110` | Build: ready. Dry run: ready. Deployment: adapter exists, target disabled. | Keep target disabled until separate approval. Preserve current loopback binding and gateway route. |
| Exora MERN/API legacy target | `yeshwanth1127/exora` | `master` | `exora` -> `exora-production` | `node-npm-exora-monorepo-v1` | Historical target `/var/www/exora`; gateway output still shows older root `/var/www/exora/exora-mern/client/dist`; Docker shows exited `exora-api-test` in `/srv/apps/exora-api` using `/srv/apps/exora-api/compose.yaml` | Build: profile exists but local source evidence is incomplete. Dry run: ready. Deployment: adapter exists, target disabled. | Treat as historical/legacy until separately reviewed. Do not confuse it with the active static public site. |
| Namma Cabs / cab | `yeshwanth1127/cab` | `master` | `cab` -> `cab-production` | `node-npm-cab-monorepo-v1` | Compose project `nammacabs` at `/srv/apps/nammacabs`, files `/srv/apps/nammacabs/compose.yaml,/srv/apps/nammacabs/compose.prod.yaml`; containers `nammacabs-web-1`, `nammacabs-backend-1`, `nammacabs-redis-1`; web binding `127.0.0.1:8103->80`; backend internal `3223/tcp`; data mounts under `/srv/apps/nammacabs/data` | Build: ready. Dry run: ready. Deployment: adapter code ready, target disabled, helper not production-installed or validated. | Install/review restricted helper, run staging validation, then approve target enablement separately. Preserve data mounts, redis, backend, web, and gateway route. |
| Exora CRM | `rvamsi201-vk/exora_crm` | `prasad_changes` | `exora-crm` -> `exora-crm-production` | `node-npm-exora-crm-v1` | Compose project `exora-crm` at `/srv/apps/exora_crm`, files `/srv/apps/exora_crm/compose.yaml,/srv/apps/exora_crm/compose.prod.yaml`; container `exora-crm-crm-1`, `127.0.0.1:8106->3002`; mounts `/srv/apps/exora_crm/data/logs` and `/var/www/Nomi/data:ro`; gateway `crm.exora.solutions` proxies to `8106` and `/health` | Build: ready. Dry run: ready. Deployment: adapter code ready, target disabled, helper not production-installed or validated. | Configure owner credential `CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_RVAMSI201_VK`; install/review restricted helper and validate rollback without touching CRM data or Nomi mount. |
| Shared services | `yeshwanth1127/exora-shared-services` | `main` | `exora-shared-services` -> `exora-shared-services-production` | `node-npm-exora-shared-services-v1` | Compose project `shared-services` at `/srv/apps/shared`, files `/srv/apps/shared/compose.yaml,/srv/apps/shared/compose.prod.yaml`; services observed from local compose and Docker output: `whatsapp-qlix`, `whatsapp-loomrun`, `mcp-qlix`, optional `mcp-gmail-loomrun`; bindings `3939`, `8090`, `3940`; network `shared`; data under `/srv/apps/shared/data` | Build: source bundle ready. Dry run: ready. Deployment: adapter code ready, target disabled, helper not production-installed or validated. | Validate shared-service policy before approval; preserve shared network, WhatsApp auth state, MCP data, `/tmp` read-only mount, and Loomrun storage read-only mount. |
| Loomrun | `yeshwanth1127/loomrun` | `master` | `loomrun` -> `loomrun-production` | `node-npm-loomrun-compose-source-v1` | Compose project `loomrun` at `/srv/apps/loomrun`, files `/srv/apps/loomrun/compose.yaml,/srv/apps/loomrun/compose.prod.yaml`; services verified from local compose and Docker output: `web`, `api`, `redis`; web binding `127.0.0.1:8107->80`; API internal `8002/tcp`; mounts `/srv/apps/loomrun/.env:ro`, `/srv/apps/loomrun/data/storage`; network `shared` | Build: source bundle ready. Dry run: ready. Deployment: adapter code ready, target disabled, helper not production-installed or validated. | Install/review restricted helper and validate service-aware rollback preserving API, Redis, storage, `.env`, and shared network. |
| Qlix | `yeshwanth1127/qlix` | `master` | `qlix` -> `qlix-production` | `node-npm-qlix-compose-source-v1` | Compose project `qlix` at `/srv/apps/qlix/deploy/server`, file `/srv/apps/qlix/deploy/server/compose.yaml`; services `backend`, `frontend`; both use host networking; gateway routes API to `127.0.0.1:4000` and frontend to `127.0.0.1:3000`; mounts include env, runner data, provenance, backend data, secrets, `/tmp`, and SSH read-only material | Build: source bundle ready. Dry run: ready. Deployment: adapter code ready, target disabled, helper not production-installed or validated. | Install/review restricted helper and validate host-network rollback preserving exact workdir, env/secrets mounts, runner state, and gateway assumptions. |
| Sunkidz | `yeshwanth1127/sunkidz` | `master` | `sunkidz` -> `sunkidz-production` | `node-npm-sunkidz-compose-source-v1` | Compose project `sunkidz` at `/srv/apps/sunkidz`, files `/srv/apps/sunkidz/compose.yaml,/srv/apps/sunkidz/compose.prod.yaml`; services verified from local compose and Docker output: `web`, `api`; web binding `127.0.0.1:8101->80`; API binding `127.0.0.1:8104->8001`; upload mount `/srv/apps/sunkidz/data/uploads` | Build: source bundle ready. Dry run: ready. Deployment: adapter code ready, target disabled, helper not production-installed or validated. | Install/review restricted helper and validate service-aware rollback preserving API, uploads, web/API routes, and health behavior. |

## Additional Deployed Applications Not Yet Configured

| Application | Verified runtime |
| --- | --- |
| `nomi` | Container `nomi`, compose project `nomi`, root `/srv/apps/nomi`, `127.0.0.1:3002->3000`, upload mount `/srv/apps/nomi/data/uploads`; gateway output has older and newer proxy entries for `nomi.exora.solutions`. |
| `sona` | Compose project `sona`, root `/srv/apps/sona`, container `sona-web-1`, `127.0.0.1:8105->3100`, upload mount `/srv/apps/sona/data/uploads`; gateway `sona.exora.solutions` proxies to `8105`. |
| `package-registry` | Compose project `package-registry`, root `/srv/apps/package-registry`, container `package-registry-registry-1`, `127.0.0.1:8102->8080`, packages and htpasswd mounts; gateway `packages.exora.solutions` proxies to `8102`. |
| `gateway` | Compose project `gateway`, root `/srv/gateway`, host network, read-only `/srv/gateway/nginx` and certificate mounts. The gateway must not be restarted by app deployments. |
| Jenkins/build infrastructure | `central-jenkins` at `/opt/jenkins`, `central-cicd-agent`, artifact mount `/opt/cicd/artifacts`; systemd services `central-cicd-controller.service` and `central-cicd-worker.service` are active. |

## Corrected Target Configuration Summary

| Target | Adapter | Root | Compose workdir/files | Status |
| --- | --- | --- | --- | --- |
| `exora-static` | `exora-static` | `/srv/apps/exora-website` | not Compose | Disabled; live adapter implemented and tested. |
| `exora-production` | `exora-production` | `/var/www/exora` | not Compose | Disabled; historical MERN adapter implemented but target needs separate review. |
| `cab-production` | `compose` | `/srv/apps/nammacabs` | `/srv/apps/nammacabs`; `compose.yaml,compose.prod.yaml` | Disabled; Compose adapter code implemented and unit-tested, helper not production-installed or approved. |
| `exora-crm-production` | `compose` | `/srv/apps/exora_crm` | `/srv/apps/exora_crm`; `compose.yaml,compose.prod.yaml` | Disabled; Compose adapter code implemented and unit-tested, helper not production-installed or approved. |
| `exora-shared-services-production` | `compose` | `/srv/apps/shared` | `/srv/apps/shared`; `compose.yaml,compose.prod.yaml` | Disabled; Compose adapter code implemented and unit-tested, helper not production-installed or approved. |
| `loomrun-production` | `compose` | `/srv/apps/loomrun` | `/srv/apps/loomrun`; `compose.yaml,compose.prod.yaml` | Enabled in central target registry after helper/staging contract validation; execution still requires Jenkins and deploy-worker gates. |
| `qlix-production` | `compose` | `/srv/apps/qlix` | `/srv/apps/qlix/deploy/server`; `compose.yaml` | Disabled; Compose adapter code implemented and unit-tested, helper not production-installed or approved. |
| `sunkidz-production` | `compose` | `/srv/apps/sunkidz` | `/srv/apps/sunkidz`; `compose.yaml,compose.prod.yaml` | Disabled; Compose adapter code implemented and unit-tested, helper not production-installed or approved. |

## Supported Compose Adapter Contract

The worker accepts only approved target IDs, repositories, production roots, compose working directories, compose files, compose project names, and service allowlists recorded in target YAML. It writes a deployment policy under the worker work root and invokes only the restricted `central-compose-deploy` helper through `sudo -n`. Artifact tar metadata is validated before helper dispatch; links, traversal, absolute paths, and unsafe entries are rejected.

The helper contract supports `validate`, `deploy`, and `rollback`; independently pinned target contracts; private artifact staging; per-target locking; immutable recovery references; `docker compose config --quiet`; and fail-closed rollback reporting. The root-owned `/etc/central-cicd/compose-live-targets` opt-in may name only the explicitly scoped `cab-production` and `loomrun-production` targets, but opt-in alone never authorizes a deployment: the target policy must also prove the candidate build-context, staging, health, and preservation contracts. Live `docker compose build` and `docker compose up -d --no-deps` remain blocked until those contracts are proven for each target. It intentionally avoids `docker compose down`, broad pruning, wildcard container deletion, gateway restarts, database migrations, and volume deletion.

### Loomrun production authorization prerequisites

The tracked helper recognizes `loomrun-production` as an allowed live-mutation scope, and the target registry now records the verified helper-installed/staging-validated and Docker-healthcheck-required contract. Production execution still requires the Jenkins administrator execution flag, the project allowlist, the root-owned live-target opt-in, and the deploy-worker target to be enabled.

The following steps are manual VPS changes and must not be performed by Jenkins or this repository checkout:

1. Install the reviewed `deploy-worker/tools/central-compose-deploy` at `/usr/local/sbin/central-compose-deploy`, owned by `root:root`, mode `0755`, and verify its checksum against the reviewed central-CI/CD revision.
2. Run the Loomrun disposable staging workflow using `deploy-worker/tools/prepare-loomrun-staging.ps1` (or its approved Linux equivalent), then run `stage-deploy`, health validation, failure/rollback, preservation, and cleanup checks against the isolated staging root and Docker project. Do not use `/srv/apps/loomrun` as staging.
3. After independent review records those results, keep the target contract at the approved helper-installed/staging-validated and Docker-healthcheck-required values; deployment still requires the separate approval or automatic execution controls.
4. Create `/etc/central-cicd/compose-live-targets` only when authorized, as a root-owned regular file with mode `0600`, containing exactly the approved IDs, for example `cab-production` and `loomrun-production`. The directory must be root-owned and not writable by group/other. This file alone is never sufficient.
5. Keep deploy-worker and Jenkins deployment execution disabled until the artifact, target validation, approval, and rollback evidence are reviewed. No database migration or production container change is part of this procedure.

## Jenkins Job Mapping

Application repositories do not need Jenkinsfiles or GitHub Actions workflows. The Exora static project uses the tested `exora-static` job override. Additional jobs should remain build/dry-run oriented until their adapters are implemented and tested.

| Jenkins job | Project ID | Repository | Build profile | Target |
| --- | --- | --- | --- | --- |
| `exora-static` | `exora` | `yeshwanth1127/exora` | `node-npm-static-site-v1` | `exora-static` |
| `central-cicd-exora-mern` or legacy fallback | `exora` | `yeshwanth1127/exora` | `node-npm-exora-monorepo-v1` | `exora-production` |
| `central-cicd-cab` | `cab` | `yeshwanth1127/cab` | `node-npm-cab-monorepo-v1` | `cab-production` |
| `central-cicd-exora-crm` | `exora-crm` | `rvamsi201-vk/exora_crm` | `node-npm-exora-crm-v1` | `exora-crm-production` |
| `central-cicd-exora-shared-services` | `exora-shared-services` | `yeshwanth1127/exora-shared-services` | `node-npm-exora-shared-services-v1` | `exora-shared-services-production` |
| `central-cicd-loomrun` | `loomrun` | `yeshwanth1127/loomrun` | `node-npm-loomrun-compose-source-v1` | `loomrun-production` |
| `central-cicd-qlix` | `qlix` | `yeshwanth1127/qlix` | `node-npm-qlix-compose-source-v1` | `qlix-production` |
| `central-cicd-sunkidz` | `sunkidz` | `yeshwanth1127/sunkidz` | `node-npm-sunkidz-compose-source-v1` | `sunkidz-production` |

## Operator Checklist For Production Approval

1. Prove the extracted candidate artifact layout and Docker build context for every built service before removing the helper's fail-closed live-deploy block.
2. Define verified app-level or Docker health contracts for every Compose target; running status alone is not enough.
3. Review and install the restricted Compose helper with the intended sudoers boundary only after the first two items pass in staging.
4. Preserve env files, secrets, uploads, runner data, Redis/Postgres volumes, shared networks, host-network assumptions, and app-specific data mounts.
5. Keep every new target disabled until staging or validation-only production checks cover deploy, health failure, rollback, disabled target dry-run behavior, and wrong-service protection.
6. Keep `DEPLOY_EXECUTION_ENABLED=false` and central Jenkins deployment execution disabled until a separate production approval.
7. Configure `CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_RVAMSI201_VK` before `exora-crm` checkout is expected to work in Jenkins.
