import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeComposeDeployment,
  validateComposeTarget,
  type ComposeDeployRequest,
  type ComposeTarget
} from "./compose.js";

const request: ComposeDeployRequest = {
  projectId: "loomrun",
  environment: "production",
  targetId: "loomrun-production",
  commitSha: "a".repeat(40),
  artifact: {
    path: "/opt/cicd/artifacts/loomrun/1/release.tar.gz",
    sha256: "b".repeat(64)
  }
};

const target: ComposeTarget = {
  id: "loomrun-production",
  projectId: "loomrun",
  environment: "production",
  adapter: "compose",
  targetPath: "/srv/apps/loomrun",
  healthUrl: "http://127.0.0.1:8107/ready",
  healthExpectedStatus: 200,
  runtime: {
    composeProject: "loomrun",
    composeWorkingDir: "/srv/apps/loomrun",
    composeFiles: "/srv/apps/loomrun/compose.yaml,/srv/apps/loomrun/compose.prod.yaml",
    composeServices: "web,api,redis",
    builtServices: "web,api",
    healthServices: "web,api",
    containers: "loomrun-web-1,loomrun-api-1,loomrun-redis-1",
    publicBindings: "127.0.0.1:8107->80",
    internalPorts: "api:8002,redis:6379",
    networks: "loomrun_default,shared",
    persistentMounts: "/srv/apps/loomrun/.env:/app/.env:ro,/srv/apps/loomrun/data/storage:/loomrun-storage",
    preservePolicy: "preserve-storage-env-redis-shared-network",
    candidateContextPolicy: "loomrun-source-root-v1",
    healthContract: "loomrun-web-root-api-ready-v1",
    deploymentStatus: "compose-helper-installed-and-staging-validated",
    composeHealthPolicy: "docker-healthcheck-required"
  }
};

test("accepts approved compose target contract", () => {
  const policy = validateComposeTarget(target, request);
  assert.equal(policy.targetRoot, "/srv/apps/loomrun");
  assert.deepEqual(policy.composeFiles, [
    "/srv/apps/loomrun/compose.yaml",
    "/srv/apps/loomrun/compose.prod.yaml"
  ]);
  assert.deepEqual(policy.builtServices, ["web", "api"]);
  assert.deepEqual(policy.healthServices, ["web", "api"]);
  assert.deepEqual(policy.containers, ["loomrun-web-1", "loomrun-api-1", "loomrun-redis-1"]);
});

test("rejects Loomrun health policies that are not the verified web/API contract", () => {
  assert.throws(() => validateComposeTarget({ ...target, healthUrl: "http://127.0.0.1:8107/health" }, request), /verified \/ready health contract/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, healthContract: "none" }
  }, request), /approved health contract/);
});

test("rejects repository, target, root, project, compose file, and wrong-service mismatches", () => {
  assert.throws(() => validateComposeTarget(target, { ...request, projectId: "qlix" }), /not approved/);
  assert.throws(() => validateComposeTarget(target, { ...request, targetId: "qlix-production" }), /does not match/);
  assert.throws(() => validateComposeTarget({ ...target, targetPath: "/srv/apps/loomrun-old" }, request), /unsupported compose target root/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, composeProject: "wrong" }
  }, request), /unsupported compose project/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, composeFiles: "/srv/apps/loomrun/compose.yaml" }
  }, request), /unsupported compose files/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, builtServices: "web,postgres" }
  }, request), /unapproved built service/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, composeFiles: "/etc/passwd,/srv/apps/loomrun/compose.prod.yaml" }
  }, request), /unsupported compose files|outside approved target root/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, deploymentStatus: "disabled-compose-helper-not-production-installed" }
  }, request), /blocked/);
  assert.throws(() => validateComposeTarget({
    ...target,
    runtime: { ...target.runtime, composeHealthPolicy: "running-status" }
  }, request), /lacks an approved health policy/);
});

test("requires explicit policy for shared-services deployment", () => {
  const sharedRequest = {
    ...request,
    projectId: "exora-shared-services",
    targetId: "exora-shared-services-production"
  };
  const sharedTarget: ComposeTarget = {
    id: "exora-shared-services-production",
    projectId: "exora-shared-services",
    environment: "production",
    adapter: "compose",
    targetPath: "/srv/apps/shared",
    runtime: {
      composeProject: "shared-services",
      composeWorkingDir: "/srv/apps/shared",
      composeFiles: "/srv/apps/shared/compose.yaml,/srv/apps/shared/compose.prod.yaml",
      composeServices: "whatsapp-qlix,whatsapp-loomrun,mcp-qlix,mcp-gmail-loomrun",
      builtServices: "whatsapp-qlix",
      healthServices: "whatsapp-qlix",
      containers: "shared-services-mcp-qlix-1,shared-services-whatsapp-qlix-1,shared-services-whatsapp-loomrun-1",
      publicBindings: "127.0.0.1:3940->3940,127.0.0.1:3939->3939,127.0.0.1:8090->8090",
      networks: "shared",
      persistentMounts: "/srv/apps/shared/data/whatsapp-qlix:/data,/srv/apps/shared/data/whatsapp-loomrun/auth_info:/app/auth_info,/srv/apps/shared/data/mcp-qlix:/data",
      preservePolicy: "preserve-whatsapp-auth-mcp-data-shared-network",
      deploymentStatus: "compose-helper-installed-and-staging-validated",
      composeHealthPolicy: "docker-healthcheck-required"
    }
  };

  assert.throws(() => validateComposeTarget(sharedTarget, sharedRequest), /explicit shared-services policy/);
  assert.doesNotThrow(() => validateComposeTarget({
    ...sharedTarget,
    runtime: { ...sharedTarget.runtime, sharedDeploymentPolicy: "explicit-shared-services-policy" }
  }, sharedRequest));
});

test("invokes only the compose helper and returns rollback", async () => {
  const dir = path.join(tmpdir(), `compose-adapter-${process.pid}`);
  const artifact = createArtifact(dir);
  const calls: Array<[string, string[]]> = [];

  const deployed = await executeComposeDeployment({
    target,
    request: { ...request, artifact: { path: artifact, sha256: "b".repeat(64) } },
    deploymentId: 42,
    workRoot: path.join(dir, "work"),
    run: async (file, args) => {
      calls.push([file, args]);
      return {};
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "sudo");
  assert.deepEqual(calls[0][1].slice(0, 3), ["-n", "/usr/local/sbin/central-compose-deploy", "deploy"]);
  const policyPath = calls[0][1][3];
  assert.match(policyPath, /compose-policies[\\/]+loomrun-production/);
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  assert.equal(policy.targetId, "loomrun-production");
  assert.deepEqual(policy.builtServices, ["web", "api"]);

  await deployed.rollback();
  assert.deepEqual(calls[1], [
    "sudo",
    ["-n", "/usr/local/sbin/central-compose-deploy", "rollback", policyPath]
  ]);

  rmSync(dir, { recursive: true, force: true });
});

test("rejects malicious compose artifacts before helper execution", async () => {
  const dir = path.join(tmpdir(), `compose-adapter-bad-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const artifact = path.join(dir, "bad.tar.gz");
  writeFileSync(artifact, tarGz([{ name: "compose.yaml", type: "2", linkName: "/etc/passwd" }]));
  const calls: Array<[string, string[]]> = [];

  await assert.rejects(() => executeComposeDeployment({
    target,
    request: { ...request, artifact: { path: artifact, sha256: "b".repeat(64) } },
    deploymentId: 43,
    workRoot: path.join(dir, "work"),
    run: async (file, args) => {
      calls.push([file, args]);
      return {};
    }
  }), /symlink|unsupported archive entry type/);

  assert.equal(calls.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("compose helper does not contain broad destructive docker operations", () => {
  const helper = readFileSync(path.resolve("tools/central-compose-deploy"), "utf8");
  const productionHelper = helper.slice(0, helper.indexOf("def staging_cleanup"));
  assert.doesNotMatch(productionHelper, /compose.*down/);
  assert.match(helper, /def staging_cleanup/);
  assert.doesNotMatch(helper, /system prune/);
  assert.doesNotMatch(helper, /docker.*rm.*\*/);
  assert.match(helper, /"--no-deps"/);
  assert.match(helper, /rollback/);
});

test("compose helper independently pins target contracts and fails closed before live mutation", () => {
  const helper = readFileSync(path.resolve("tools/central-compose-deploy"), "utf8");
  for (const id of [
    "cab-production",
    "exora-crm-production",
    "exora-shared-services-production",
    "loomrun-production",
    "qlix-production",
    "sunkidz-production"
  ]) {
    assert.match(helper, new RegExp(`"${id}"`));
  }
  assert.match(helper, /APPROVED_TARGETS/);
  assert.match(helper, /compose policy violates approved contract/);
  assert.match(helper, /stage_artifact/);
  assert.match(helper, /nested = wrapper \/ "release"/);
  assert.match(helper, /validate_artifact_copy/);
  assert.match(helper, /TargetLock/);
  assert.match(helper, /recovery-/);
  assert.match(helper, /live compose deployment blocked pending verified candidate build-context mapping/);
});

test("compose helper public deploy and rollback dispatch are blocked before docker mutation", () => {
  for (const command of ["deploy", "rollback"]) {
    const { stderr, dockerInvoked } = runHelper(command);
    assert.match(stderr, new RegExp(`live compose ${command} blocked pending verified candidate build-context mapping and health contracts`));
    assert.equal(dockerInvoked, false, `${command} must not invoke docker`);
  }
});

test("compose helper public dispatch rejects alternate operations and validation remains non-mutating", () => {
  const unsupported = runHelper("promote");
  assert.match(unsupported.stderr, /usage: central-compose-deploy/);
  assert.equal(unsupported.dockerInvoked, false, "unsupported operation must not invoke docker");

  const validate = runHelper("validate");
  assert.doesNotMatch(validate.stderr, /live compose validate blocked/);
  assert.equal(validate.dockerInvoked, false, "validation failure must not invoke docker mutation");
});

function createArtifact(dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  const root = path.join(dir, "artifact-root");
  mkdirSync(path.join(root, "apps", "web"), { recursive: true });
  writeFileSync(path.join(root, "compose.yaml"), "services: {}\n");
  writeFileSync(path.join(root, "compose.prod.yaml"), "services: {}\n");
  writeFileSync(path.join(root, "apps", "web", "package.json"), "{}\n");
  const artifact = path.join(dir, "release.tar.gz");
  execFileSync("tar", ["-czf", artifact, "compose.yaml", "compose.prod.yaml", "apps"], { cwd: root });
  return artifact;
}

function runHelper(command: string): { stderr: string; dockerInvoked: boolean } {
  const dir = path.join(tmpdir(), `compose-helper-dispatch-${process.pid}-${command}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const dockerLog = path.join(dir, "docker.log");
  const python = process.platform === "win32" ? "python" : "python3";
  const fakeDocker = path.join(bin, process.platform === "win32" ? "docker.cmd" : "docker");
  writeFileSync(
    fakeDocker,
    process.platform === "win32"
      ? `@echo off\r\necho %*>>"${dockerLog}"\r\nexit /b 99\r\n`
      : `#!/bin/sh\nprintf '%s\\n' "$*" >> '${dockerLog}'\nexit 99\n`
  );
  if (process.platform !== "win32") chmodSync(fakeDocker, 0o700);

  try {
    execFileSync(python, ["tools/central-compose-deploy", command, path.join(dir, "policy.json")], {
      cwd: path.resolve("."),
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.fail(`helper ${command} unexpectedly succeeded`);
  } catch (error) {
    const processError = error as Error & { stderr?: unknown };
    const stderr = processError.stderr == null
      ? processError.message
      : String(processError.stderr);
    return { stderr, dockerInvoked: existsSync(dockerLog) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type TarEntry = {
  name: string;
  type: string;
  body?: string;
  linkName?: string;
};

function tarGz(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    const header = Buffer.alloc(512, 0);
    writeString(header, 0, 100, entry.name);
    writeString(header, 100, 8, "0000777");
    writeString(header, 108, 8, "0000000");
    writeString(header, 116, 8, "0000000");
    writeOctal(header, 124, 12, entry.type === "0" ? body.length : 0);
    writeString(header, 136, 12, "00000000000");
    header.fill(0x20, 148, 156);
    writeString(header, 156, 1, entry.type);
    if (entry.linkName) writeString(header, 157, 100, entry.linkName);
    writeString(header, 257, 6, "ustar");
    writeString(header, 263, 2, "00");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    writeString(header, 148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
    chunks.push(header);
    if (body.length) {
      chunks.push(body);
      const padding = (512 - (body.length % 512)) % 512;
      if (padding) chunks.push(Buffer.alloc(padding, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks));
}

function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  writeString(buffer, offset, length, value.toString(8).padStart(length - 1, "0"));
}
