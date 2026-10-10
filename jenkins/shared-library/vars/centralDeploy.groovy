def call(Map cfg = [:]) {
    def payload = [
        schemaVersion: 1,
        projectId: cfg.projectId,
        environment: cfg.environment ?: 'production',
        commitSha: cfg.commitSha,
        artifact: [path: cfg.artifactPath, sha256: cfg.artifactSha256],
        targetId: cfg.targetId,
        requestedBy: 'jenkins',
        jenkinsBuild: env.BUILD_NUMBER,
        dryRun: cfg.dryRun == true
    ]
    def json = groovy.json.JsonOutput.toJson(payload)
    writeFile file: '.central-cicd-deploy-request.json', text: json
    sh '''
      curl --fail-with-body --silent --show-error \
        -X POST "$DEPLOY_WORKER_URL/deploy" \
        -H "Authorization: Bearer $DEPLOY_WORKER_TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary @.central-cicd-deploy-request.json
    '''
}
