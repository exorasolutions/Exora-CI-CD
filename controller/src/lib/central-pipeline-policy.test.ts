import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  approvedProfileIds,
  deploymentExecutionEnabledFromAdminEnv,
  lockfileForProfile,
  lockfilesForMonorepoProfile,
  parseBuildProfileYaml,
  validateArtifactName,
  validateArtifactPath,
  validateBuildProfile,
  validateCommitSha,
  validateRepositoryUrl
} from './build-profile-policy.js';
import { ProjectFile } from './project-registry.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profileDir = join(repoRoot, 'config/build-profiles');
const pipelinePath = join(repoRoot, 'jenkins/shared-library/vars/centralPipeline.groovy');
const deployPath = join(repoRoot, 'jenkins/shared-library/vars/centralDeploy.groovy');
const jobTemplatePath = join(repoRoot, 'jenkins/job-templates/central-cicd-build.xml.template');
const pythonPackageHelperPath = join(repoRoot, 'jenkins/shared-library/resources/scripts/package-python-source.py');
const projectDir = join(repoRoot, 'config/projects');

function assertArtifactOutput(path: string) {
  if (!existsSync(path)) throw new Error('missing artifact output');
}

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('loads and validates each centrally approved build profile', () => {
  for (const id of approvedProfileIds) {
    const profile = parseBuildProfileYaml(id, readFileSync(join(profileDir, `${id}.yaml`), 'utf8'));
    assert.equal(profile.id, id);
    assert.ok(profile.artifactPath);
    if (profile.monorepo) {
      assert.ok(profile.packages?.length);
    } else {
      assert.ok(profile.install);
      assert.ok(profile.test);
      assert.ok(profile.build);
    }
  }
});

test('loads every project config and maps each repository only once', () => {
  const seenProjects = new Set<string>();
  const seenRepos = new Set<string>();
  const expectedProjects = new Set([
    'cab',
    'exora',
    'exora-crm',
    'exora-shared-services',
    'loomrun',
    'qlix',
    'sunkidz'
  ]);

  for (const file of readdirSync(projectDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const parsed = ProjectFile.parse(YAML.parse(readFileSync(join(projectDir, file), 'utf8')));
    const project = parsed.project;
    assert.equal(seenProjects.has(project.id), false, `duplicate project id ${project.id}`);
    seenProjects.add(project.id);
    const repo = `${project.github.owner}/${project.github.repo}`.toLowerCase();
    assert.equal(seenRepos.has(repo), false, `duplicate repository mapping ${repo}`);
    seenRepos.add(repo);
    assert.ok(approvedProfileIds.includes(project.build.profile as typeof approvedProfileIds[number]));
    assert.equal(project.deployment.mode, 'manual');
  }

  for (const id of expectedProjects) assert.equal(seenProjects.has(id), true, `missing project ${id}`);
});

test('rejects unknown build profile id', () => {
  assert.throws(() => parseBuildProfileYaml('node-yarn-v1', 'id: node-yarn-v1'), /Unknown centrally-approved build profile/);
});

test('rejects missing required YAML fields', () => {
  assert.throws(() => validateBuildProfile('node-npm-v1', {
    id: 'node-npm-v1',
    version: 1,
    runtime: 'node',
    lockfileRequired: true,
    install: 'npm ci',
    test: 'npm test',
    artifactPath: 'dist'
  }), /missing build/);
});

test('rejects malformed YAML', () => {
  assert.throws(() => YAML.parse('id: [node-npm-v1'), /Missing flow sequence end|Flow sequence in block collection/);
});

test('validates full 40-character commit SHA only', () => {
  assert.doesNotThrow(() => validateCommitSha('0123456789abcdef0123456789ABCDEF01234567'));
  assert.throws(() => validateCommitSha('main'), /invalid commit sha/);
  assert.throws(() => validateCommitSha('0123456'), /invalid commit sha/);
  assert.throws(() => validateCommitSha('g123456789abcdef0123456789abcdef01234567'), /invalid commit sha/);
});

test('Loomrun source profile packages the verified Compose build context without secrets or data', () => {
  const profile = parseBuildProfileYaml(
    'node-npm-loomrun-compose-source-v1',
    readFileSync(join(profileDir, 'node-npm-loomrun-compose-source-v1.yaml'), 'utf8')
  );
  assert.equal(profile.artifactPath, '.central-cicd/release');
  assert.equal(profile.execution, 'loomrun-compose');
  assert.equal(profile.install, 'loomrun-compose-install');
  assert.equal(profile.test, 'loomrun-compose-test');
  assert.equal(profile.build, 'loomrun-compose-build');
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /compose\.yaml compose\.prod\.yaml apps n8n prisma scripts package\.json package-lock\.json/);
  assert.match(pipeline, /--exclude=\.env/);
  assert.match(pipeline, /--exclude=data/);
  for (const generated of [
    '__pycache__',
    '.pytest_cache',
    '.ruff_cache',
    '.mypy_cache',
    '.coverage',
    'coverage',
    'htmlcov',
    '.cache',
    '.turbo',
    '.next'
  ]) {
    assert.match(pipeline, new RegExp(`--exclude=.*${generated.replace('.', '\\.')}`));
  }
  assert.doesNotMatch(pipeline, /--exclude=\.dockerignore/);
});

test('Loomrun requires real CI checks and uses the explicit execution mode', () => {
  const project = YAML.parse(readFileSync(join(projectDir, 'loomrun.yaml'), 'utf8')).project;
  assert.equal(project.build.testsRequired, true);
  assert.equal(project.build.agentLabel, 'loomrun-docker-build');
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /stage\('Validate build agent capabilities'\)/);
  assert.match(pipeline, /validateBuildAgent\(cfg, profile\)/);
  assert.match(pipeline, /profile\.execution == 'loomrun-compose'/);
  assert.match(pipeline, /python3 -m venv \.central-cicd\/api-venv/);
  assert.match(pipeline, /pip install --disable-pip-version-check --no-cache-dir -r apps\/api\/requirements\.lock\.txt/);
  assert.match(pipeline, /pip install --disable-pip-version-check --no-cache-dir --no-deps -e apps\/api/);
  assert.match(pipeline, /export PATH="\$PWD\/\.central-cicd\/api-venv\/bin:\$PATH"/);
  assert.match(pipeline, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(pipeline, /node_modules\/.bin\/prisma generate --schema prisma\/schema\.prisma/);
  assert.match(pipeline, /python -m pytest apps\/api\/tests -q/);
  assert.match(pipeline, /npm ci --no-audit --no-fund/);
  assert.match(pipeline, /npm run lint/);
  assert.match(pipeline, /docker compose -f compose\.yaml -f compose\.prod\.yaml build --pull=false api web/);
  assert.doesNotMatch(pipeline, /node-npm-loomrun-compose-source-v1[\s\S]{0,200}install: true/);
});

test('Loomrun Compose builds fail closed without the isolated Docker agent contract', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /Loomrun requires the dedicated \$\{requiredLabel\} Jenkins agent/);
  assert.match(pipeline, /CENTRAL_CICD_BUILD_AGENT_CLASS/);
  assert.match(pipeline, /loomrun-isolated-docker/);
  assert.match(pipeline, /DOCKER_HOST/);
  assert.ok(pipeline.includes('dockerHost ==~ /^unix:\\/\\/\\/run\\/user\\/[0-9]+\\/docker\\.sock$/'));
  assert.match(pipeline, /command -v docker/);
  assert.match(pipeline, /docker compose version/);
  assert.match(pipeline, /docker info/);
  assert.doesNotMatch(pipeline, /var\/run\/docker\.sock/);
  assert.ok(pipeline.indexOf("stage('Validate build agent capabilities')") < pipeline.indexOf("stage('Install')"));
});

test('allows blank commit input but resolves and pins the trusted branch HEAD', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /stage\('Resolve application source'\)/);
  assert.match(pipeline, /loadTrustedProjectSource\(cfg\)/);
  assert.match(pipeline, /cfg\.commitSha = checkoutAndResolveCommit\(cfg, trustedSource\)/);
  assert.match(pipeline, /def requestedCommitSha = \(cfg\.commitSha \?: ''\)\.trim\(\)/);
  assert.match(pipeline, /def checkoutRef = requested \?\: "\*\/\$\{trustedSource\.branch\}"/);
  assert.match(pipeline, /git rev-parse HEAD/);
  assert.match(pipeline, /return actual/);
});

test('whitespace-only commit input is treated as blank', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /def requestedCommitSha = \(cfg\.commitSha \?: ''\)\.trim\(\)/);
  assert.match(pipeline, /def requested = \(cfg\.commitSha \?: ''\)\.trim\(\)/);
  assert.match(pipeline, /def checkoutRef = requested \?\: "\*\/\$\{trustedSource\.branch\}"/);
});

test('explicit commit input remains exact and cannot fall back to a branch', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /if \(requested && actual != requested\.toLowerCase\(\)\)/);
  assert.match(pipeline, /Checkout mismatch: expected \$\{requested\}, got \$\{actual\}/);
  assert.match(pipeline, /if \(requestedCommitSha && !\(requestedCommitSha ==~ \/\^\[0-9a-fA-F\]\{40\}\$\//);
});

test('trusted project branch and repository are resolved before application checkout', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  const sourceStage = pipeline.slice(pipeline.indexOf("stage('Resolve application source')"), pipeline.indexOf("stage('Load central build profile')"));
  assert.match(sourceStage, /loadTrustedProjectSource\(cfg\)/);
  assert.match(sourceStage, /cfg\.repository = trustedSource\.repository/);
  assert.match(sourceStage, /cfg\.commitSha = checkoutAndResolveCommit\(cfg, trustedSource\)/);
  assert.match(pipeline, /Repository does not match trusted project configuration/);
  assert.match(pipeline, /Missing trusted project configuration/);
  assert.match(pipeline, /Invalid trusted project branch/);
  assert.match(pipeline, /def repository = "https:\/\/github\.com\/\$\{github\.owner\}\/\$\{github\.repo\}\.git"\.toString\(\)/);
});

test('approval and worker handoff use the same resolved SHA', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /Deploy \$\{cfg\.projectId\} @ \$\{cfg\.commitSha\}/);
  assert.match(pipeline, /commitSha: cfg\.commitSha/);
  assert.match(pipeline, /central-cicd result=.*sha=\$\{cfg\.commitSha\}/);
});

test('validates GitHub HTTPS repository URLs', () => {
  assert.doesNotThrow(() => validateRepositoryUrl('https://github.com/example/repo.git'));
  assert.doesNotThrow(() => validateRepositoryUrl('https://github.com/example/repo'));
  assert.throws(() => validateRepositoryUrl('git@github.com:example/repo.git'), /invalid repository url/);
  assert.throws(() => validateRepositoryUrl('https://evil.example/repo.git'), /invalid repository url/);
  assert.throws(() => validateRepositoryUrl('https://github.com/example/repo.git;rm -rf /'), /invalid repository url/);
});

test('rejects unsafe artifact paths', () => {
  assert.doesNotThrow(() => validateArtifactPath('dist'));
  assert.doesNotThrow(() => validateArtifactPath('.'));
  assert.doesNotThrow(() => validateArtifactPath('artifact/source'));
  assert.doesNotThrow(() => validateArtifactName('example-project-123.tar.gz'));
  assert.throws(() => validateArtifactPath('/dist'), /unsafe artifact path/);
  assert.throws(() => validateArtifactPath('../dist'), /unsafe artifact path/);
  assert.throws(() => validateArtifactPath('dist/../secret'), /unsafe artifact path/);
  assert.throws(() => validateArtifactPath('dist;rm -rf /'), /invalid artifact path/);
  assert.throws(() => validateArtifactName('../release.tar.gz'), /invalid artifact name/);
});

test('detects missing artifact output before packaging', () => {
  const dir = join(tmpdir(), `central-cicd-missing-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  assert.throws(() => assertArtifactOutput(join(dir, 'dist')), /missing artifact output/);
  rmSync(dir, { recursive: true, force: true });
});

test('python profile copies source into artifact/source without recursive self-copy', () => {
  const profile = parseBuildProfileYaml('python-v1', readFileSync(join(profileDir, 'python-v1.yaml'), 'utf8'));
  assert.equal(profile.artifactPath, 'artifact');
  assert.equal(profile.build, 'python3 .central-cicd/package-python-source.py');
  assert.doesNotMatch(profile.build, /cp -a \. artifact\/source/);
  assert.doesNotMatch(profile.build, /python3 -c/);
});

test('python packaging helper creates artifact/source without recursion or excluded files', () => {
  const dir = join(tmpdir(), `central-cicd-python-package-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, 'artifact', 'old'), { recursive: true });
  mkdirSync(join(dir, '.git'), { recursive: true });
  mkdirSync(join(dir, '.venv'), { recursive: true });
  mkdirSync(join(dir, '__pycache__'), { recursive: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'app', 'main.py'), 'print("ok")\n');
  writeFileSync(join(dir, 'requirements.txt'), 'fastapi\n');
  writeFileSync(join(dir, 'artifact', 'old', 'recursive.txt'), 'old artifact');
  writeFileSync(join(dir, '.git', 'config'), 'git metadata');
  writeFileSync(join(dir, '.venv', 'secret.txt'), 'venv');
  writeFileSync(join(dir, '__pycache__', 'main.pyc'), 'cache');
  writeFileSync(join(dir, 'dist', 'bundle.js'), 'generated');
  writeFileSync(join(dir, '.env'), 'TOKEN=secret');
  writeFileSync(join(dir, 'nested', '.env.production'), 'TOKEN=secret');
  writeFileSync(join(dir, 'deploy.pem'), 'private');
  writeFileSync(join(dir, 'nested', 'keep.py'), 'print("keep")\n');

  try {
    execFileSync('python', [pythonPackageHelperPath], { cwd: dir, stdio: 'pipe' });
  } catch {
    execFileSync('python3', [pythonPackageHelperPath], { cwd: dir, stdio: 'pipe' });
  }

  assert.equal(existsSync(join(dir, 'artifact', 'source', 'app', 'main.py')), true);
  assert.equal(existsSync(join(dir, 'artifact', 'source', 'requirements.txt')), true);
  assert.equal(existsSync(join(dir, 'artifact', 'source', 'nested', 'keep.py')), true);
  assert.equal(existsSync(join(dir, 'artifact', 'source', 'artifact')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', '.git')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', '.venv')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', '__pycache__')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', 'dist')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', '.env')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', 'nested', '.env.production')), false);
  assert.equal(existsSync(join(dir, 'artifact', 'source', 'deploy.pem')), false);

  rmSync(dir, { recursive: true, force: true });
});

test('enforces lockfile policy by approved profile', () => {
  const npm = parseBuildProfileYaml('node-npm-v1', readFileSync(join(profileDir, 'node-npm-v1.yaml'), 'utf8'));
  const pnpm = parseBuildProfileYaml('node-pnpm-v1', readFileSync(join(profileDir, 'node-pnpm-v1.yaml'), 'utf8'));
  const python = parseBuildProfileYaml('python-v1', readFileSync(join(profileDir, 'python-v1.yaml'), 'utf8'));
  const exora = parseBuildProfileYaml('node-npm-exora-monorepo-v1', readFileSync(join(profileDir, 'node-npm-exora-monorepo-v1.yaml'), 'utf8'));
  assert.equal(lockfileForProfile(npm), 'package-lock.json');
  assert.equal(lockfileForProfile(pnpm), 'pnpm-lock.yaml');
  assert.equal(lockfileForProfile(python), null);
  assert.deepEqual(lockfilesForMonorepoProfile(exora), [
    'exora-mern/client/package-lock.json',
    'exora-mern/server/package-lock.json'
  ]);
});

test('validates exora monorepo profile package commands and artifact paths', () => {
  const profile = parseBuildProfileYaml('node-npm-exora-monorepo-v1', readFileSync(join(profileDir, 'node-npm-exora-monorepo-v1.yaml'), 'utf8'));
  assert.equal(profile.monorepo, true);
  assert.equal(profile.runtime, 'node');
  assert.equal(profile.artifactPath, '.central-cicd/release');
  assert.deepEqual(profile.packages?.map((pkg) => [pkg.name, pkg.workingDir, pkg.install, pkg.test ?? '', pkg.build ?? '', pkg.artifactPath, pkg.artifactTarget]), [
    ['marketing-client', 'exora-mern/client', 'npm ci', '', 'npm run build', 'dist', 'marketing-client'],
    ['main-server', 'exora-mern/server', 'npm ci', 'npm test', '', undefined, 'main-server']
  ]);
  const mainServer = profile.packages?.find((pkg) => pkg.name === 'main-server');
  assert.equal(profile.packages?.some((pkg) => pkg.workingDir.includes('exora-crm')), false);
  assert.deepEqual(mainServer?.artifactIncludes, [
    'package.json',
    'package-lock.json',
    'server.js',
    'config',
    'controllers',
    'data',
    'middleware',
    'migrations',
    'models',
    'public',
    'registry',
    'routes',
    'scripts',
    'services'
  ]);
});

test('rejects unsafe monorepo working directories and unapproved commands', () => {
  const base = {
    id: 'node-npm-exora-monorepo-v1',
    version: 1,
    runtime: 'node',
    lockfileRequired: true,
    monorepo: true,
    artifactPath: '.central-cicd/release',
    packages: [{
      name: 'bad-package',
      workingDir: '../outside',
      lockfile: 'package-lock.json',
      install: 'npm ci',
      artifactPath: 'dist',
      artifactTarget: 'bad-package'
    }]
  };
  assert.throws(() => validateBuildProfile('node-npm-exora-monorepo-v1', base), /unsafe artifact path/);
  assert.throws(() => validateBuildProfile('node-npm-exora-monorepo-v1', {
    ...base,
    packages: [{ ...(base.packages[0]), workingDir: 'safe/path', install: 'npm install && curl evil' }]
  }), /Unsupported monorepo command/);
  assert.throws(() => validateBuildProfile('node-npm-exora-monorepo-v1', {
    ...base,
    packages: [
      { ...(base.packages[0]), workingDir: 'safe/path', artifactPath: 'dist' },
      { ...(base.packages[0]), workingDir: 'safe/other', artifactPath: 'dist' }
    ]
  }), /Duplicate monorepo package name/);
  assert.throws(() => validateBuildProfile('node-npm-exora-monorepo-v1', {
    ...base,
    packages: [{ ...(base.packages[0]), workingDir: 'safe/path', artifactPath: 'dist', artifactIncludes: ['server.js'] }]
  }), /exactly one of artifactPath or artifactIncludes/);
  assert.throws(() => validateBuildProfile('node-npm-exora-monorepo-v1', {
    ...base,
    packages: [{
      name: 'bad-package',
      workingDir: 'safe/path',
      lockfile: 'package-lock.json',
      install: 'npm ci',
      artifactTarget: 'bad-package',
      artifactIncludes: ['.']
    }]
  }), /may not include the entire package directory/);
});

test('rejects unsupported runtime/profile combinations', () => {
  assert.throws(() => validateBuildProfile('node-npm-v1', {
    id: 'node-npm-v1',
    version: 1,
    runtime: 'python',
    lockfileRequired: true,
    install: 'npm ci',
    test: 'npm test',
    build: 'npm run build',
    artifactPath: 'dist'
  }), /Unsupported runtime\/profile combination/);
});

test('deployment execution defaults disabled and is administrator-env controlled', () => {
  assert.equal(deploymentExecutionEnabledFromAdminEnv(undefined), false);
  assert.equal(deploymentExecutionEnabledFromAdminEnv('false'), false);
  assert.equal(deploymentExecutionEnabledFromAdminEnv('true'), true);
  assert.throws(() => deploymentExecutionEnabledFromAdminEnv('yes'), /invalid deployment execution flag/);

  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /private boolean deploymentExecutionEnabled\(String projectId\)/);
  assert.match(pipeline, /CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED/);
  assert.doesNotMatch(pipeline, /cfg\.deploymentExecutionEnabled/);
  assert.doesNotMatch(pipeline, /DEPLOYMENT_MODE.*CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED/s);
  const jobTemplate = readFileSync(jobTemplatePath, 'utf8');
  assert.doesNotMatch(jobTemplate, /deploymentExecutionEnabled|CENTRAL_CICD_DEPLOYMENT_EXECUTION_ENABLED/);
});

test('manual and automatic modes skip deployment while execution is disabled', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /stage\('Deployment disabled'\)/);
  assert.match(pipeline, /when \{ expression \{ !deploymentEnabled \} \}/);
  assert.match(pipeline, /deploymentEnabled &&\s*cfg\.deploymentMode == 'manual' &&\s*optionalAdminEnv\('CENTRAL_CICD_DEPLOY_DRY_RUN'\) != 'true'/);
  assert.match(pipeline, /stage\('Deployment handoff'\)[\s\S]*when \{\s*beforeAgent true\s*expression \{ deploymentEnabled \}\s*\}/);
});

test('trusted project registry supplies and pins the deployment handoff contract', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /applyTrustedDeploymentPolicy\(cfg, project\)/);
  assert.match(pipeline, /def deployment = project\.deployment/);
  assert.match(pipeline, /if \(!cfg\.targetId\) cfg\.targetId = expectedTarget/);
  assert.match(pipeline, /if \(!cfg\.deploymentAdapter\) cfg\.deploymentAdapter = expectedAdapter/);
  assert.match(pipeline, /if \(!cfg\.environment\) cfg\.environment = expectedEnvironment/);
  assert.match(pipeline, /Deployment target does not match trusted project configuration/);
  assert.match(pipeline, /Deployment adapter does not match trusted project configuration/);
  assert.match(pipeline, /Deployment environment does not match trusted project configuration/);
});

test('disabled deployment does not require deployment agent or contact deploy worker', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  const disabledStage = pipeline.slice(pipeline.indexOf("stage('Deployment disabled')"), pipeline.indexOf("stage('Manual approval')"));
  const handoffStage = pipeline.slice(pipeline.indexOf("stage('Deployment handoff')"), pipeline.indexOf('    post {'));
  assert.doesNotMatch(disabledStage, /agent \{ label/);
  assert.doesNotMatch(disabledStage, /centralDeploy|DEPLOY_WORKER|curl/);
  assert.match(handoffStage, /beforeAgent true/);
  assert.doesNotMatch(handoffStage, /agent\s*\{/);
  assert.match(handoffStage, /node\(cfg\.deployAgentLabel \?: 'production-deploy'\)/);
  assert.ok(handoffStage.indexOf('expression { deploymentEnabled }') < handoffStage.indexOf('node(cfg.deployAgentLabel'));
  assert.match(handoffStage, /CENTRAL_CICD_DEPLOY_ARTIFACT_STAGING_ROOT/);
  assert.match(handoffStage, /centralDeploy/);
  const deploy = readFileSync(deployPath, 'utf8');
  assert.match(deploy, /CENTRAL_CICD_DEPLOY_WORKER_URL/);
  assert.match(deploy, /CENTRAL_CICD_DEPLOY_WORKER_TOKEN_CREDENTIALS_ID/);
  assert.match(deploy, /withCredentials/);
});

test('central config uses administrator env and full SHA pin', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  const jobTemplate = readFileSync(jobTemplatePath, 'utf8');
  assert.match(pipeline, /requireAdminEnv\('CENTRAL_CICD_CONFIG_REPOSITORY'\)/);
  assert.match(pipeline, /requireAdminEnv\('CENTRAL_CICD_CONFIG_REF'\)/);
  assert.match(pipeline, /requireMatch\('centralConfigRef', centralRef, \/\^\[0-9a-fA-F\]\{40\}\$\//);
  assert.doesNotMatch(jobTemplate, /centralConfigRepository|centralConfigRef/);
  assert.doesNotMatch(pipeline, /CENTRAL_CICD_CONFIG_REF.*main/);
});

test('admin env validation avoids Jenkins sandbox getAt indexing', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /private String adminEnvValue\(String name\)/);
  assert.match(pipeline, /env\.CENTRAL_CICD_CONFIG_REPOSITORY/);
  assert.match(pipeline, /env\.CENTRAL_CICD_CONFIG_REF/);
  assert.doesNotMatch(pipeline, /env\[[^\]]+\]/);
  assert.doesNotMatch(pipeline, /matcher\[[^\]]+\]/);
  assert.doesNotMatch(pipeline, /profile\[[^\]]+\]/);
});

test('checkout credential ids are administrator-managed and not webhook controlled', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  const jobTemplate = readFileSync(jobTemplatePath, 'utf8');
  assert.match(pipeline, /CENTRAL_CICD_CONFIG_CREDENTIALS_ID/);
  assert.match(pipeline, /CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_YESHWANTH1127/);
  assert.match(pipeline, /CENTRAL_CICD_APP_GITHUB_CREDENTIALS_ID_RVAMSI201_VK/);
  assert.match(pipeline, /credentialsId = credentialsId/);
  assert.match(pipeline, /credentialEnvByOwner/);
  assert.match(pipeline, /Unsupported application repository owner/);
  assert.doesNotMatch(pipeline, /cfg\.[A-Za-z0-9_]*credentials/i);
  assert.doesNotMatch(jobTemplate, /CREDENTIALS_ID|credentialsId/);
});

test('shared library pins Exora deployment parameters centrally', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /private void enforceProjectDeploymentPolicy\(Map cfg\)/);
  assert.match(pipeline, /github\\.com\\\/yeshwanth1127\\\/exora/);
  assert.match(pipeline, /node-npm-exora-monorepo-v1/);
  assert.match(pipeline, /exora-production/);
  assert.match(pipeline, /node-npm-static-site-v1/);
  assert.match(pipeline, /exora-static/);
  assert.doesNotMatch(pipeline, /exora-crm.*targetId/s);
});

test('failed tests or builds cannot proceed to deployment in declarative stage order', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.ok(pipeline.indexOf("stage('Test')") < pipeline.indexOf("stage('Build')"));
  assert.ok(pipeline.indexOf("stage('Build')") < pipeline.indexOf("stage('Package artifact')"));
  assert.ok(pipeline.indexOf("stage('Package artifact')") < pipeline.indexOf("stage('Deployment handoff')"));
});

test('creates and verifies SHA-256 checksums', () => {
  const dir = join(tmpdir(), `central-cicd-sha-${process.pid}`);
  const file = join(dir, 'artifact.tar.gz');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  writeFileSync(file, 'release artifact');
  const digest = sha256File(file);
  writeFileSync(`${file}.sha256`, `${digest}  artifact.tar.gz\n`);
  assert.equal(readFileSync(`${file}.sha256`, 'utf8').startsWith(digest), true);
  assert.notEqual(digest, sha256File(`${file}.sha256`));
  rmSync(dir, { recursive: true, force: true });
});
