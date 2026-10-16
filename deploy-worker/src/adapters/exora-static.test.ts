import assert from "node:assert/strict";
import test from "node:test";
import {
  executeExoraStaticDeployment,
  validateExoraStaticTarget,
  type ExoraStaticRequest,
  type ExoraStaticTarget
} from "./exora-static.js";

const target: ExoraStaticTarget = {
  id: "exora-static",
  projectId: "exora",
  environment: "production",
  adapter: "exora-static",
  targetPath: "/srv/apps/exora-website",
  healthUrl: "http://127.0.0.1:8110/",
  healthExpectedStatus: 200
};

const request: ExoraStaticRequest = {
  projectId: "exora",
  environment: "production",
  targetId: "exora-static",
  commitSha: "a".repeat(40),
  artifact: {
    path: "/opt/cicd/artifacts/exora/123/release.tar.gz",
    sha256: "b".repeat(64)
  }
};

test("accepts only the approved Exora static target", () => {
  assert.doesNotThrow(() => validateExoraStaticTarget(target, request));
});

test("rejects the existing MERN target", () => {
  assert.throws(() => validateExoraStaticTarget({
    ...target,
    id: "exora-production",
    adapter: "exora-production",
    targetPath: "/var/www/exora"
  }, request), /not approved|unsupported Exora static target root/);
});

test("rejects an unexpected health URL or root", () => {
  assert.throws(() => validateExoraStaticTarget({
    ...target,
    healthUrl: "https://example.com/"
  }, request), /unsupported Exora static health URL/);

  assert.throws(() => validateExoraStaticTarget({
    ...target,
    targetPath: "/var/www/exora"
  }, request), /unsupported Exora static target root/);
});

test("invokes only the dedicated helper and provides rollback", async () => {
  const calls: Array<[string, string[]]> = [];
  const run = async (file: string, args: string[]) => {
    calls.push([file, args]);
    return {};
  };

  const deployed = await executeExoraStaticDeployment({
    target,
    request,
    deploymentId: 42,
    run
  });

  assert.deepEqual(calls[0], [
    "sudo",
    [
      "-n",
      "/usr/local/sbin/exora-static-deploy",
      "deploy",
      request.artifact.path,
      request.artifact.sha256,
      request.commitSha,
      "42"
    ]
  ]);

  await deployed.rollback();
  assert.deepEqual(calls[1], [
    "sudo",
    ["-n", "/usr/local/sbin/exora-static-deploy", "rollback", "42"]
  ]);
});
