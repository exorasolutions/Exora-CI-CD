import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HELPER = "/usr/local/sbin/exora-static-deploy";

export type ExoraStaticTarget = {
  id: string;
  projectId: string;
  environment: string;
  adapter: string;
  targetPath: string;
  healthUrl?: string;
  healthExpectedStatus?: number;
};

export type ExoraStaticRequest = {
  projectId: string;
  environment: string;
  targetId: string;
  commitSha: string;
  artifact: { path: string; sha256: string };
};

type Context = {
  target: ExoraStaticTarget;
  request: ExoraStaticRequest;
  deploymentId: number | string;
  run?: (file: string, args: string[]) => Promise<unknown>;
};

export function validateExoraStaticTarget(
  target: ExoraStaticTarget,
  request: ExoraStaticRequest
): void {
  if (
    request.projectId !== "exora" ||
    request.environment !== "production" ||
    request.targetId !== "exora-static"
  ) {
    throw new Error("deployment request is not approved for Exora static production");
  }

  if (
    target.id !== "exora-static" ||
    target.projectId !== "exora" ||
    target.environment !== "production" ||
    target.adapter !== "exora-static"
  ) {
    throw new Error("deployment target is not approved for Exora static production");
  }

  if (target.targetPath !== "/srv/apps/exora-website") {
    throw new Error(`unsupported Exora static target root: ${target.targetPath}`);
  }

  if (target.healthUrl !== "http://127.0.0.1:8110/") {
    throw new Error(`unsupported Exora static health URL: ${target.healthUrl}`);
  }

  if ((target.healthExpectedStatus ?? 200) !== 200) {
    throw new Error("unsupported Exora static health expected status");
  }

  if (!/^[a-f0-9]{40}$/i.test(request.commitSha)) {
    throw new Error("invalid commit SHA");
  }

  if (!/^[a-f0-9]{64}$/i.test(request.artifact.sha256)) {
    throw new Error("invalid artifact SHA-256");
  }

  if (!request.artifact.path.startsWith("/opt/cicd/artifacts/")) {
    throw new Error("artifact path is outside the approved staging root");
  }
}

export async function executeExoraStaticDeployment(ctx: Context): Promise<{
  rollback: () => Promise<void>;
}> {
  validateExoraStaticTarget(ctx.target, ctx.request);

  const deploymentId = String(ctx.deploymentId);
  if (!/^[1-9][0-9]{0,17}$/.test(deploymentId)) {
    throw new Error("invalid deployment ID for Exora static helper");
  }

  const run = ctx.run ?? (async (file: string, args: string[]) => {
    return execFileAsync(file, args, {
      timeout: 900_000,
      maxBuffer: 1024 * 1024
    });
  });

  await run("sudo", [
    "-n",
    HELPER,
    "deploy",
    ctx.request.artifact.path,
    ctx.request.artifact.sha256,
    ctx.request.commitSha,
    deploymentId
  ]);

  return {
    rollback: async () => {
      await run("sudo", ["-n", HELPER, "rollback", deploymentId]);
    }
  };
}
