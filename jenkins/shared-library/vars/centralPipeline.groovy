def call(Map cfg = [:]) {
  validatePipelineConfig(cfg)
  def profile = [:]
  def artifactName = "${cfg.projectId}-${env.BUILD_NUMBER}.tar.gz"
  validateArtifactName(artifactName)
  def deploymentEnabled = deploymentExecutionEnabled()

  pipeline {
    agent none
    options {
      timestamps()
      disableConcurrentBuilds()
      skipDefaultCheckout(true)
      timeout(time: (cfg.timeoutMinutes ?: 30) as int, unit: 'MINUTES')
      buildDiscarder(logRotator(numToKeepStr: '50', artifactNumToKeepStr: '20'))
    }

    stages {
      stage('Build on isolated agent') {
        agent { label cfg.agentLabel ?: 'linux-build' }
        stages {
          stage('Load central build profile') {
            steps {
              script {
                profile = loadBuildProfile(cfg)
              }
            }
          }

          stage('Checkout exact commit') {
            steps {
              deleteDir()
              checkout([
                $class: 'GitSCM',
                branches: [[name: cfg.commitSha]],
                userRemoteConfigs: [appRepositoryRemoteConfig(cfg.repository as String)],
                extensions: [[$class: 'CleanBeforeCheckout']]
              ])
              sh 'git rev-parse HEAD'
              script {
                def actual = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                if (actual != cfg.commitSha) {
                  error("Checkout mismatch: expected ${cfg.commitSha}, got ${actual}")
                }
              }
            }
          }

          stage('Install') {
            steps {
              script {
                enforceLockfilePolicy(profile)
                runInstall(profile)
              }
            }
          }

          stage('Test') {
            when { expression { cfg.testsRequired != false } }
            steps {
              script {
                runTests(profile)
              }
            }
          }

          stage('Build') {
            steps {
              script {
                prepareProfileHelpers(profile)
                runBuild(profile)
              }
            }
          }

          stage('Package artifact') {
            steps {
              script {
                prepareArtifact(profile)
                packageArtifact(profile.artifactPath as String, artifactName)
              }
              archiveArtifacts artifacts: "${artifactName},${artifactName}.sha256", fingerprint: true, onlyIfSuccessful: true
              stash name: 'release-artifact', includes: "${artifactName},${artifactName}.sha256", useDefaultExcludes: false
            }
          }
        }
      }

      stage('Deployment disabled') {
        when { expression { !deploymentEnabled } }
        steps {
          echo 'Deployment execution skipped: central deployment execution flag is disabled.'
          echo 'No deployment agent, deploy worker, or deployment adapter will be contacted.'
        }
      }

      stage('Manual approval') {
        when {
          expression {
            deploymentEnabled &&
            cfg.deploymentMode == 'manual' &&
            optionalAdminEnv('CENTRAL_CICD_DEPLOY_DRY_RUN') != 'true'
          }
        }
        steps {
          input(
            message: "Deploy ${cfg.projectId} @ ${cfg.commitSha} to ${cfg.environment ?: 'production'}?",
            ok: 'Deploy',
            submitterParameter: 'APPROVED_BY'
          )
        }
      }

      stage('Deployment handoff') {
        when {
          beforeAgent true
          expression { deploymentEnabled }
        }
        steps {
          script {
            node(cfg.deployAgentLabel ?: 'production-deploy') {
              deleteDir()
              unstash 'release-artifact'
              sh "sha256sum -c ${shellQuote("${artifactName}.sha256")}"
              def artifactSha256 = readFile("${artifactName}.sha256").trim().substring(0, 64)
              def stagingRoot = requireAdminEnv('CENTRAL_CICD_DEPLOY_ARTIFACT_STAGING_ROOT')
              validateAbsolutePath(stagingRoot, 'CENTRAL_CICD_DEPLOY_ARTIFACT_STAGING_ROOT')
              def stagingDir = "${stagingRoot}/${cfg.projectId}/${env.BUILD_NUMBER}"
              sh '''
                echo "=== HANDOFF USER ==="
                id
                echo "=== HANDOFF PATHS ==="
                ls -ldn /opt /opt/cicd /opt/cicd/artifacts
                echo "=== HANDOFF MOUNT ==="
                grep "/opt/cicd/artifacts" /proc/mounts || true
                echo "=== HANDOFF WRITE TEST ==="
                touch /opt/cicd/artifacts/.jenkins-handoff-test
                rm /opt/cicd/artifacts/.jenkins-handoff-test
                echo "HANDOFF_WRITE_TEST=PASS"
              '''
              sh "mkdir -p ${shellQuote(stagingDir)} && cp ${shellQuote(artifactName)} ${shellQuote("${artifactName}.sha256")} ${shellQuote(stagingDir)}/"
              def dryRun = optionalAdminEnv('CENTRAL_CICD_DEPLOY_DRY_RUN') == 'true'
              centralDeploy(
                projectId: cfg.projectId,
                environment: cfg.environment ?: 'production',
                commitSha: cfg.commitSha,
                artifactPath: "${stagingDir}/${artifactName}",
                artifactSha256: artifactSha256,
                targetId: cfg.targetId,
                dryRun: dryRun
              )
            }
          }
        }
      }
    }

    post {
      always {
        echo "central-cicd result=${currentBuild.currentResult} project=${cfg.projectId} sha=${cfg.commitSha} delivery=${cfg.deliveryId}"
      }
    }
  }
}

private void validatePipelineConfig(Map cfg) {
  requireMatch('projectId', cfg.projectId, /^[a-z0-9][a-z0-9-]{1,62}$/)
  requireRepositoryUrl(cfg.repository)
  requireMatch('commitSha', cfg.commitSha, /^[0-9a-fA-F]{40}$/)
  requireMatch('buildProfile', cfg.buildProfile, /^[a-z0-9][a-z0-9-]{1,63}$/)
  if (cfg.agentLabel) requireMatch('agentLabel', cfg.agentLabel, /^[A-Za-z0-9_.-]{1,64}$/)
  if (cfg.deployAgentLabel) requireMatch('deployAgentLabel', cfg.deployAgentLabel, /^[A-Za-z0-9_.-]{1,64}$/)
  if (cfg.deploymentMode && !['manual', 'automatic'].contains(cfg.deploymentMode)) {
    error("Invalid deploymentMode: ${cfg.deploymentMode}")
  }
  if (cfg.targetId) requireMatch('targetId', cfg.targetId, /^[a-zA-Z0-9_.-]{1,128}$/)
  if (cfg.environment) requireMatch('environment', cfg.environment, /^[a-zA-Z0-9_.-]{1,64}$/)
  enforceProjectDeploymentPolicy(cfg)
}

private void enforceProjectDeploymentPolicy(Map cfg) {
  if (cfg.projectId == 'exora') {
    if (!(cfg.repository ==~ /^https:\/\/github\.com\/yeshwanth1127\/exora(\.git)?$/)) {
      error("Invalid Exora repository: ${cfg.repository}")
    }
    if (cfg.buildProfile != 'node-npm-exora-monorepo-v1') {
      error("Invalid Exora build profile: ${cfg.buildProfile}")
    }
    if (cfg.targetId != 'exora-production') {
      error("Invalid Exora deployment target: ${cfg.targetId}")
    }
    if (cfg.deploymentAdapter != 'exora-production') {
      error("Invalid Exora deployment adapter: ${cfg.deploymentAdapter}")
    }
    if ((cfg.environment ?: 'production') != 'production') {
      error("Invalid Exora environment: ${cfg.environment}")
    }
  }
}

private Map loadBuildProfile(Map cfg) {
  def id = cfg.buildProfile as String
  def allowed = ['node-npm-v1', 'node-pnpm-v1', 'python-v1', 'node-npm-exora-monorepo-v1']
  if (!allowed.contains(id)) {
    error("Unknown centrally-approved build profile: ${id}")
  }

  def centralRepo = requireAdminEnv('CENTRAL_CICD_CONFIG_REPOSITORY')
  def centralRef = requireAdminEnv('CENTRAL_CICD_CONFIG_REF')
  requireCentralConfigRepositoryUrl(centralRepo)
  requireMatch('centralConfigRef', centralRef, /^[0-9a-fA-F]{40}$/)

  def configDir = ".central-cicd-config-${env.BUILD_TAG ?: env.BUILD_NUMBER}".replaceAll(/[^A-Za-z0-9_.-]/, '-')
  def profile
  dir(configDir) {
    deleteDir()
    checkout([
      $class: 'GitSCM',
      branches: [[name: centralRef]],
      userRemoteConfigs: [centralRepositoryRemoteConfig(centralRepo)],
      extensions: [[$class: 'CleanBeforeCheckout']]
    ])
    def actual = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
    if (actual != centralRef) {
      error("Central config checkout mismatch: expected ${centralRef}, got ${actual}")
    }
    def profileFile = "config/build-profiles/${id}.yaml"
    if (!fileExists(profileFile)) {
      error("Missing centrally-approved build profile YAML: ${profileFile}")
    }
    profile = readYaml file: profileFile
  }
  return validateBuildProfile(id, profile)
}

private Map validateBuildProfile(String expectedId, Object rawProfile) {
  if (!(rawProfile instanceof Map)) error("Malformed build profile ${expectedId}: expected YAML mapping")
  def profile = rawProfile as Map
  def required = profile.monorepo == true
    ? ['id', 'version', 'runtime', 'lockfileRequired', 'monorepo', 'artifactPath', 'packages']
    : ['id', 'version', 'runtime', 'lockfileRequired', 'install', 'test', 'build', 'artifactPath']
  required.each { key ->
    if (!profile.containsKey(key)) error("Malformed build profile ${expectedId}: missing ${key}")
  }
  if (profile.id != expectedId) error("Build profile id mismatch: expected ${expectedId}, got ${profile.id}")
  if (profile.version != 1) error("Unsupported build profile version for ${expectedId}: ${profile.version}")
  validateRuntimeProfileCombination(expectedId, profile.runtime as String)
  if (!(profile.lockfileRequired instanceof Boolean)) {
    error("Malformed build profile ${expectedId}: lockfileRequired must be boolean")
  }
  validateArtifactPath(profile.artifactPath as String)
  if (profile.monorepo == true) {
    validateMonorepoProfile(expectedId, profile)
    return profile
  }
  ['install', 'test', 'build'].each { key ->
    def command = profile.get(key)
    if (!(command instanceof String) || !(command as String).trim()) {
      error("Malformed build profile ${expectedId}: ${key} must be a non-empty string")
    }
  }
  return profile
}

private void validateRuntimeProfileCombination(String profileId, String runtime) {
  def expectedRuntimeByProfile = [
    'node-npm-v1': 'node',
    'node-pnpm-v1': 'node',
    'python-v1': 'python',
    'node-npm-exora-monorepo-v1': 'node'
  ]
  if (!expectedRuntimeByProfile.containsKey(profileId)) {
    error("Unsupported build profile: ${profileId}")
  }
  def expectedRuntime = expectedRuntimeByProfile.get(profileId)
  if (expectedRuntime != runtime) {
    error("Unsupported runtime/profile combination: ${profileId} requires ${expectedRuntime}, got ${runtime}")
  }
}

private void validateMonorepoProfile(String profileId, Map profile) {
  if (profileId != 'node-npm-exora-monorepo-v1') {
    error("Monorepo profile is not approved for ${profileId}")
  }
  if (!(profile.packages instanceof List) || profile.packages.isEmpty()) {
    error("Malformed build profile ${profileId}: packages must be a non-empty list")
  }
  def names = []
  def targets = []
  profile.packages.each { pkg ->
    if (!(pkg instanceof Map)) error("Malformed build profile ${profileId}: package entry must be a mapping")
    ['name', 'workingDir', 'lockfile', 'install', 'artifactTarget'].each { key ->
      if (!pkg.containsKey(key)) error("Malformed build profile ${profileId}: package missing ${key}")
    }
    requireMatch('package.name', pkg.name, /^[a-z0-9][a-z0-9-]{0,63}$/)
    if ((pkg.workingDir as String).contains('exora-crm') || (pkg.artifactTarget as String).contains('crm')) {
      error('exora-crm is not an approved deployment component')
    }
    if (names.contains(pkg.name as String)) {
      error("Duplicate monorepo package name: ${pkg.name}")
    }
    names.add(pkg.name as String)
    validateSafeRelativePath(pkg.workingDir as String, 'package.workingDir')
    validateSafeRelativePath(pkg.lockfile as String, 'package.lockfile')
    validateSafeRelativePath(pkg.artifactTarget as String, 'package.artifactTarget')
    if (targets.contains(pkg.artifactTarget as String)) {
      error("Duplicate monorepo artifact target: ${pkg.artifactTarget}")
    }
    targets.add(pkg.artifactTarget as String)
    validateMonorepoArtifactSelection(pkg)
    validateApprovedMonorepoCommand(pkg.install as String, true)
    validateApprovedMonorepoCommand(pkg.get('test') as String, false)
    validateApprovedMonorepoCommand(pkg.get('build') as String, false)
    if (pkg.lockfile != 'package-lock.json') {
      error("Unsupported lockfile for ${pkg.name}: ${pkg.lockfile}")
    }
  }
}

private void validateMonorepoArtifactSelection(Map pkg) {
  def hasArtifactPath = pkg.containsKey('artifactPath')
  def hasArtifactIncludes = pkg.containsKey('artifactIncludes')
  if (hasArtifactPath == hasArtifactIncludes) {
    error("Package ${pkg.name} must define exactly one of artifactPath or artifactIncludes")
  }
  if (hasArtifactPath) {
    validateSafeRelativePath(pkg.artifactPath as String, 'package.artifactPath')
    return
  }
  if (!(pkg.artifactIncludes instanceof List) || pkg.artifactIncludes.isEmpty()) {
    error("Package ${pkg.name} artifactIncludes must be a non-empty list")
  }
  def includes = []
  pkg.artifactIncludes.each { includePath ->
    validateSafeRelativePath(includePath as String, 'package.artifactIncludes')
    if (includePath == '.') {
      error("Package ${pkg.name} artifactIncludes may not include the entire package directory")
    }
    if (includes.contains(includePath as String)) {
      error("Package ${pkg.name} has duplicate artifact include: ${includePath}")
    }
    includes.add(includePath as String)
  }
}

private void validateApprovedMonorepoCommand(String command, boolean required) {
  if (!command || !command.trim()) {
    if (required) error('Required monorepo command is missing')
    return
  }
  if (!['npm ci', 'npm test', 'npm run build'].contains(command)) {
    error("Unsupported monorepo command: ${command}")
  }
}

private void prepareProfileHelpers(Map profile) {
  if (profile.id != 'python-v1') return
  sh 'mkdir -p .central-cicd'
  writeFile file: '.central-cicd/package-python-source.py',
    text: libraryResource('scripts/package-python-source.py')
}

private void enforceLockfilePolicy(Map profile) {
  if (profile.monorepo == true) {
    profile.packages.each { pkg ->
      def packageJsonPath = "${pkg.workingDir}/package.json"
      if (!fileExists(packageJsonPath)) {
        error("Required package manifest is missing for ${pkg.name}: ${packageJsonPath}")
      }
      def lockfilePath = "${pkg.workingDir}/${pkg.lockfile}"
      if (!fileExists(lockfilePath)) {
        error("Required lockfile is missing for ${pkg.name}: ${lockfilePath}")
      }
    }
    return
  }
  if (profile.lockfileRequired != true) return
  def lockfileByProfile = [
    'node-npm-v1': 'package-lock.json',
    'node-pnpm-v1': 'pnpm-lock.yaml'
  ]
  def lockfile = lockfileByProfile.get(profile.id as String)
  if (!lockfile) {
    error("No lockfile policy is defined for ${profile.id}")
  }
  if (!fileExists(lockfile)) {
    error("Required lockfile is missing for ${profile.id}: ${lockfile}")
  }
}

private void runInstall(Map profile) {
  if (profile.monorepo == true) {
    runMonorepoCommand(profile, 'install')
    return
  }
  sh profile.install
}

private void runTests(Map profile) {
  if (profile.monorepo == true) {
    runMonorepoCommand(profile, 'test')
    return
  }
  sh profile.test
}

private void runBuild(Map profile) {
  if (profile.monorepo == true) {
    runMonorepoCommand(profile, 'build')
    return
  }
  sh profile.build
}

private void runMonorepoCommand(Map profile, String key) {
  def ran = false
  profile.packages.each { pkg ->
    def command = pkg.get(key)
    if (!(command instanceof String) || !command.trim()) {
      echo "Skipping ${key} for ${pkg.name}: no ${key} command configured in central profile."
      return
    }
    ran = true
    def quotedDir = shellQuote(pkg.workingDir as String)
    echo "Running ${key} for ${pkg.name} in ${pkg.workingDir}: ${command}"
    sh "cd ${quotedDir} && ${command}"
  }
  if (!ran) {
    echo "No monorepo ${key} commands configured in central profile."
  }
}

private void prepareArtifact(Map profile) {
  if (profile.monorepo != true) return
  def root = profile.artifactPath as String
  sh "rm -rf ${shellQuote(root)} && mkdir -p ${shellQuote(root)}"
  profile.packages.each { pkg ->
    copyMonorepoArtifact(pkg, root)
  }
}

private void copyMonorepoArtifact(Map pkg, String root) {
  def target = "${root}/${pkg.artifactTarget}"
  sh "mkdir -p ${shellQuote(target)}"
  if (pkg.containsKey('artifactIncludes')) {
    pkg.artifactIncludes.each { includePath ->
      copyMonorepoArtifactPath("${pkg.workingDir}/${includePath}", target)
    }
    return
  }
  def source = "${pkg.workingDir}/${pkg.artifactPath}"
  copyMonorepoArtifactPath(source, target)
}

private void copyMonorepoArtifactPath(String source, String target) {
  sh """
    set -eu
    test -e ${shellQuote(source)}
    test ! -L ${shellQuote(source)}
    if find ${shellQuote(source)} -type l -print -quit | grep -q .; then
      echo 'Configured artifact contains symlinks; refusing to package.' >&2
      exit 1
    fi
    tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='UTC 1970-01-01' \\
      --exclude='.git' --exclude='.git/**' \\
      --exclude='.svn' --exclude='.hg' \\
      --exclude='.env' --exclude='.env.*' \\
      --exclude='*/.env' --exclude='*/.env.*' \\
      --exclude='*.pem' --exclude='*.key' --exclude='*.secret' \\
      --exclude='*.p12' --exclude='*.pfx' \\
      --exclude='node_modules' --exclude='node_modules/**' \\
      --exclude='*/node_modules' --exclude='*/node_modules/**' \\
      --exclude='npm-cache' --exclude='npm-cache/**' \\
      --exclude='*/npm-cache' --exclude='*/npm-cache/**' \\
      -C ${shellQuote(parentDir(source))} -cf - ${shellQuote(baseName(source))} | tar -C ${shellQuote(target)} -xf -
  """
}

private void packageArtifact(String artifactPath, String artifactName) {
  def quotedPath = shellQuote(artifactPath)
  def quotedArtifact = shellQuote(artifactName)
  def quotedArtifactName = shellQuote(artifactName)
  def quotedChecksumName = shellQuote("${artifactName}.sha256")
  sh """
    set -eu
    test -e ${quotedPath}
    test ! -L ${quotedPath}
    if find ${quotedPath} -type l -print -quit | grep -q .; then
      echo 'Artifact contains symlinks; refusing to package.' >&2
      exit 1
    fi
    tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='UTC 1970-01-01' \\
      --exclude='.git' --exclude='.git/**' \\
      --exclude='.svn' --exclude='.hg' \\
      --exclude='.env' --exclude='.env.*' \\
      --exclude='*/.env' --exclude='*/.env.*' \\
      --exclude='node_modules' --exclude='node_modules/**' \\
      --exclude='*/node_modules' --exclude='*/node_modules/**' \\
      --exclude='.jenkins' --exclude='.jenkins/**' \\
      --exclude=${quotedArtifactName} --exclude=${quotedChecksumName} \\
      -czf ${quotedArtifact} ${quotedPath}
    sha256sum ${quotedArtifact} | tee ${quotedArtifact}.sha256
    sha256sum -c ${quotedArtifact}.sha256
  """
}

private void validateArtifactPath(String artifactPath) {
  validateSafeRelativePath(artifactPath, 'artifactPath')
  if (artifactPath == '.') {
    error('artifactPath may not be the repository root')
  }
}

private void validateSafeRelativePath(String path, String fieldName) {
  requireMatch(fieldName, path, /^[A-Za-z0-9._\/-]{1,180}$/)
  if (path.startsWith('/') || path.contains('\\') ||
      path == '..' || path.contains('../') || path.contains('/..')) {
    error("Unsafe ${fieldName}: ${path}")
  }
}

private String parentDir(String path) {
  def index = path.lastIndexOf('/')
  return index >= 0 ? path.substring(0, index) : '.'
}

private String baseName(String path) {
  def index = path.lastIndexOf('/')
  return index >= 0 ? path.substring(index + 1) : path
}

private void validateArtifactName(String artifactName) {
  requireMatch('artifactName', artifactName, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.tar\.gz$/)
}

private boolean deploymentExecutionEnabled() {
  def enabled = (env.CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED ?: 'false').trim()
  if (!['true', 'false'].contains(enabled)) {
    error('Invalid administrator setting CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED. Expected true or false.')
  }
  return enabled == 'true'
}

private void requireRepositoryUrl(Object value) {
  if (!(value instanceof String)) error('repository must be a string URL')
  def url = value as String
  if (!(url ==~ /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/)) {
    error("Invalid repository URL: ${url}")
  }
}

private void requireMatch(String name, Object value, Object pattern) {
  if (!(value instanceof String) || !((value as String) ==~ pattern)) {
    error("Invalid ${name}: ${value}")
  }
}

private void requireCentralConfigRepositoryUrl(Object value) {
  requireRepositoryUrl(value)
  def url = value as String
  if (!(url ==~ /^https:\/\/github\.com\/exorasolutions\/Exora-CI-CD(\.git)?$/)) {
    error("Invalid central config repository URL: ${url}. Expected https://github.com/exorasolutions/Exora-CI-CD.git")
  }
}

private Map centralRepositoryRemoteConfig(String url) {
  return gitRemoteConfig(url, optionalCredentialId('CENTRAL_CICD_CONFIG_CREDENTIALS_ID'))
}

private Map appRepositoryRemoteConfig(String url) {
  def owner = githubOwner(url)
  if (owner != 'yeshwanth1127') {
    error("Unsupported application repository owner: ${owner}. Only yeshwanth1127 repositories are approved for this job.")
  }
  return gitRemoteConfig(url, optionalCredentialId('CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127'))
}

private Map gitRemoteConfig(String url, String credentialsId) {
  def remote = [url: url]
  if (credentialsId) {
    remote.credentialsId = credentialsId
  }
  return remote
}

private String optionalCredentialId(String name) {
  def value = adminEnvValue(name)
  if (value == null || !value.trim()) return ''
  requireMatch(name, value.trim(), /^[A-Za-z0-9_.@:-]{1,128}$/)
  return value.trim()
}

private String githubOwner(String url) {
  def matcher = (url =~ /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/[A-Za-z0-9_.-]+(\.git)?$/)
  if (!matcher.matches()) {
    error("Invalid repository URL: ${url}")
  }
  return matcher.group(1)
}

private String requireAdminEnv(String name) {
  def value = adminEnvValue(name)
  if (!(value instanceof String) || !value.trim()) {
    error("Missing required Jenkins administrator configuration ${name}. Configure it as a protected Jenkins global or folder environment variable, not as a job parameter.")
  }
  return value.trim()
}

private String optionalAdminEnv(String name) {
  def value = adminEnvValue(name)
  return value instanceof String ? value.trim() : ''
}

private String adminEnvValue(String name) {
  if (name == 'CENTRAL_CICD_CONFIG_REPOSITORY') {
    return env.CENTRAL_CICD_CONFIG_REPOSITORY
  }
  if (name == 'CENTRAL_CICD_CONFIG_REF') {
    return env.CENTRAL_CICD_CONFIG_REF
  }
  if (name == 'CENTRAL_CICD_CONFIG_CREDENTIALS_ID') {
    return env.CENTRAL_CICD_CONFIG_CREDENTIALS_ID
  }
  if (name == 'CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127') {
    return env.CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127
  }
  if (name == 'CENTRAL_CICD_DEPLOY_ARTIFACT_STAGING_ROOT') {
    return env.CENTRAL_CICD_DEPLOY_ARTIFACT_STAGING_ROOT
  }
  if (name == 'CENTRAL_CICD_DEPLOY_WORKER_URL') {
    return env.CENTRAL_CICD_DEPLOY_WORKER_URL
  }
  if (name == 'CENTRAL_CICD_DEPLOY_WORKER_TOKEN_CREDENTIALS_ID') {
    return env.CENTRAL_CICD_DEPLOY_WORKER_TOKEN_CREDENTIALS_ID
  }
  if (name == 'CENTRAL_CICD_DEPLOY_DRY_RUN') {
    return env.CENTRAL_CICD_DEPLOY_DRY_RUN
  }
  error("Unsupported administrator environment variable: ${name}")
}

private void validateAbsolutePath(String path, String fieldName) {
  requireMatch(fieldName, path, /^\/[A-Za-z0-9._\/-]{1,180}$/)
  if (path.contains('/../') || path.endsWith('/..')) {
    error("Unsafe ${fieldName}: ${path}")
  }
}

private String shellQuote(String value) {
  return "'${value.replace("'", "'\"'\"'")}'"
}
