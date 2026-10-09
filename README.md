# Centralized CI/CD — Consolidated Phases 1–5

This is a consolidated development scaffold for a centralized CI/CD platform using a Fastify/TypeScript control API, Jenkins, central YAML registries, a deployment worker, and release-management foundations.

## Important safety status

- This repository is a scaffold, not a production-ready installer.
- No server has been changed by creating this archive.
- Production execution must remain disabled (`DEPLOY_EXECUTION_ENABLED=false`) until the code is reviewed and tested.
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
