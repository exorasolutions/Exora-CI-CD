import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeArchiveEntry } from "../release/pathSafety.js";

const execFileAsync = promisify(execFile);

export type ExoraTarget = {
  id: string;
  projectId: string;
  environment: string;
  adapter: string;
  targetPath: string;
  healthUrl?: string;
  healthExpectedStatus?: number;
};

export type ExoraDeployRequest = {
  projectId: string;
  environment: string;
  commitSha: string;
  artifact: { path: string; sha256: string };
  targetId: string;
  dryRun?: boolean;
};

type CommandRunner = (file: string, args: string[], options?: { cwd?: string }) => Promise<unknown>;

type AdapterContext = {
  target: ExoraTarget;
  request: ExoraDeployRequest;
  deploymentId: number;
  workRoot: string;
  run?: CommandRunner;
  paths?: ExoraPaths;
};

type PreparedRelease = {
  releaseId: string;
  extractedRoot: string;
  rollback: () => Promise<void>;
};

type ExoraPaths = {
  root: string;
  frontendTarget: string;
  backendTarget: string;
  pm2Process: string;
};

const PRODUCTION_PATHS: ExoraPaths = {
  root: "/var/www/exora",
  frontendTarget: "/var/www/exora/exora-mern/client/dist",
  backendTarget: "/var/www/exora/exora-mern/server",
  pm2Process: "exora-api"
};

const FRONTEND_SOURCE = ".central-cicd/release/marketing-client/dist";
const BACKEND_SOURCE = ".central-cicd/release/main-server";

export function validateExoraProductionTarget(target: ExoraTarget, request: ExoraDeployRequest, paths: ExoraPaths = PRODUCTION_PATHS): void {
  if (request.projectId !== "exora" || request.environment !== "production" || request.targetId !== "exora-production") {
    throw new Error("deployment request is not approved for Exora production");
  }
  if (target.id !== "exora-production" || target.projectId !== "exora" || target.environment !== "production") {
    throw new Error("deployment target is not approved for Exora production");
  }
  if (target.adapter !== "exora-production") throw new Error(`unsupported Exora adapter: ${target.adapter}`);
  if (path.resolve(target.targetPath) !== path.resolve(paths.root)) throw new Error(`unsupported Exora target root: ${target.targetPath}`);
}

export async function executeExoraProductionDeployment(ctx: AdapterContext): Promise<{ rollback: () => Promise<void> }> {
  const paths = ctx.paths ?? PRODUCTION_PATHS;
  validateExoraProductionTarget(ctx.target, ctx.request, paths);
  const prepared = await prepareVerifiedRelease(ctx);
  const frontend = new ExoraFrontendAdapter();
  const backend = new ExoraBackendAdapter();
  const rollbackSteps: Array<() => Promise<void>> = [prepared.rollback];

  try {
    const frontendRollback = await frontend.deploy(prepared, { ...ctx, paths });
    rollbackSteps.unshift(frontendRollback);
    const backendRollback = await backend.deploy(prepared, { ...ctx, paths });
    rollbackSteps.unshift(backendRollback);
  } catch (error) {
    for (const step of rollbackSteps) await step();
    throw error;
  }

  return {
    rollback: async () => {
      for (const step of rollbackSteps) await step();
    }
  };
}

export class ExoraFrontendAdapter {
  async deploy(prepared: PreparedRelease, _ctx: AdapterContext): Promise<() => Promise<void>> {
    const source = safeJoin(prepared.extractedRoot, FRONTEND_SOURCE);
    await assertDirectoryWithoutSymlinks(source);
    const stage = safeJoin(prepared.extractedRoot, `.deploy/frontend-${prepared.releaseId}`);
    await fs.rm(stage, { recursive: true, force: true });
    await fs.cp(source, stage, { recursive: true, errorOnExist: false });
    return replaceDirectoryWithRollback(stage, (_ctx.paths ?? PRODUCTION_PATHS).frontendTarget, prepared.releaseId, "frontend");
  }
}

export class ExoraBackendAdapter {
  async deploy(prepared: PreparedRelease, ctx: AdapterContext): Promise<() => Promise<void>> {
    const source = safeJoin(prepared.extractedRoot, BACKEND_SOURCE);
    await assertDirectoryWithoutSymlinks(source);
    const stage = safeJoin(prepared.extractedRoot, `.deploy/backend-${prepared.releaseId}`);
    await fs.rm(stage, { recursive: true, force: true });
    await fs.cp(source, stage, { recursive: true, errorOnExist: false });

    const paths = ctx.paths ?? PRODUCTION_PATHS;
    const rollback = await replaceDirectoryWithRollback(stage, paths.backendTarget, prepared.releaseId, "backend");
    await restorePersistentBackendState(paths.backendTarget, `${paths.backendTarget}.rollback-${prepared.releaseId}-backend`);
    const run = ctx.run ?? execFileAsync;
    try {
      await run("npm", ["ci", "--omit=dev"], { cwd: paths.backendTarget });
      await run("pm2", ["reload", paths.pm2Process], { cwd: paths.backendTarget });
    } catch (error) {
      await rollback();
      throw error;
    }
    return rollback;
  }
}

async function prepareVerifiedRelease(ctx: AdapterContext): Promise<PreparedRelease> {
  const releaseId = `${ctx.request.commitSha.slice(0, 12)}-${ctx.deploymentId}`;
  const workRoot = path.resolve(ctx.workRoot);
  const releaseRoot = safeJoin(workRoot, releaseId);
  await fs.rm(releaseRoot, { recursive: true, force: true });
  await fs.mkdir(releaseRoot, { recursive: true });

  const entries = await listArchiveEntries(ctx.request.artifact.path);
  for (const entry of entries) {
    assertSafeArchiveEntry(entry);
    if (entry.includes("exora-crm")) throw new Error("artifact contains forbidden exora-crm path");
  }

  await execFileAsync("tar", ["-xzf", ctx.request.artifact.path, "-C", releaseRoot]);
  await assertDirectoryWithoutSymlinks(releaseRoot);
  await fs.access(safeJoin(releaseRoot, FRONTEND_SOURCE));
  await fs.access(safeJoin(releaseRoot, BACKEND_SOURCE));
  return {
    releaseId,
    extractedRoot: releaseRoot,
    rollback: async () => {
      await fs.rm(releaseRoot, { recursive: true, force: true });
    }
  };
}

async function listArchiveEntries(artifactPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("tar", ["-tzf", artifactPath]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function replaceDirectoryWithRollback(stage: string, target: string, releaseId: string, label: string): Promise<() => Promise<void>> {
  const parent = path.dirname(target);
  const backup = `${target}.rollback-${releaseId}-${label}`;
  await fs.mkdir(parent, { recursive: true });
  await fs.rm(backup, { recursive: true, force: true });
  let hadPrevious = false;
  try {
    await fs.access(target);
    hadPrevious = true;
    await fs.rename(target, backup);
  } catch {}
  try {
    await fs.rename(stage, target);
  } catch (error) {
    if (hadPrevious) await fs.rename(backup, target).catch(() => undefined);
    throw error;
  }
  return async () => {
    await fs.rm(target, { recursive: true, force: true });
    if (hadPrevious) await fs.rename(backup, target);
  };
}

async function restorePersistentBackendState(target: string, backup: string): Promise<void> {
  for (const name of [".env", ".env.production", "uploads", "data"]) {
    const source = path.join(backup, name);
    const dest = path.join(target, name);
    try {
      await fs.access(source);
      await fs.rm(dest, { recursive: true, force: true });
      await fs.cp(source, dest, { recursive: true, errorOnExist: false });
    } catch {}
  }
}

async function assertDirectoryWithoutSymlinks(root: string): Promise<void> {
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) throw new Error(`symlink is not allowed in deployment artifact: ${root}`);
  if (!stat.isDirectory()) return;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in deployment artifact: ${full}`);
    if (entry.isDirectory()) await assertDirectoryWithoutSymlinks(full);
  }
}

function safeJoin(root: string, child: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, child);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`path escapes deployment root: ${child}`);
  }
  return resolved;
}
