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
- build agent label: `linux-build`
- restricted production handoff agent label: `production-deploy`
- one generic job: `central-cicd-build`
- global shared library: `central-cicd-lib`
- global shared library path: `jenkins/shared-library`
- protected administrator environment variable `CENTRAL_CICD_CONFIG_REPOSITORY`, set to the HTTPS GitHub URL for this central repository
- protected administrator environment variable `CENTRAL_CICD_CONFIG_REF`, set to a reviewed full 40-character commit SHA, never `main` or another mutable ref
- optional protected administrator environment variable `CENTRAL_CICD_CONFIG_CREDENTIALS_ID`, set to a Jenkins credential ID only if the central `exorasolutions/Exora-CI-CD` repository is private
- optional protected administrator environment variable `CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127`, set to a Jenkins credential ID only if approved `yeshwanth1127` application repositories are private
- protected administrator environment variable `CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED=false`

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
