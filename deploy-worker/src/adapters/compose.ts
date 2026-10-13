import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeArchiveEntry } from "../release/pathSafety.js";
import type { DeploymentAdapter, DeploymentContext } from "./types.js";

const execFileAsync = promisify(execFile);
const HELPER = "/usr/local/sbin/central-compose-deploy";

export class ComposeAdapter implements DeploymentAdapter {
  readonly name = "compose";
  async prepare(_ctx: DeploymentContext) {}
  async activate(_ctx: DeploymentContext) {
    // Live execution is routed through executeComposeDeployment in the worker.
  }
}

export type ComposeTarget = {
  id: string;
  projectId: string;
  environment: string;
  adapter: string;
  targetPath: string;
  healthUrl?: string;
  healthExpectedStatus?: number;
  runtime: Record<string, string>;
};

export type ComposeDeployRequest = {
  projectId: string;
  environment: string;
  commitSha: string;
  artifact: { path: string; sha256: string };
  targetId: string;
};

type ComposeContext = {
  target: ComposeTarget;
  request: ComposeDeployRequest;
  deploymentId: number | string;
  workRoot: string;
  run?: (file: string, args: string[], options?: { cwd?: string }) => Promise<unknown>;
};

type ComposePolicy = {
  schemaVersion: 1;
  deploymentId: string;
  releaseId: string;
  projectId: string;
  targetId: string;
  environment: string;
  commitSha: string;
  artifactPath: string;
  artifactSha256: string;
  targetRoot: string;
  composeProject: string;
  composeWorkingDir: string;
  composeFiles: string[];
  composeServices: string[];
  builtServices: string[];
  healthServices: string[];
  containers: string[];
  persistentMounts: string;
  publicBindings: string;
  preservePolicy: string;
  networks?: string;
  internalPorts?: string;
  networkMode?: string;
  sharedDeploymentPolicy?: string;
  deploymentStatus: string;
  composeHealthPolicy: string;
};

const APPROVED_COMPOSE_TARGETS: Record<string, {
  projectId: string;
  root: string;
  composeProject: string;
  composeWorkingDir: string;
  composeFiles: string[];
}> = {
  "cab-production": {
    projectId: "cab",
    root: "/srv/apps/nammacabs",
    composeProject: "nammacabs",
    composeWorkingDir: "/srv/apps/nammacabs",
    composeFiles: ["/srv/apps/nammacabs/compose.yaml", "/srv/apps/nammacabs/compose.prod.yaml"]
  },
  "exora-crm-production": {
    projectId: "exora-crm",
    root: "/srv/apps/exora_crm",
    composeProject: "exora-crm",
    composeWorkingDir: "/srv/apps/exora_crm",
    composeFiles: ["/srv/apps/exora_crm/compose.yaml", "/srv/apps/exora_crm/compose.prod.yaml"]
  },
  "exora-shared-services-production": {
    projectId: "exora-shared-services",
    root: "/srv/apps/shared",
    composeProject: "shared-services",
    composeWorkingDir: "/srv/apps/shared",
    composeFiles: ["/srv/apps/shared/compose.yaml", "/srv/apps/shared/compose.prod.yaml"]
  },
  "loomrun-production": {
    projectId: "loomrun",
    root: "/srv/apps/loomrun",
    composeProject: "loomrun",
    composeWorkingDir: "/srv/apps/loomrun",
    composeFiles: ["/srv/apps/loomrun/compose.yaml", "/srv/apps/loomrun/compose.prod.yaml"]
  },
  "qlix-production": {
    projectId: "qlix",
    root: "/srv/apps/qlix",
    composeProject: "qlix",
    composeWorkingDir: "/srv/apps/qlix/deploy/server",
    composeFiles: ["/srv/apps/qlix/deploy/server/compose.yaml"]
  },
  "sunkidz-production": {
    projectId: "sunkidz",
    root: "/srv/apps/sunkidz",
    composeProject: "sunkidz",
    composeWorkingDir: "/srv/apps/sunkidz",
    composeFiles: ["/srv/apps/sunkidz/compose.yaml", "/srv/apps/sunkidz/compose.prod.yaml"]
  }
};

export function validateComposeTarget(target: ComposeTarget, request: ComposeDeployRequest): ComposePolicy {
  const approved = APPROVED_COMPOSE_TARGETS[target.id];
  if (!approved) throw new Error(`compose target is not approved: ${target.id}`);
  if (target.adapter !== "compose") throw new Error(`unsupported compose adapter: ${target.adapter}`);
  if (target.projectId !== approved.projectId || request.projectId !== approved.projectId) {
    throw new Error("deployment request is not approved for this compose project");
  }
  if (target.environment !== "production" || request.environment !== "production") {
    throw new Error("compose deployments are approved only for production targets");
  }
  if (request.targetId !== target.id) throw new Error("deployment request target does not match compose target");
  if (path.posix.normalize(target.targetPath) !== approved.root) {
    throw new Error(`unsupported compose target root: ${target.targetPath}`);
  }

  const runtime = target.runtime ?? {};
  const composeProject = requireRuntime(runtime, "composeProject");
  const composeWorkingDir = requireRuntime(runtime, "composeWorkingDir");
  const composeFiles = splitList(requireRuntime(runtime, "composeFiles"));
  const composeServices = splitList(requireRuntime(runtime, "composeServices"));
  const builtServices = splitList(requireRuntime(runtime, "builtServices"));
  const healthServices = splitList(runtime.healthServices || runtime.builtServices || "");
  const containers = splitList(requireRuntime(runtime, "containers"));
  const preservePolicy = requireRuntime(runtime, "preservePolicy");
  const deploymentStatus = requireRuntime(runtime, "deploymentStatus");
  const composeHealthPolicy = requireRuntime(runtime, "composeHealthPolicy");

  if (composeProject !== approved.composeProject) throw new Error(`unsupported compose project: ${composeProject}`);
  if (path.posix.normalize(composeWorkingDir) !== approved.composeWorkingDir) {
    throw new Error(`unsupported compose working directory: ${composeWorkingDir}`);
  }
  assertSameList(composeFiles, approved.composeFiles, "compose files");
  for (const file of composeFiles) assertAbsoluteInside(file, approved.root, "compose file");
  assertAbsoluteInside(composeWorkingDir, approved.root, "compose working directory");

  if (composeServices.length === 0) throw new Error("compose target must declare allowed services");
  if (builtServices.length === 0) throw new Error("compose target must declare built services");
  if (containers.length === 0) throw new Error("compose target must declare expected containers");
  assertSubset(builtServices, composeServices, "built service");
  assertSubset(healthServices, composeServices, "health service");
  for (const service of composeServices) assertServiceName(service);
  if (deploymentStatus !== "compose-helper-installed-and-staging-validated") {
    throw new Error(`compose live deployment is blocked for ${target.id}: ${deploymentStatus}`);
  }
  if (composeHealthPolicy !== "docker-healthcheck-required") {
    throw new Error(`compose target lacks an approved health policy: ${target.id}`);
  }
  if (target.id === "exora-shared-services-production" && runtime.sharedDeploymentPolicy !== "explicit-shared-services-policy") {
    throw new Error("shared services deployment requires an explicit shared-services policy");
  }

  if (!/^[0-9a-f]{40}$/i.test(request.commitSha)) throw new Error("invalid commit SHA");
  if (!/^[0-9a-f]{64}$/i.test(request.artifact.sha256)) throw new Error("invalid artifact SHA-256");

  const deploymentId = String((request as ComposeDeployRequest & { deploymentId?: unknown }).deploymentId ?? "");
  return {
    schemaVersion: 1,
    deploymentId,
    releaseId: "",
    projectId: approved.projectId,
    targetId: target.id,
    environment: "production",
    commitSha: request.commitSha.toLowerCase(),
    artifactPath: request.artifact.path,
    artifactSha256: request.artifact.sha256.toLowerCase(),
    targetRoot: approved.root,
    composeProject,
    composeWorkingDir,
    composeFiles,
    composeServices,
    builtServices,
    healthServices,
    containers,
    persistentMounts: runtime.persistentMounts ?? "",
    publicBindings: runtime.publicBindings ?? "",
    preservePolicy,
    networks: runtime.networks,
    internalPorts: runtime.internalPorts,
    networkMode: runtime.networkMode,
    sharedDeploymentPolicy: runtime.sharedDeploymentPolicy,
    deploymentStatus,
    composeHealthPolicy
  };
}

export async function executeComposeDeployment(ctx: ComposeContext): Promise<{ rollback: () => Promise<void> }> {
  const deploymentId = String(ctx.deploymentId);
  if (!/^[1-9][0-9]{0,17}$/.test(deploymentId)) throw new Error("invalid deployment ID for compose helper");
  await validateArchiveBeforeHelper(ctx.request.artifact.path);

  const policy = validateComposeTarget(ctx.target, ctx.request);
  policy.deploymentId = deploymentId;
  policy.releaseId = `cicd-${ctx.request.commitSha.slice(0, 12).toLowerCase()}-${deploymentId}`;

  const policyPath = await writePolicy(ctx.workRoot, policy);
  const run = ctx.run ?? execFileAsync;
  await run("sudo", ["-n", HELPER, "deploy", policyPath]);

  return {
    rollback: async () => {
      await run("sudo", ["-n", HELPER, "rollback", policyPath]);
    }
  };
}

async function writePolicy(workRoot: string, policy: ComposePolicy): Promise<string> {
  const root = path.resolve(workRoot);
  const dir = path.join(root, "compose-policies", policy.targetId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const policyPath = path.join(dir, `${policy.releaseId}.json`);
  const resolved = path.resolve(policyPath);
  if (!resolved.startsWith(root + path.sep)) throw new Error("compose policy path escapes work root");
  await fs.writeFile(resolved, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  return resolved;
}

async function validateArchiveBeforeHelper(artifactPath: string): Promise<void> {
  const { stdout } = await execFileAsync("tar", ["-tvzf", artifactPath]);
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const entry = parseVerboseTarEntry(line);
    assertSafeArchiveEntry(entry.name);
    if (!["file", "directory"].includes(entry.type)) {
      throw new Error(`unsupported archive entry type for ${entry.name}: ${entry.type}`);
    }
  }
}

function parseVerboseTarEntry(line: string): { type: string; name: string } {
  const marker = line[0];
  const type = marker === "d" ? "directory" : marker === "-" ? "file" : marker === "l" ? "symlink" : marker === "h" ? "hardlink" : "other";
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) throw new Error(`unable to parse tar entry metadata: ${line}`);
  const name = parts.slice(5).join(" ").replace(/\s+->\s+.*$/, "");
  return { type, name };
}

function requireRuntime(runtime: Record<string, string>, key: string): string {
  const value = runtime[key]?.trim();
  if (!value) throw new Error(`compose target missing runtime.${key}`);
  return value;
}

function splitList(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function assertSameList(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`unsupported ${label}: ${actual.join(",")}`);
  }
}

function assertSubset(values: string[], allowed: string[], label: string): void {
  for (const value of values) {
    if (!allowed.includes(value)) throw new Error(`unapproved ${label}: ${value}`);
  }
}

function assertServiceName(value: string): void {
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(value)) throw new Error(`invalid compose service: ${value}`);
}

function assertAbsoluteInside(value: string, root: string, label: string): void {
  if (!value.startsWith("/")) throw new Error(`${label} must be absolute`);
  const resolvedRoot = path.posix.normalize(root);
  const resolved = path.posix.normalize(value);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`${label} is outside approved target root: ${value}`);
  }
}
