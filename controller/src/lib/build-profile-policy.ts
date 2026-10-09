import YAML from 'yaml';

export const approvedProfileIds = ['node-npm-v1', 'node-pnpm-v1', 'python-v1'] as const;
export type ApprovedProfileId = typeof approvedProfileIds[number];

export type BuildProfile = {
  id: ApprovedProfileId;
  version: 1;
  runtime: 'node' | 'python';
  lockfileRequired: boolean;
  install: string;
  test: string;
  build: string;
  artifactPath: string;
};

const runtimeByProfile: Record<ApprovedProfileId, BuildProfile['runtime']> = {
  'node-npm-v1': 'node',
  'node-pnpm-v1': 'node',
  'python-v1': 'python'
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
  for (const key of ['id', 'version', 'runtime', 'lockfileRequired', 'install', 'test', 'build', 'artifactPath']) {
    if (!(key in profile)) throw new Error(`Malformed build profile ${expectedId}: missing ${key}`);
  }
  if (profile.id !== expectedId) throw new Error(`Build profile id mismatch: expected ${expectedId}, got ${String(profile.id)}`);
  if (profile.version !== 1) throw new Error(`Unsupported build profile version for ${expectedId}: ${String(profile.version)}`);
  if (profile.runtime !== runtimeByProfile[expectedId]) {
    throw new Error(`Unsupported runtime/profile combination: ${expectedId} requires ${runtimeByProfile[expectedId]}, got ${String(profile.runtime)}`);
  }
  if (typeof profile.lockfileRequired !== 'boolean') throw new Error(`Malformed build profile ${expectedId}: lockfileRequired must be boolean`);
  for (const key of ['install', 'test', 'build']) {
    if (typeof profile[key] !== 'string' || !profile[key].trim()) {
      throw new Error(`Malformed build profile ${expectedId}: ${key} must be a non-empty string`);
    }
  }
  validateArtifactPath(String(profile.artifactPath));
  return profile as BuildProfile;
}

export function lockfileForProfile(profile: BuildProfile): string | null {
  if (!profile.lockfileRequired) return null;
  const lockfile = lockfileByProfile[profile.id];
  if (!lockfile) throw new Error(`No lockfile policy is defined for ${profile.id}`);
  return lockfile;
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
  if (value.startsWith('/') || value.includes('\\') || value === '.' || value === '..' || value.includes('../') || value.includes('/..')) {
    throw new Error('unsafe artifact path');
  }
}

export function validateArtifactName(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.tar\.gz$/.test(value)) throw new Error('invalid artifact name');
}

export function deploymentExecutionEnabledFromAdminEnv(value: string | undefined): boolean {
  const normalized = (value ?? 'false').trim();
  if (!['true', 'false'].includes(normalized)) throw new Error('invalid deployment execution flag');
  if (normalized === 'true') throw new Error('deployment execution is not implemented or permitted');
  return false;
}

function isApprovedProfileId(value: string): value is ApprovedProfileId {
  return (approvedProfileIds as readonly string[]).includes(value);
}
