# Existing Application Inventory

This inventory was prepared from the local workspace on 2026-10-13. No production VPS SSH inspection was available in this run, so container names, live paths, gateway routes, health URLs, systemd units, PM2 processes, and deployed checkouts are marked unknown unless local repository files provided evidence. All newly added deployment targets remain disabled.

| Application | Repository | Branch | Components | Runtime and package manager | Install / test / build / package | Deployment evidence | Central project | Target | Build | Dry run | Future deployment | Unknowns and risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| exora | yeshwanth1127/exora | master | `exora-mern/client`, `exora-mern/server` in existing central profile | Node/npm | Existing `node-npm-exora-monorepo-v1`: `npm ci`; client `npm run build`; server `npm test`; package allowlisted client/server output | Existing target `/var/www/exora`, PM2 `exora-api`, health `http://127.0.0.1:5555/health` | `exora` | `exora-production` | Supported by existing profile, but local checkout currently lacks `exora-mern/server/package.json` evidence | Dry run supported | Only existing `exora-production` adapter is wired for live execution; target disabled | Verify current source tree and production checkout before any future deployment |
| cab | yeshwanth1127/cab | master | `backend`, `frontend` | Node/npm with per-component `package-lock.json` | `backend`: `npm ci`, `npm run build`; `frontend`: `npm ci`, `npm run build`; package backend allowlist and frontend `build` | Local Dockerfiles found; no live deployment evidence | `cab` | `cab-production` | Supported | Supported while central execution remains disabled | Disabled until production compose/service identity is verified and adapter execution is implemented | Live directory, ports, compose file, health URL, data volumes unknown |
| exora-crm | rvamsi201-vk/exora_crm | prasad_changes | Node CRM API plus local Postgres compose | Node/npm root `package-lock.json` | `npm ci`, `npm test`, `npm run check`; package allowlisted API/source files | `docker-compose.yml` defines local Postgres only; app runtime likely Node/PM2 or external compose, unconfirmed | `exora-crm` | `exora-crm-production` | Supported | Supported while central execution remains disabled | Disabled; requires production runtime confirmation and owner credential mapping | Live app process, app port, gateway route, database/env handling unknown |
| exora-shared-services | yeshwanth1127/exora-shared-services | main | `whatsapp-qlix`, `whatsapp-loomrun`, `mcp-qlix`, `mcp-gmail-loomrun` | Mixed Node/npm and Python; Compose source bundle | Source bundle profile packages compose inputs while excluding `.git`, env files, and `node_modules` | `compose.prod.yaml` references localhost-only ports `3939`, `8090`, `3940`, `8003` and existing Loomrun paths | `exora-shared-services` | `exora-shared-services-production` | Source packaging supported | Supported while central execution remains disabled | Disabled; compose execution adapter is not wired for live deployment | Need production compose root, env files, volumes, service identities, and health checks |
| loomrun | yeshwanth1127/loomrun | master | `apps/web` | Node/npm component `package-lock.json` | `apps/web`: `npm ci`, `npm run build`; package `dist` | `apps/api` exists but has no package manifest in local checkout; no live deployment evidence | `loomrun` | `loomrun-web-production` | Web build supported | Supported while central execution remains disabled | Static target disabled until live route/root is verified | API runtime, app root, ports, gateway route, storage paths unknown |
| qlix | yeshwanth1127/qlix | master | Compose app: backend, frontend, WhatsApp, MCP, Postgres, Redis | Mixed Node/npm packages; Docker Compose source bundle | Source bundle profile packages `Dockerfile`, `docker-compose.yml`, `backend-adk`, `frontend`, `packages`, `qlix-mcp-service`, `qlix-whatsapp-service` while excluding env files and `node_modules` | `docker-compose.yml` exposes configurable host ports for frontend `3000`, API `4000`, WhatsApp `3939`, MCP `3940`; persistent volumes for Postgres and WhatsApp | `qlix` | `qlix-production` | Source packaging supported | Supported while central execution remains disabled | Disabled; safe compose deployment and rollback not implemented | Production paths, env file location, port conflicts, gateway route, image tagging, and health URL unknown |
| sunkidz | yeshwanth1127/sunkidz | master | `sunkidz-web` | Node/npm component `package-lock.json` | `npm ci`, `npm run lint`, `npm run build`; package `dist` | Web Dockerfile found; no live deployment evidence | `sunkidz` | `sunkidz-web-production` | Supported | Supported while central execution remains disabled | Static target disabled until live route/root is verified | Backend/runtime not present as package manifest; live path, gateway route, health unknown |

## Jenkins Job Mapping

Use the existing centralized Jenkins shared library job template. Application repositories do not need Jenkinsfiles or GitHub Actions workflows.

| Jenkins job | Project ID | Repository | Build profile | Target |
| --- | --- | --- | --- | --- |
| `central-cicd-exora` | `exora` | `yeshwanth1127/exora` | `node-npm-exora-monorepo-v1` | `exora-production` |
| `central-cicd-cab` | `cab` | `yeshwanth1127/cab` | `node-npm-cab-monorepo-v1` | `cab-production` |
| `central-cicd-exora-crm` | `exora-crm` | `rvamsi201-vk/exora_crm` | `node-npm-exora-crm-v1` | `exora-crm-production` |
| `central-cicd-exora-shared-services` | `exora-shared-services` | `yeshwanth1127/exora-shared-services` | `node-npm-exora-shared-services-v1` | `exora-shared-services-production` |
| `central-cicd-loomrun` | `loomrun` | `yeshwanth1127/loomrun` | `node-npm-loomrun-web-v1` | `loomrun-web-production` |
| `central-cicd-qlix` | `qlix` | `yeshwanth1127/qlix` | `node-npm-qlix-compose-source-v1` | `qlix-production` |
| `central-cicd-sunkidz` | `sunkidz` | `yeshwanth1127/sunkidz` | `node-npm-sunkidz-web-v1` | `sunkidz-web-production` |

## Operator Checklist For Another Repository

1. Confirm the local Git root, remote owner/repository, deployment branch, package manager, lockfile, build scripts, Docker/Compose files, and current production runtime.
2. Confirm the live deployment root, service/container/process identity, persistent volumes, env-file locations, gateway upstream, port bindings, and health endpoint without printing secrets.
3. Add one `config/projects/<project-id>.yaml` file with the actual GitHub owner, repository, branch, approved build profile, Jenkins job mapping, and deployment target.
4. Add one disabled `config/targets/<target-id>.yaml` file using `/srv/apps/<app-name>` for new targets unless the app already lives elsewhere.
5. Reuse an existing build profile only when the install, test, build, and artifact paths match exactly. Otherwise add a new centrally approved profile and tests.
6. Keep deployment execution disabled until the adapter is implemented, tested, and reviewed against the real production runtime.
7. Configure owner-specific Jenkins credentials through administrator-managed environment variables only.
8. Run controller and deploy-worker tests, TypeScript builds, YAML validation, and `git diff --check`.

## Remaining Manual Steps

- Perform read-only VPS inventory for `/srv/apps`, Docker containers, Compose projects, systemd/PM2 processes, gateway upstreams, ports, health endpoints, and existing deployment audit records.
- Create or update Jenkins jobs from the central job template and map each job to exactly one project ID.
- Set `CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_RVAMSI201_VK` if `exora-crm` remains under `rvamsi201-vk`.
- Implement and test live `compose` and static deployment execution before enabling any new target.
- Keep `DEPLOY_EXECUTION_ENABLED` / `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED` false until a separate production approval.
