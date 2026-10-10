import YAML from 'yaml';

export const approvedProfileIds = ['node-npm-v1', 'node-pnpm-v1', 'python-v1', 'node-npm-exora-monorepo-v1'] as const;
export type ApprovedProfileId = typeof approvedProfileIds[number];

export type BuildProfile = {
  id: ApprovedProfileId;
  version: 1;
  runtime: 'node' | 'python';
  lockfileRequired: boolean;
  monorepo?: boolean;
  install?: string;
  test?: string;
  build?: string;
  artifactPath: string;
  packages?: MonorepoPackage[];
};

export type MonorepoPackage = {
  name: string;
  workingDir: string;
  lockfile: string;
  install: string;
  test?: string;
  build?: string;
  artifactPath?: string;
  artifactIncludes?: string[];
  artifactTarget: string;
};

const runtimeByProfile: Record<ApprovedProfileId, BuildProfile['runtime']> = {
  'node-npm-v1': 'node',
  'node-pnpm-v1': 'node',
  'python-v1': 'python',
  'node-npm-exora-monorepo-v1': 'node'
};

const lockfileByProfile: Partial<Record<ApprovedProfileId, string>> = {
  'node-npm-v1': 'package-lock.json',
  'node-pnpm-v1': 'pnpm-lock.yaml'
};

export function parseBuildProfileYaml(expectedId: string, text: string): BuildProfile {
  return validateBuildProfile(expectedId, YAML.parse(text));
}

export function validateBuildProfile(expectedId: string, raw: unknown): BuildProfile {
  if (!isApprovedProfileId(expectedId)) throw new Error(`Unknown centrally-approved build profile: ${expectedId}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Malformed build profile ${expectedId}: expected YAML mapping`);

  const profile = raw as Record<string, unknown>;
  const requiredKeys = profile.monorepo === true
    ? ['id', 'version', 'runtime', 'lockfileRequired', 'monorepo', 'artifactPath', 'packages']
    : ['id', 'version', 'runtime', 'lockfileRequired', 'install', 'test', 'build', 'artifactPath'];
  for (const key of requiredKeys) {
    if (!(key in profile)) throw new Error(`Malformed build profile ${expectedId}: missing ${key}`);
  }
  if (profile.id !== expectedId) throw new Error(`Build profile id mismatch: expected ${expectedId}, got ${String(profile.id)}`);
  if (profile.version !== 1) throw new Error(`Unsupported build profile version for ${expectedId}: ${String(profile.version)}`);
  if (profile.runtime !== runtimeByProfile[expectedId]) {
    throw new Error(`Unsupported runtime/profile combination: ${expectedId} requires ${runtimeByProfile[expectedId]}, got ${String(profile.runtime)}`);
  }
  if (typeof profile.lockfileRequired !== 'boolean') throw new Error(`Malformed build profile ${expectedId}: lockfileRequired must be boolean`);
  validateProfileArtifactPath(String(profile.artifactPath));
  if (profile.monorepo === true) {
    validateMonorepoProfile(expectedId, profile);
    return profile as BuildProfile;
  }
  for (const key of ['install', 'test', 'build']) {
    if (typeof profile[key] !== 'string' || !profile[key].trim()) {
      throw new Error(`Malformed build profile ${expectedId}: ${key} must be a non-empty string`);
    }
  }
  return profile as BuildProfile;
}

export function lockfileForProfile(profile: BuildProfile): string | null {
  if (profile.monorepo) return null;
  if (!profile.lockfileRequired) return null;
  const lockfile = lockfileByProfile[profile.id];
  if (!lockfile) throw new Error(`No lockfile policy is defined for ${profile.id}`);
  return lockfile;
}

export function lockfilesForMonorepoProfile(profile: BuildProfile): string[] {
  if (!profile.monorepo) return [];
  return (profile.packages ?? []).map((pkg) => `${pkg.workingDir}/${pkg.lockfile}`);
}

export function validateCommitSha(value: string) {
  if (!/^[0-9a-fA-F]{40}$/.test(value)) throw new Error('invalid commit sha');
}

export function validateRepositoryUrl(value: string) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(value)) {
    throw new Error('invalid repository url');
  }
}

export function validateArtifactPath(value: string) {
  if (!/^[A-Za-z0-9._/-]{1,160}$/.test(value)) throw new Error('invalid artifact path');
  if (value.startsWith('/') || value.includes('\\') || value === '..' || value.includes('../') || value.includes('/..')) {
    throw new Error('unsafe artifact path');
  }
}

export function validateProfileArtifactPath(value: string) {
  validateArtifactPath(value);
  if (value === '.') throw new Error('artifact path may not be repository root');
}

export function validateArtifactName(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.tar\.gz$/.test(value)) throw new Error('invalid artifact name');
}

export function deploymentExecutionEnabledFromAdminEnv(value: string | undefined): boolean {
  const normalized = (value ?? 'false').trim();
  if (!['true', 'false'].includes(normalized)) throw new Error('invalid deployment execution flag');
  return normalized === 'true';
}

function isApprovedProfileId(value: string): value is ApprovedProfileId {
  return (approvedProfileIds as readonly string[]).includes(value);
}

function validateMonorepoProfile(expectedId: string, profile: Record<string, unknown>) {
  if (expectedId !== 'node-npm-exora-monorepo-v1') throw new Error(`Monorepo profile is not approved for ${expectedId}`);
  if (!Array.isArray(profile.packages) || profile.packages.length === 0) throw new Error(`Malformed build profile ${expectedId}: packages must be a non-empty list`);
  const names = new Set<string>();
  const targets = new Set<string>();
  for (const entry of profile.packages) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Malformed build profile ${expectedId}: package entry must be a mapping`);
    const pkg = entry as Record<string, unknown>;
    for (const key of ['name', 'workingDir', 'lockfile', 'install', 'artifactTarget']) {
      if (!(key in pkg)) throw new Error(`Malformed build profile ${expectedId}: package missing ${key}`);
    }
    const packageName = String(pkg.name);
    const workingDir = String(pkg.workingDir);
    const artifactTarget = String(pkg.artifactTarget);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(packageName)) throw new Error('invalid package name');
    if (workingDir.includes('exora-crm') || artifactTarget.includes('crm')) throw new Error('exora-crm is not an approved deployment component');
    if (names.has(packageName)) throw new Error(`Duplicate monorepo package name: ${packageName}`);
    names.add(packageName);
    validateArtifactPath(workingDir);
    validateArtifactPath(String(pkg.lockfile));
    validateArtifactPath(artifactTarget);
    if (targets.has(artifactTarget)) throw new Error(`Duplicate monorepo artifact target: ${artifactTarget}`);
    targets.add(artifactTarget);
    validateMonorepoArtifactSelection(packageName, pkg);
    validateApprovedMonorepoCommand(String(pkg.install), true);
    validateApprovedMonorepoCommand(pkg.test === undefined ? undefined : String(pkg.test), false);
    validateApprovedMonorepoCommand(pkg.build === undefined ? undefined : String(pkg.build), false);
    if (pkg.lockfile !== 'package-lock.json') throw new Error(`Unsupported lockfile for ${String(pkg.name)}: ${String(pkg.lockfile)}`);
  }
}

function validateMonorepoArtifactSelection(packageName: string, pkg: Record<string, unknown>) {
  const hasArtifactPath = 'artifactPath' in pkg;
  const hasArtifactIncludes = 'artifactIncludes' in pkg;
  if (hasArtifactPath === hasArtifactIncludes) throw new Error(`Package ${packageName} must define exactly one of artifactPath or artifactIncludes`);
  if (hasArtifactPath) {
    validateArtifactPath(String(pkg.artifactPath));
    return;
  }
  if (!Array.isArray(pkg.artifactIncludes) || pkg.artifactIncludes.length === 0) {
    throw new Error(`Package ${packageName} artifactIncludes must be a non-empty list`);
  }
  const includes = new Set<string>();
  for (const includePath of pkg.artifactIncludes) {
    const value = String(includePath);
    validateArtifactPath(value);
    if (value === '.') throw new Error(`Package ${packageName} artifactIncludes may not include the entire package directory`);
    if (includes.has(value)) throw new Error(`Package ${packageName} has duplicate artifact include: ${value}`);
    includes.add(value);
  }
}

function validateApprovedMonorepoCommand(command: string | undefined, required: boolean) {
  if (!command?.trim()) {
    if (required) throw new Error('required monorepo command is missing');
    return;
  }
  if (!['npm ci', 'npm test', 'npm run build'].includes(command)) throw new Error(`Unsupported monorepo command: ${command}`);
}
