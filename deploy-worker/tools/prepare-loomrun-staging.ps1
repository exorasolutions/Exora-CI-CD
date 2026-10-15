param(
    [Parameter(Mandatory = $true)]
    [string]$Artifact,
    [Parameter(Mandatory = $true)]
    [string]$StagingParent,
    [string]$ApiImage = "loomrun-api:validation-20261014-01",
    [string]$WebImage = "loomrun-web:validation-20261014-01"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw $Message
}

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$parentPath = [IO.Path]::GetFullPath($StagingParent)
if (-not [IO.Path]::IsPathRooted($parentPath)) { Fail "staging parent must be absolute" }
if ($parentPath -match '(?i)(srv[\\/]apps|central-cicd[\\/]artifacts)') { Fail "staging parent resembles a production or worker path" }
if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { Fail "candidate artifact is not a regular file" }

docker info --format '{{.ServerVersion}}' | Out-Null
$suffix = Get-Date -Format "yyyyMMdd-HHmmss"
$targetId = "loomrun-staging-$suffix"
$root = Join-Path $parentPath $targetId
if (Test-Path -LiteralPath $root) { Fail "staging root already exists" }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$central = Join-Path $root ".central-cicd"
New-Item -ItemType Directory -Path $central -Force | Out-Null
$input = Join-Path $root "input"
New-Item -ItemType Directory -Path $input -Force | Out-Null
Copy-Item -LiteralPath $artifactPath -Destination (Join-Path $input "candidate.tar.gz")

$rootSlash = $root.Replace('\', '/')
$artifactInRoot = Join-Path $input "candidate.tar.gz"
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactInRoot).Hash.ToLowerInvariant()
$project = $targetId
$network = "$targetId-network"
$storageVolume = "$targetId-storage"
$databaseVolume = "$targetId-database"
$webPort = 18107
$apiPort = 18202
$password = ([guid]::NewGuid().ToString("N"))

@"
DATABASE_URL=postgresql://staging_user:$password@postgres:5432/loomrun
REDIS_URL=redis://redis:6379/0
SECRET_KEY=$([guid]::NewGuid().ToString("N"))
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
CORS_ORIGINS=http://127.0.0.1:$webPort
PUBLIC_API_URL=http://127.0.0.1:$webPort
STORAGE_DIR=/loomrun-storage
BAILEYS_SERVICE_URL=http://127.0.0.1:1
LOG_LEVEL=WARNING
LOG_AI_MESSAGES=false
JEV_ENABLED=false
QLIX_ENABLED=false
VITE_API_URL=http://127.0.0.1:$webPort
VITE_API_PUBLIC_URL=http://127.0.0.1:$webPort
POSTGRES_USER=staging_user
POSTGRES_PASSWORD=$password
POSTGRES_DB=loomrun
"@ | Set-Content -LiteralPath (Join-Path $root "staging.env") -NoNewline

@"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: staging_user
      POSTGRES_PASSWORD: $password
      POSTGRES_DB: loomrun
    volumes:
      - ${databaseVolume}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U staging_user -d loomrun"]
      interval: 3s
      timeout: 2s
      retries: 20
    networks: [default]
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 20
    networks: [default]
  api:
    image: loomrun-staging-placeholder
    env_file: ["$rootSlash/staging.env"]
    environment:
      REDIS_URL: redis://redis:6379/0
      STORAGE_DIR: /loomrun-storage
      FORWARDED_ALLOW_IPS: 172.30.107.0/24
      BAILEYS_SERVICE_URL: http://127.0.0.1:1
    volumes:
      - "$rootSlash/staging.env:/app/.env:ro"
      - ${storageVolume}:/loomrun-storage
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports: ["127.0.0.1:${apiPort}:8002"]
    networks: [default]
  web:
    image: loomrun-staging-placeholder
    depends_on:
      api:
        condition: service_healthy
    ports: ["127.0.0.1:${webPort}:80"]
    networks: [default]
networks:
  default:
    name: $network
volumes:
  ${storageVolume}:
    name: ${storageVolume}
  ${databaseVolume}:
    name: ${databaseVolume}
"@ | Set-Content -LiteralPath (Join-Path $root "staging-compose.yaml") -NoNewline

@"
services:
  api:
    image: $ApiImage
  web:
    image: $WebImage
"@ | Set-Content -LiteralPath (Join-Path $root "baseline.yaml") -NoNewline

$markerPath = Join-Path $central "staging-marker.json"
@{
    targetId = $targetId
    deploymentId = "staging-$suffix"
    createdBy = "central-cicd-staging-fixture"
} | ConvertTo-Json | Set-Content -LiteralPath $markerPath -NoNewline

$policy = [ordered]@{
    schemaVersion = 1
    deploymentId = "staging-$suffix"
    releaseId = "release-$suffix"
    projectId = "loomrun"
    targetId = $targetId
    environment = "staging"
    commitSha = "1794479691191a3d8c1b77c6062fdd950634a69b"
    artifactPath = $artifactInRoot
    artifactSha256 = $hash
    targetRoot = $root
    composeProject = $project
    composeWorkingDir = $root
    composeFiles = @((Join-Path $root "staging-compose.yaml"))
    composeServices = @("web", "api", "redis", "postgres")
    builtServices = @("api", "web")
    healthServices = @("api", "web")
    containers = @("$project-api-1", "$project-web-1")
    persistentMounts = "staging-only:$storageVolume"
    publicBindings = "127.0.0.1:${webPort}->80,127.0.0.1:${apiPort}->8002"
    preservePolicy = "preserve-disposable-env-storage-redis-network"
    candidateContextPolicy = "loomrun-source-root-v1"
    healthContract = "loomrun-web-root-api-ready-v1"
    stagingRoot = $root
    lockRoot = (Join-Path $central "locks")
    stagingNetwork = $network
    stagingVolumes = @($storageVolume, $databaseVolume)
    stagingMarker = $markerPath
} | ConvertTo-Json -Depth 5
$policyPath = Join-Path $central "staging-policy.json"
$policy | Set-Content -LiteralPath $policyPath -NoNewline

Write-Output "STAGING_ROOT=$root"
Write-Output "STAGING_POLICY=$policyPath"
Write-Output "COMPOSE_FILE=$(Join-Path $root 'staging-compose.yaml')"
Write-Output "BASELINE_FILE=$(Join-Path $root 'baseline.yaml')"
Write-Output "ARTIFACT_SHA256=$hash"
Write-Output "COMPOSE_PROJECT=$project"
Write-Output "WEB_PORT=$webPort API_PORT=$apiPort"
