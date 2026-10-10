import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { executeExoraProductionDeployment, validateExoraProductionTarget } from "./exora-production.js";

const baseRequest = {
  projectId: "exora",
  environment: "production",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  artifact: { path: "", sha256: "0".repeat(64) },
  targetId: "exora-production"
};

test("allows only the Exora production deployment target", () => {
  const target = {
    id: "exora-production",
    projectId: "exora",
    environment: "production",
    adapter: "exora-production",
    targetPath: "/var/www/exora"
  };
  assert.doesNotThrow(() => validateExoraProductionTarget(target, baseRequest));
  assert.throws(() => validateExoraProductionTarget({ ...target, id: "crm-production" }, baseRequest), /not approved/);
  assert.throws(() => validateExoraProductionTarget({ ...target, targetPath: "/var/www/exora/../exora-crm" }, baseRequest), /unsupported Exora target root/);
  assert.throws(() => validateExoraProductionTarget({ ...target, adapter: "pm2" }, baseRequest), /unsupported Exora adapter/);
});

test("deploys frontend and backend from a verified artifact and preserves backend state", async () => {
  const dir = path.join(tmpdir(), `exora-deploy-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const artifactRoot = path.join(dir, "artifact-root", ".central-cicd", "release");
  const frontend = path.join(artifactRoot, "marketing-client", "dist");
  const backend = path.join(artifactRoot, "main-server");
  mkdirSync(frontend, { recursive: true });
  mkdirSync(backend, { recursive: true });
  writeFileSync(path.join(frontend, "index.html"), "new frontend");
  writeFileSync(path.join(backend, "server.js"), "console.log('new backend')\n");
  writeFileSync(path.join(backend, "package.json"), "{}\n");
  writeFileSync(path.join(backend, "package-lock.json"), "{}\n");

  const artifact = path.join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", artifact, ".central-cicd"], { cwd: path.join(dir, "artifact-root") });

  const prodRoot = path.join(dir, "prod");
  const frontendTarget = path.join(prodRoot, "exora-mern", "client", "dist");
  const backendTarget = path.join(prodRoot, "exora-mern", "server");
  mkdirSync(frontendTarget, { recursive: true });
  mkdirSync(backendTarget, { recursive: true });
  writeFileSync(path.join(frontendTarget, "old.html"), "old frontend");
  writeFileSync(path.join(backendTarget, ".env"), "SECRET=keep\n");
  writeFileSync(path.join(backendTarget, "server.js"), "old backend\n");

  const commands: string[] = [];
  await executeExoraProductionDeployment({
    target: {
      id: "exora-production",
      projectId: "exora",
      environment: "production",
      adapter: "exora-production",
      targetPath: prodRoot
    },
    request: { ...baseRequest, artifact: { ...baseRequest.artifact, path: artifact } },
    deploymentId: 1,
    workRoot: path.join(dir, "work"),
    paths: {
      root: prodRoot,
      frontendTarget,
      backendTarget,
      pm2Process: "exora-api"
    },
    run: async (file, args, options) => {
      commands.push(`${file} ${args.join(" ")} ${options?.cwd ?? ""}`.trim());
    }
  });

  assert.equal(readFileSync(path.join(frontendTarget, "index.html"), "utf8"), "new frontend");
  assert.equal(existsSync(path.join(frontendTarget, "old.html")), false);
  assert.equal(readFileSync(path.join(backendTarget, ".env"), "utf8"), "SECRET=keep\n");
  assert.match(readFileSync(path.join(backendTarget, "server.js"), "utf8"), /new backend/);
  assert.deepEqual(commands, [
    `npm ci --omit=dev ${backendTarget}`,
    `pm2 reload exora-api ${backendTarget}`
  ]);

  rmSync(dir, { recursive: true, force: true });
});

test("rejects artifacts that contain CRM paths", async () => {
  const dir = path.join(tmpdir(), `exora-deploy-crm-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "artifact-root", "exora-mern", "exora-crm"), { recursive: true });
  writeFileSync(path.join(dir, "artifact-root", "exora-mern", "exora-crm", "index.js"), "bad");
  const artifact = path.join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", artifact, "exora-mern"], { cwd: path.join(dir, "artifact-root") });
  const prodRoot = path.join(dir, "prod");

  await assert.rejects(() => executeExoraProductionDeployment({
    target: {
      id: "exora-production",
      projectId: "exora",
      environment: "production",
      adapter: "exora-production",
      targetPath: prodRoot
    },
    request: { ...baseRequest, artifact: { ...baseRequest.artifact, path: artifact } },
    deploymentId: 2,
    workRoot: path.join(dir, "work"),
    paths: {
      root: prodRoot,
      frontendTarget: path.join(prodRoot, "client", "dist"),
      backendTarget: path.join(prodRoot, "server"),
      pm2Process: "exora-api"
    },
    run: async () => undefined
  }), /forbidden exora-crm path/);

  rmSync(dir, { recursive: true, force: true });
});

test("rolls back frontend and backend directories when backend command fails", async () => {
  const dir = path.join(tmpdir(), `exora-deploy-rollback-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const artifactRoot = path.join(dir, "artifact-root", ".central-cicd", "release");
  const frontend = path.join(artifactRoot, "marketing-client", "dist");
  const backend = path.join(artifactRoot, "main-server");
  mkdirSync(frontend, { recursive: true });
  mkdirSync(backend, { recursive: true });
  writeFileSync(path.join(frontend, "index.html"), "new frontend");
  writeFileSync(path.join(backend, "server.js"), "new backend\n");
  writeFileSync(path.join(backend, "package.json"), "{}\n");
  writeFileSync(path.join(backend, "package-lock.json"), "{}\n");
  const artifact = path.join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", artifact, ".central-cicd"], { cwd: path.join(dir, "artifact-root") });

  const prodRoot = path.join(dir, "prod");
  const frontendTarget = path.join(prodRoot, "exora-mern", "client", "dist");
  const backendTarget = path.join(prodRoot, "exora-mern", "server");
  mkdirSync(frontendTarget, { recursive: true });
  mkdirSync(backendTarget, { recursive: true });
  writeFileSync(path.join(frontendTarget, "index.html"), "old frontend");
  writeFileSync(path.join(backendTarget, "server.js"), "old backend\n");
  writeFileSync(path.join(backendTarget, ".env"), "SECRET=keep\n");

  await assert.rejects(() => executeExoraProductionDeployment({
    target: {
      id: "exora-production",
      projectId: "exora",
      environment: "production",
      adapter: "exora-production",
      targetPath: prodRoot
    },
    request: { ...baseRequest, artifact: { ...baseRequest.artifact, path: artifact } },
    deploymentId: 3,
    workRoot: path.join(dir, "work"),
    paths: {
      root: prodRoot,
      frontendTarget,
      backendTarget,
      pm2Process: "exora-api"
    },
    run: async () => {
      throw new Error("pm2 failed");
    }
  }), /pm2 failed/);

  assert.equal(readFileSync(path.join(frontendTarget, "index.html"), "utf8"), "old frontend");
  assert.equal(readFileSync(path.join(backendTarget, "server.js"), "utf8"), "old backend\n");
  assert.equal(readFileSync(path.join(backendTarget, ".env"), "utf8"), "SECRET=keep\n");

  rmSync(dir, { recursive: true, force: true });
});

test("returned rollback restores directories after a post-deploy health failure", async () => {
  const dir = path.join(tmpdir(), `exora-deploy-health-rollback-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const artifactRoot = path.join(dir, "artifact-root", ".central-cicd", "release");
  const frontend = path.join(artifactRoot, "marketing-client", "dist");
  const backend = path.join(artifactRoot, "main-server");
  mkdirSync(frontend, { recursive: true });
  mkdirSync(backend, { recursive: true });
  writeFileSync(path.join(frontend, "index.html"), "new frontend");
  writeFileSync(path.join(backend, "server.js"), "new backend\n");
  writeFileSync(path.join(backend, "package.json"), "{}\n");
  writeFileSync(path.join(backend, "package-lock.json"), "{}\n");
  const artifact = path.join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", artifact, ".central-cicd"], { cwd: path.join(dir, "artifact-root") });

  const prodRoot = path.join(dir, "prod");
  const frontendTarget = path.join(prodRoot, "exora-mern", "client", "dist");
  const backendTarget = path.join(prodRoot, "exora-mern", "server");
  mkdirSync(frontendTarget, { recursive: true });
  mkdirSync(backendTarget, { recursive: true });
  writeFileSync(path.join(frontendTarget, "index.html"), "old frontend");
  writeFileSync(path.join(backendTarget, "server.js"), "old backend\n");

  const deployed = await executeExoraProductionDeployment({
    target: {
      id: "exora-production",
      projectId: "exora",
      environment: "production",
      adapter: "exora-production",
      targetPath: prodRoot
    },
    request: { ...baseRequest, artifact: { ...baseRequest.artifact, path: artifact } },
    deploymentId: 4,
    workRoot: path.join(dir, "work"),
    paths: {
      root: prodRoot,
      frontendTarget,
      backendTarget,
      pm2Process: "exora-api"
    },
    run: async () => undefined
  });

  assert.equal(readFileSync(path.join(frontendTarget, "index.html"), "utf8"), "new frontend");
  assert.equal(readFileSync(path.join(backendTarget, "server.js"), "utf8"), "new backend\n");
  await deployed.rollback();
  assert.equal(readFileSync(path.join(frontendTarget, "index.html"), "utf8"), "old frontend");
  assert.equal(readFileSync(path.join(backendTarget, "server.js"), "utf8"), "old backend\n");

  rmSync(dir, { recursive: true, force: true });
});
