# Centralized CI/CD — Consolidated Phases 1–5

This is a consolidated development scaffold for a centralized CI/CD platform using a Fastify/TypeScript control API, Jenkins, central YAML registries, a deployment worker, and release-management foundations.

## Important safety status

- This repository is a scaffold, not a production-ready installer.
- No server has been changed by creating this archive.
- Production execution must remain disabled. Keep Jenkins `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=false` and deploy-worker `DEPLOY_EXECUTION_ENABLED=false` until the code is reviewed and tested.
- Exora production deployment code is implemented but must remain disabled until the enablement checklist below is completed.
- Build on the existing VPS only with strict concurrency limits; the VPS has previously had limited free disk and also hosts production apps.
- Do not add Jenkinsfiles or GitHub Actions workflows to application repositories. CI logic belongs in this central repository/Jenkins configuration.

## Main directories

- `controller/` — GitHub webhook validation, project registry, Jenkins trigger API.
- `jenkins/` — centralized pipeline/shared-library and job template.
- `config/projects/` — centrally managed repository policies.
- `config/build-profiles/` — centrally managed build profiles.
- `config/targets/` — deployment target examples; keep targets disabled until tested.
- `deploy-worker/` — authenticated deployment contract, persistence schema, adapter and release foundations.
- `docs/` — phase notes and security guidance.

## Central Jenkins pipeline policy

Application repositories do not provide Jenkinsfiles, GitHub Actions workflows, or build commands. The generic Jenkins job calls the shared library `central-cicd-lib` from this repository, and the shared library loads approved build profiles from `config/build-profiles/*.yaml` in the central repository. Jenkins must configure the Global Pipeline Library path as `jenkins/shared-library`, because that directory contains the library `vars/` and `resources/` roots.

The pipeline deliberately checks out the central repository into a separate `.central-cicd-config-*` directory before reading profile YAML. It must not read profiles from the application workspace. Jenkins administrators must configure these as protected global or folder environment variables, not as job parameters:

- `CENTRAL_CICD_CONFIG_REPOSITORY` - the HTTPS GitHub URL for this central repository.
- `CENTRAL_CICD_CONFIG_REF` - a full 40-character commit SHA for the trusted central config revision.
- `CENTRAL_CICD_CONFIG_CREDENTIALS_ID` - optional Jenkins credential ID for the central `exorasolutions/Exora-CI-CD` repository. Leave unset for anonymous checkout when the central repository is public.
- `CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127` - optional Jenkins credential ID for private application repositories owned by `yeshwanth1127`. Leave unset for anonymous checkout when the application repository is public.

If either value is missing, malformed, uses a mutable branch such as `main`, or does not check out to the exact requested commit, the pipeline fails closed. The current approved profile IDs are `node-npm-v1`, `node-pnpm-v1`, `python-v1`, and `node-npm-exora-monorepo-v1`.

Create Jenkins credentials explicitly when private repository access is needed; GitHub collaborator access alone does not create credentials for Jenkins. Use a GitHub fine-grained personal access token or deploy key stored in Jenkins Credentials, then put only the Jenkins credential ID in the protected administrator environment variable. Never embed tokens in repository URLs, YAML, shell commands, or logs. Webhook payloads and job parameters cannot choose credential IDs.

To add a new profile safely, add one YAML file under `config/build-profiles/`, validate required fields, update the shared-library allowlist and tests, then pin Jenkins to a reviewed central commit SHA. Do not load build commands from webhook payloads, job parameters, or application repositories. Existing single-package lockfile policy is `package-lock.json` for `node-npm-v1`, `pnpm-lock.yaml` for `node-pnpm-v1`, and no required lockfile for `python-v1`.

Monorepo applications are registered centrally with an explicit approved profile. Example shape:

```yaml
id: node-npm-example-monorepo-v1
version: 1
runtime: node
lockfileRequired: true
monorepo: true
artifactPath: .central-cicd/release
packages:
  - name: frontend
    workingDir: path/to/frontend
    lockfile: package-lock.json
    install: npm ci
    build: npm run build
    artifactPath: dist
    artifactTarget: frontend
  - name: api
    workingDir: path/to/api
    lockfile: package-lock.json
    install: npm ci
    test: npm test
    artifactIncludes:
      - package.json
      - package-lock.json
      - server.js
      - routes
      - services
    artifactTarget: api
```

Every `workingDir`, `lockfile`, `artifactPath`, `artifactIncludes`, and `artifactTarget` must be a safe relative path inside the checked-out repository. Each package must define exactly one artifact source: `artifactPath` for a generated output directory such as `dist`, or `artifactIncludes` for an explicit allowlist of backend files and directories. The shared library rejects absolute paths, traversal, backslashes, shell metacharacters, duplicate package names, duplicate artifact targets, unsupported lockfiles, unapproved commands, and artifact include lists that package an entire backend directory. Supported monorepo commands are currently only `npm ci`, `npm test`, and `npm run build`; add new commands only through central review and tests.

The Python profile intentionally creates `artifact/source` from repository source by running the centrally maintained shared-library helper `scripts/package-python-source.py`. It removes any previous `artifact` directory first and ignores generated directories such as `artifact`, `.git`, caches, virtual environments, `dist`, `build`, `.env*` files, and common secret key files so the artifact does not recursively copy itself or include common secrets.

## Exora production policy

The central Exora project registration is `config/projects/exora.yaml`. It accepts GitHub push webhooks only for `yeshwanth1127/exora` on branch `master`; the webhook controller verifies GitHub's `x-hub-signature-256`, rejects duplicate delivery IDs, rejects unregistered repositories and branches, and triggers Jenkins with the exact pushed commit SHA. Webhooks cannot choose deployment targets, credentials, or execution flags.

The approved Exora build profile is `node-npm-exora-monorepo-v1`. It builds only:

- `exora-mern/client` with `npm ci` and `npm run build`, packaging `dist` as `marketing-client`.
- `exora-mern/server` with `npm ci` and `npm test`, packaging only explicit backend files as `main-server`.

`exora-mern/exora-crm` is intentionally excluded and rejected by profile validation, shared-library validation, and deploy-worker artifact checks.

The production target registration is `config/targets/exora-production.yaml`. It is disabled by default and points at `/var/www/exora`; frontend files publish to `/var/www/exora/exora-mern/client/dist`, backend files publish to `/var/www/exora/exora-mern/server`, PM2 reloads the existing `exora-api` process, and health is checked on `http://127.0.0.1:5555/health`. The adapter preserves backend `.env`, `.env.production`, `uploads`, and `data`, does not edit Nginx, and does not run `pm2 save`.

## Deployment status and controls

Deployment execution remains disabled by configuration. The shared pipeline reads only the Jenkins administrator-managed `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED` environment variable and defaults to `false`. `DEPLOYMENT_MODE=automatic` only selects approval behavior after deployment is otherwise eligible; it is not permission to deploy and cannot enable execution by itself.

When execution is disabled, the pipeline logs that deployment was skipped, does not request the `production-deploy` agent, does not call the deploy worker, and does not execute deployment adapters. Packaging or archiving an artifact must not be interpreted as a successful deployment.

Future controlled deployment tests require these protected Jenkins administrator settings:

- `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=false` until the final enablement step.
- `CENTRAL_CICD_DEPLOY_ARTIFACT_STAGING_ROOT=/opt/cicd/artifacts`, or another reviewed root readable by the deploy worker.
- `CENTRAL_CICD_DEPLOY_WORKER_URL`, for example `http://127.0.0.1:3220`.
- `CENTRAL_CICD_DEPLOY_WORKER_TOKEN_CREDENTIALS_ID`, a Jenkins Secret Text credential ID for the deploy-worker bearer token.
- `CENTRAL_CICD_DEPLOY_DRY_RUN=true` for the first deployment-handoff test.

Create a restricted deployment account on the VPS, for example `exora-deploy`, and run the deploy worker under that account or an equivalently restricted service account. Grant access only to `/opt/cicd/artifacts`, `/opt/cicd/work`, `/var/www/exora/exora-mern/client/dist`, `/var/www/exora/exora-mern/server`, and the ability to reload the existing PM2 process `exora-api`. Do not give the webhook controller SSH keys or production credentials. If Jenkins connects to a deployment node over SSH, store the private key only as a Jenkins SSH credential and bind it to that node configuration, not to webhook payloads or YAML.

The required Jenkins labels are:

- `linux-build` or another centrally approved build-agent label for application builds.
- `production-deploy` only for a future reviewed deployment handoff. This label is not required while deployment execution is disabled.

Before production deployment can be enabled, complete this checklist:

1. Pin `CENTRAL_CICD_CONFIG_REF` to the reviewed commit containing the Exora deployment code.
2. Apply the updated `deploy-worker/schema.sql` adapter enum change and insert/enable only the `exora-production` target after review.
3. Configure `DEPLOY_ARTIFACT_STAGING_ROOT`, `DEPLOY_WORK_ROOT`, `DEPLOY_WORKER_TOKEN`, and keep `DEPLOY_EXECUTION_ENABLED=false`.
4. Run a Jenkins build with `CENTRAL_CICD_DEPLOY_DRY_RUN=true` and `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=false`; confirm no deployment node is allocated.
5. Run a reviewed handoff dry run with `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=true`, `CENTRAL_CICD_DEPLOY_DRY_RUN=true`, and deploy-worker `DEPLOY_EXECUTION_ENABLED=false`.
6. Back up `/var/www/exora`, confirm PM2 process `exora-api`, confirm health URL on port `5555`, and verify rollback on a disposable clone or maintenance window.
7. Only after explicit approval, set deploy-worker `DEPLOY_EXECUTION_ENABLED=true` and run one manual deployment. Do not enable automatic deployment until manual rollback and health-check behavior are verified.

Do not add Docker socket access, privileged containers, hardcoded production credentials, or uncontrolled executors.

## Recommended next steps

1. Review `docs/PHASE-2.md`, `docs/PHASE-3.md`, `docs/PHASE-4.md`, and `docs/PHASE-5.md` where present.
2. Check `.env.example` and each package's `package.json`; create real `.env` files only on the server and never commit secrets.
3. Install dependencies and run tests/builds locally first.
4. Set up Jenkins with controller executors set to 0, then configure a single constrained build executor/agent only after checking server capacity.
5. Configure PostgreSQL using `deploy-worker/schema.sql` and any SQL migrations referenced in docs.
6. Use a disposable test app and dry-run deployment first.
7. Do not enable real deployments until path safety, adapter commands, least privilege, health checks, and rollback have all been verified.

## Do not assume one command installs everything

This archive intentionally does not include an automatic production installer. Follow the setup instructions incrementally and inspect commands before running them on the production VPS.
