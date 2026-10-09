def call(Map cfg = [:]) {
  def profile = buildProfile(cfg.buildProfile as String)
  def artifactName = "${cfg.projectId}-${env.BUILD_NUMBER}.tar.gz"

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
          stage('Checkout exact commit') {
            steps {
              deleteDir()
              checkout([
                $class: 'GitSCM',
                branches: [[name: cfg.commitSha]],
                userRemoteConfigs: [[url: cfg.repository]],
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
            steps { sh profile.install }
          }

          stage('Test') {
            when { expression { cfg.testsRequired != false } }
            steps { sh profile.test }
          }

          stage('Build') {
            steps { sh profile.build }
          }

          stage('Package artifact') {
            steps {
              sh "test -e '${profile.artifactPath}'"
              sh "tar -czf '${artifactName}' '${profile.artifactPath}'"
              sh "sha256sum '${artifactName}' | tee '${artifactName}.sha256'"
              archiveArtifacts artifacts: "${artifactName},${artifactName}.sha256", fingerprint: true, onlyIfSuccessful: true
              stash name: 'release-artifact', includes: "${artifactName},${artifactName}.sha256", useDefaultExcludes: false
            }
          }
        }
      }

      stage('Manual approval') {
        when { expression { cfg.deploymentMode == 'manual' } }
        steps {
          input(
            message: "Deploy ${cfg.projectId} @ ${cfg.commitSha} to ${cfg.environment ?: 'production'}?",
            ok: 'Deploy',
            submitterParameter: 'APPROVED_BY'
          )
        }
      }

      stage('Deployment handoff') {
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

private Map buildProfile(String id) {
  def profiles = [
    'node-npm-v1': [
      install: 'npm ci',
      test: 'npm test',
      build: 'npm run build',
      artifactPath: 'dist'
    ],
    'node-pnpm-v1': [
      install: 'corepack enable && pnpm install --frozen-lockfile',
      test: 'pnpm test',
      build: 'pnpm build',
      artifactPath: 'dist'
    ],
    'python-v1': [
      install: 'python3 -m pip install -r requirements.txt',
      test: 'python3 -m pytest',
      build: 'mkdir -p artifact && cp -a . artifact/source',
      artifactPath: 'artifact'
    ]
  ]
  if (!profiles.containsKey(id)) {
    error("Unknown centrally-approved build profile: ${id}")
  }
  return profiles[id]
}
