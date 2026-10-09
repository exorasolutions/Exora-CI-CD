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
                validateArtifactPath(profile.artifactPath as String)
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
              }
              sh profile.install
            }
          }

          stage('Test') {
            when { expression { cfg.testsRequired != false } }
            steps { sh profile.test }
          }

          stage('Build') {
            steps {
              script {
                prepareProfileHelpers(profile)
              }
              sh profile.build
            }
          }

          stage('Package artifact') {
            steps {
              script {
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
        when { expression { deploymentEnabled && cfg.deploymentMode == 'manual' } }
        steps {
          input(
            message: "Deploy ${cfg.projectId} @ ${cfg.commitSha} to ${cfg.environment ?: 'production'}?",
            ok: 'Deploy',
            submitterParameter: 'APPROVED_BY'
          )
        }
      }

      stage('Deployment handoff') {
        when { expression { deploymentEnabled } }
        agent { label cfg.deployAgentLabel ?: 'production-deploy' }
        steps {
          deleteDir()
          unstash 'release-artifact'
          sh "sha256sum -c '${artifactName}.sha256'"
          echo "Phase 2 safe handoff only: ${cfg.projectId} ${artifactName} -> ${cfg.targetId} (${cfg.deploymentAdapter})"
          echo 'Real deployment remains disabled until target registry + authenticated deploy-worker phase.'
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
}

private Map loadBuildProfile(Map cfg) {
  def id = cfg.buildProfile as String
  def allowed = ['node-npm-v1', 'node-pnpm-v1', 'python-v1']
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
  def required = ['id', 'version', 'runtime', 'lockfileRequired', 'install', 'test', 'build', 'artifactPath']
  required.each { key ->
    if (!profile.containsKey(key)) error("Malformed build profile ${expectedId}: missing ${key}")
  }
  if (profile.id != expectedId) error("Build profile id mismatch: expected ${expectedId}, got ${profile.id}")
  if (profile.version != 1) error("Unsupported build profile version for ${expectedId}: ${profile.version}")
  validateRuntimeProfileCombination(expectedId, profile.runtime as String)
  ['install', 'test', 'build'].each { key ->
    if (!(profile[key] instanceof String) || !(profile[key] as String).trim()) {
      error("Malformed build profile ${expectedId}: ${key} must be a non-empty string")
    }
  }
  if (!(profile.lockfileRequired instanceof Boolean)) {
    error("Malformed build profile ${expectedId}: lockfileRequired must be boolean")
  }
  validateArtifactPath(profile.artifactPath as String)
  return profile
}

private void validateRuntimeProfileCombination(String profileId, String runtime) {
  def expectedRuntimeByProfile = [
    'node-npm-v1': 'node',
    'node-pnpm-v1': 'node',
    'python-v1': 'python'
  ]
  if (!expectedRuntimeByProfile.containsKey(profileId)) {
    error("Unsupported build profile: ${profileId}")
  }
  if (expectedRuntimeByProfile[profileId] != runtime) {
    error("Unsupported runtime/profile combination: ${profileId} requires ${expectedRuntimeByProfile[profileId]}, got ${runtime}")
  }
}

private void prepareProfileHelpers(Map profile) {
  if (profile.id != 'python-v1') return
  sh 'mkdir -p .central-cicd'
  writeFile file: '.central-cicd/package-python-source.py',
    text: libraryResource('scripts/package-python-source.py')
}

private void enforceLockfilePolicy(Map profile) {
  if (profile.lockfileRequired != true) return
  def lockfileByProfile = [
    'node-npm-v1': 'package-lock.json',
    'node-pnpm-v1': 'pnpm-lock.yaml'
  ]
  def lockfile = lockfileByProfile[profile.id as String]
  if (!lockfile) {
    error("No lockfile policy is defined for ${profile.id}")
  }
  if (!fileExists(lockfile)) {
    error("Required lockfile is missing for ${profile.id}: ${lockfile}")
  }
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
  requireMatch('artifactPath', artifactPath, /^[A-Za-z0-9._\/-]{1,160}$/)
  if (artifactPath.startsWith('/') || artifactPath.contains('\\') || artifactPath == '.' ||
      artifactPath == '..' || artifactPath.contains('../') || artifactPath.contains('/..')) {
    error("Unsafe artifactPath: ${artifactPath}")
  }
}

private void validateArtifactName(String artifactName) {
  requireMatch('artifactName', artifactName, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.tar\.gz$/)
}

private boolean deploymentExecutionEnabled() {
  def enabled = (env.CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED ?: 'false').trim()
  if (!['true', 'false'].contains(enabled)) {
    error('Invalid administrator setting CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED. Expected true or false.')
  }
  if (enabled == 'true') {
    error('Deployment execution is not implemented or permitted by this shared-library version.')
  }
  return false
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
  def value = env[name]
  if (value == null || !value.trim()) return ''
  requireMatch(name, value.trim(), /^[A-Za-z0-9_.@:-]{1,128}$/)
  return value.trim()
}

private String githubOwner(String url) {
  def matcher = (url =~ /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/[A-Za-z0-9_.-]+(\.git)?$/)
  if (!matcher.matches()) {
    error("Invalid repository URL: ${url}")
  }
  return matcher[0][1]
}

private String requireAdminEnv(String name) {
  def value = env[name]
  if (!(value instanceof String) || !value.trim()) {
    error("Missing required Jenkins administrator configuration ${name}. Configure it as a protected Jenkins global or folder environment variable, not as a job parameter.")
  }
  return value.trim()
}

private String shellQuote(String value) {
  return "'${value.replace("'", "'\"'\"'")}'"
}
