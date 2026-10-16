# Jenkins Configuration as Code — design notes

Phase 2 intentionally does not hard-code a central repository URL or credentials.
When the central CI/CD repository has a permanent Git URL, Jenkins should register
that repository as a **Global Pipeline Library** named `central-cicd-lib`.
Because this repository keeps the Shared Library under `jenkins/shared-library/`,
the Jenkins Global Pipeline Library **Library path** must be set to
`jenkins/shared-library`. Leaving Library path blank makes Jenkins treat the
repository root as the library root, where there is no top-level `vars/`
directory.

Required Jenkins concepts:
- built-in node executors: 0
- general build agent label: `linux-build` (non-Compose builds only)
- Loomrun Compose build agent label: `loomrun-docker-build`
- restricted production handoff agent label: `production-deploy`
- one generic job: `central-cicd-build`
- global shared library: `central-cicd-lib`
- global shared library path: `jenkins/shared-library`
- protected administrator environment variable `CENTRAL_CICD_CONFIG_REPOSITORY`, set to the HTTPS GitHub URL for this central repository
- protected administrator environment variable `CENTRAL_CICD_CONFIG_REF`, set to a reviewed full 40-character commit SHA, never `main` or another mutable ref
- optional protected administrator environment variable `CENTRAL_CICD_CONFIG_CREDENTIALS_ID`, set to a Jenkins credential ID only if the central `exorasolutions/Exora-CI-CD` repository is private
- optional protected administrator environment variable `CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127`, set to a Jenkins credential ID only if approved `yeshwanth1127` application repositories are private
- protected administrator environment variable `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=false`

The `loomrun-docker-build` node is a dedicated, isolated Jenkins agent for the
Loomrun candidate image build. It must not be the production host and must not
mount `/var/run/docker.sock` or any production Docker socket. Configure the
Jenkins service account with a rootless Docker daemon and set these node-scoped
environment values:

- `CENTRAL_CICD_BUILD_AGENT_CLASS=loomrun-isolated-docker`
- `DOCKER_HOST=unix:///run/user/<jenkins-uid>/docker.sock`

Install the Docker CLI and Docker Compose v2 on that node, enable the rootless
daemon for the Jenkins service account, and verify `docker info` succeeds as
that account. The shared library checks all of these requirements before
install, tests, or the Compose image build. If the node is absent or does not
meet the contract, Jenkins fails with an actionable message and never reaches
the Build stage.

No application repository needs a Jenkinsfile.

The generic job must not expose these values as build parameters. They should be
managed by Jenkins administrators through global properties, folder properties,
or equivalent protected Configuration as Code. This repository intentionally does
not embed credentials or a mutable branch pin.

For private GitHub repositories, create credentials in Jenkins first, for example
with a fine-grained personal access token or deploy key with the minimum required
repository read scope. GitHub collaborator access by itself does not give Jenkins
a credential. Public repositories may use anonymous checkout by leaving the
corresponding credential ID unset.
