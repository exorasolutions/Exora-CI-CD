# Centralized CI/CD — Consolidated Phases 1–5

This is a consolidated development scaffold for a centralized CI/CD platform using a Fastify/TypeScript control API, Jenkins, central YAML registries, a deployment worker, and release-management foundations.

## Important safety status

- This repository is a scaffold, not a production-ready installer.
- No server has been changed by creating this archive.
- Production execution must remain disabled. Keep Jenkins `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=false` and deploy-worker `DEPLOY_EXECUTION_ENABLED=false` until the code is reviewed and tested.
- Phase 5 adapters are foundations/stubs; real process management and deployment commands are not fully implemented.
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

If either value is missing, malformed, uses a mutable branch such as `main`, or does not check out to the exact requested commit, the pipeline fails closed. The current approved profile IDs are `node-npm-v1`, `node-pnpm-v1`, and `python-v1`.

Create Jenkins credentials explicitly when private repository access is needed; GitHub collaborator access alone does not create credentials for Jenkins. Use a GitHub fine-grained personal access token or deploy key stored in Jenkins Credentials, then put only the Jenkins credential ID in the protected administrator environment variable. Never embed tokens in repository URLs, YAML, shell commands, or logs. Webhook payloads and job parameters cannot choose credential IDs.

To add a new profile safely, add one YAML file under `config/build-profiles/`, validate required fields (`id`, `version`, `runtime`, `lockfileRequired`, `install`, `test`, `build`, `artifactPath`), update the shared-library allowlist and tests, then pin Jenkins to a reviewed central commit SHA. Do not load build commands from webhook payloads, job parameters, or application repositories. Existing lockfile policy is `package-lock.json` for `node-npm-v1`, `pnpm-lock.yaml` for `node-pnpm-v1`, and no required lockfile for `python-v1`.

The Python profile intentionally creates `artifact/source` from repository source by running the centrally maintained shared-library helper `scripts/package-python-source.py`. It removes any previous `artifact` directory first and ignores generated directories such as `artifact`, `.git`, caches, virtual environments, `dist`, `build`, `.env*` files, and common secret key files so the artifact does not recursively copy itself or include common secrets.

## Deployment status and controls

Deployment execution remains disabled. The shared pipeline reads only the Jenkins administrator-managed `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED` environment variable and defaults to `false`. This shared-library version still refuses `true`; enabling deployment requires a reviewed code change in this repository plus administrator configuration. `DEPLOYMENT_MODE=automatic` only selects approval behavior after deployment is otherwise eligible; it is not permission to deploy and cannot enable execution by itself.

When execution is disabled, the pipeline logs that deployment was skipped, does not request the `production-deploy` agent, does not call the deploy worker, and does not execute deployment adapters. Packaging or archiving an artifact must not be interpreted as a successful deployment.

The required Jenkins labels are:

- `linux-build` or another centrally approved build-agent label for application builds.
- `production-deploy` only for a future reviewed deployment handoff. This label is not required while deployment execution is disabled.

Before production deployment can be enabled, the remaining blockers are: authenticated artifact upload or staging contract, target authorization, adapter command review, least-privilege deployment user, health checks, rollback behavior, durable audit/history, and disposable-environment testing. Do not add Docker socket access, privileged containers, hardcoded production credentials, or uncontrolled executors.

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
