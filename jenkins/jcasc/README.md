# Jenkins Configuration as Code — design notes

Phase 2 intentionally does not hard-code a central repository URL or credentials.
When the central CI/CD repository has a permanent Git URL, Jenkins should register
that repository as a **Global Pipeline Library** named `central-cicd-lib`.

Required Jenkins concepts:
- built-in node executors: 0
- build agent label: `linux-build`
- restricted production handoff agent label: `production-deploy`
- one generic job: `central-cicd-build`
- global shared library: `central-cicd-lib`

No application repository needs a Jenkinsfile.
