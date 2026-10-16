def call(Map cfg = [:]) {
    def workerUrl = env.CENTRAL_CICD_DEPLOY_WORKER_URL
    def tokenCredentialId =
        env.CENTRAL_CICD_DEPLOY_WORKER_TOKEN_CREDENTIALS_ID

    if (!workerUrl?.trim()) {
        error 'Missing CENTRAL_CICD_DEPLOY_WORKER_URL'
    }
    if (!tokenCredentialId?.trim()) {
        error 'Missing CENTRAL_CICD_DEPLOY_WORKER_TOKEN_CREDENTIALS_ID'
    }

    def payload = [
        schemaVersion: 1,
        projectId: cfg.projectId,
        environment: cfg.environment ?: 'production',
        commitSha: cfg.commitSha,
        artifact: [
            path: cfg.artifactPath,
            sha256: cfg.artifactSha256
        ],
        targetId: cfg.targetId,
        requestedBy: 'jenkins',
        jenkinsBuild: env.BUILD_NUMBER,
        dryRun: cfg.dryRun == true
    ]

    writeFile(
        file: '.central-cicd-deploy-request.json',
        text: groovy.json.JsonOutput.toJson(payload)
    )

    withCredentials([
        string(
            credentialsId: tokenCredentialId,
            variable: 'DEPLOY_WORKER_TOKEN'
        )
    ]) {
        withEnv(["DEPLOY_WORKER_URL=${workerUrl.replaceAll('/+$', '')}"]) {
            sh '''
                set -eu
                response=$(curl --silent --show-error --write-out '\nHTTP_STATUS=%{http_code}' \
                  -X POST "$DEPLOY_WORKER_URL/deploy" \
                  -H "Authorization: Bearer $DEPLOY_WORKER_TOKEN" \
                  -H "Content-Type: application/json" \
                  --data-binary @.central-cicd-deploy-request.json)
                printf '%s\n' "$response"
                status=$(printf '%s\n' "$response" | sed -n 's/^HTTP_STATUS=//p' | tail -n 1)
                test "$status" -ge 200 -a "$status" -lt 300
            '''
        }
    }
}
