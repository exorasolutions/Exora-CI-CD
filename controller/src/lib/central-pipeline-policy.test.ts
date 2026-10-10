import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profileDir = join(repoRoot, 'config/build-profiles');
const pipelinePath = join(repoRoot, 'jenkins/shared-library/vars/centralPipeline.groovy');
const jobTemplatePath = join(repoRoot, 'jenkins/job-templates/central-cicd-build.xml.template');
const pythonPackageHelperPath = join(repoRoot, 'jenkins/shared-library/resources/scripts/package-python-source.py');

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
    'exora-mern/server/package-lock.json',
    'exora-mern/exora-crm/backend/package-lock.json',
    'exora-mern/exora-crm/frontend/package-lock.json'
  ]);
});

test('validates exora monorepo profile package commands and artifact paths', () => {
  const profile = parseBuildProfileYaml('node-npm-exora-monorepo-v1', readFileSync(join(profileDir, 'node-npm-exora-monorepo-v1.yaml'), 'utf8'));
  assert.equal(profile.monorepo, true);
  assert.equal(profile.runtime, 'node');
  assert.equal(profile.artifactPath, '.central-cicd/release');
  assert.deepEqual(profile.packages?.map((pkg) => [pkg.name, pkg.workingDir, pkg.install, pkg.test ?? '', pkg.build ?? '', pkg.artifactPath, pkg.artifactTarget]), [
    ['marketing-client', 'exora-mern/client', 'npm ci', '', 'npm run build', 'dist', 'marketing-client'],
    ['main-server', 'exora-mern/server', 'npm ci', 'npm test', '', undefined, 'main-server'],
    ['crm-backend', 'exora-mern/exora-crm/backend', 'npm ci', '', '', undefined, 'crm-backend'],
    ['crm-frontend', 'exora-mern/exora-crm/frontend', 'npm ci', '', 'npm run build', 'dist', 'crm-frontend']
  ]);
  const mainServer = profile.packages?.find((pkg) => pkg.name === 'main-server');
  const crmBackend = profile.packages?.find((pkg) => pkg.name === 'crm-backend');
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
  assert.deepEqual(crmBackend?.artifactIncludes, [
    'package.json',
    'package-lock.json',
    'server.js',
    'crm.json',
    'config',
    'jobs',
    'middleware',
    'routes',
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
  assert.throws(() => deploymentExecutionEnabledFromAdminEnv('true'), /not implemented or permitted/);
  assert.throws(() => deploymentExecutionEnabledFromAdminEnv('yes'), /invalid deployment execution flag/);

  const pipeline = readFileSync(pipelinePath, 'utf8');
  assert.match(pipeline, /private boolean deploymentExecutionEnabled\(\)/);
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
  assert.match(pipeline, /when \{ expression \{ deploymentEnabled && cfg\.deploymentMode == 'manual' \} \}/);
  assert.match(pipeline, /stage\('Deployment handoff'\)[\s\S]*when \{\s*beforeAgent true\s*expression \{ deploymentEnabled \}\s*\}/);
});

test('disabled deployment does not require deployment agent or contact deploy worker', () => {
  const pipeline = readFileSync(pipelinePath, 'utf8');
  const disabledStage = pipeline.slice(pipeline.indexOf("stage('Deployment disabled')"), pipeline.indexOf("stage('Manual approval')"));
  const handoffStage = pipeline.slice(pipeline.indexOf("stage('Deployment handoff')"), pipeline.indexOf('    post {'));
  assert.doesNotMatch(disabledStage, /agent \{ label/);
  assert.doesNotMatch(disabledStage, /centralDeploy|DEPLOY_WORKER|curl/);
  assert.match(handoffStage, /beforeAgent true/);
  assert.doesNotMatch(handoffStage, /agent\s*\{/);
  assert.doesNotMatch(handoffStage, /node\s*\(/);
  assert.doesNotMatch(handoffStage, /production-deploy/);
  assert.doesNotMatch(handoffStage, /unstash|sha256sum|centralDeploy|DEPLOY_WORKER|curl/);
  assert.match(handoffStage, /Deployment handoff is disabled/);
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
  assert.match(pipeline, /credentialsId = credentialsId/);
  assert.match(pipeline, /Only yeshwanth1127 repositories are approved/);
  assert.doesNotMatch(pipeline, /cfg\.[A-Za-z0-9_]*credentials/i);
  assert.doesNotMatch(jobTemplate, /CREDENTIALS_ID|credentialsId/);
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
