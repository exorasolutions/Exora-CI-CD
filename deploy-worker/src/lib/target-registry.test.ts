import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { loadTargets } from "./target-registry.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const targetDir = join(repoRoot, "config/targets");
const projectDir = join(repoRoot, "config/projects");
const serverPath = join(repoRoot, "deploy-worker/src/server.ts");

test("loads every target config with explicit enablement", () => {
  const targets = loadTargets(targetDir);
  for (const id of [
    "cab-production",
    "exora-crm-production",
    "exora-shared-services-production",
    "exora-production",
    "loomrun-production",
    "nomi-production",
    "qlix-production",
    "sunkidz-production"
  ]) {
    assert.equal(targets.has(id), true, `missing target ${id}`);
  }

  for (const target of targets.values()) {
    assert.equal(target.environment, "production");
    assert.equal(target.rootPath.startsWith("/"), true);
    assert.equal(target.releaseRoot.startsWith(target.rootPath), true);
    const handoffEnabled = ["cab-production", "exora-static", "loomrun-production", "nomi-production", "sunkidz-production", "exora-crm-production", "qlix-production", "exora-shared-services-production"];
    assert.equal(target.enabled, handoffEnabled.includes(target.id), `${target.id} has unexpected handoff enablement`);
    if (!["exora-production", "example-static-production"].includes(target.id)) assert.match(target.rootPath, /^\/srv\/apps\//);
  }
});

test("production targets match verified VPS runtime paths and explicit enablement", () => {
  const targets = loadTargets(targetDir);
  const expected = new Map([
    ["cab-production", {
      rootPath: "/srv/apps/nammacabs",
      adapter: "compose",
      composeProject: "nammacabs",
      composeWorkingDir: "/srv/apps/nammacabs",
      composeFiles: "/srv/apps/nammacabs/compose.yaml,/srv/apps/nammacabs/compose.prod.yaml"
    }],
    ["exora-crm-production", {
      rootPath: "/srv/apps/exora_crm",
      adapter: "compose",
      composeProject: "exora-crm",
      composeWorkingDir: "/srv/apps/exora_crm",
      composeFiles: "/srv/apps/exora_crm/compose.yaml,/srv/apps/exora_crm/compose.prod.yaml"
    }],
    ["exora-shared-services-production", {
      rootPath: "/srv/apps/shared",
      adapter: "compose",
      composeProject: "shared-services",
      composeWorkingDir: "/srv/apps/shared",
      composeFiles: "/srv/apps/shared/compose.yaml,/srv/apps/shared/compose.prod.yaml"
    }],
    ["loomrun-production", {
      rootPath: "/srv/apps/loomrun",
      adapter: "compose",
      composeProject: "loomrun",
      composeWorkingDir: "/srv/apps/loomrun",
      composeFiles: "/srv/apps/loomrun/compose.yaml,/srv/apps/loomrun/compose.prod.yaml"
    }],
    ["qlix-production", {
      rootPath: "/srv/apps/qlix",
      adapter: "compose",
      composeProject: "qlix",
      composeWorkingDir: "/srv/apps/qlix/deploy/server",
      composeFiles: "/srv/apps/qlix/deploy/server/compose.yaml"
    }],
    ["sunkidz-production", {
      rootPath: "/srv/apps/sunkidz",
      adapter: "compose",
      composeProject: "sunkidz",
      composeWorkingDir: "/srv/apps/sunkidz",
      composeFiles: "/srv/apps/sunkidz/compose.yaml,/srv/apps/sunkidz/compose.prod.yaml"
    }]
  ]);

  for (const [id, want] of expected) {
    const target = targets.get(id);
    assert.ok(target, `missing target ${id}`);
    assert.equal(target.rootPath, want.rootPath);
    assert.equal(target.adapter, want.adapter);
    assert.equal(target.enabled, ["cab-production", "loomrun-production", "nomi-production", "sunkidz-production", "exora-crm-production", "qlix-production", "exora-shared-services-production"].includes(target.id));
    assert.equal(target.runtime.composeProject, want.composeProject);
    assert.equal(target.runtime.composeWorkingDir, want.composeWorkingDir);
    assert.equal(target.runtime.composeFiles, want.composeFiles);
    const liveComposeTargets = ['cab-production', 'loomrun-production', 'nomi-production', 'sunkidz-production', 'exora-crm-production', 'qlix-production', 'exora-shared-services-production'];
    assert.equal(target.runtime.deploymentStatus, liveComposeTargets.includes(target.id) ? 'compose-helper-installed-and-staging-validated' : 'disabled-compose-helper-not-production-installed');
    assert.equal(target.runtime.composeHealthPolicy, ['cab-production', 'loomrun-production', 'nomi-production', 'sunkidz-production', 'exora-crm-production', 'qlix-production', 'exora-shared-services-production'].includes(target.id) ? 'docker-healthcheck-required' : 'blocked-pending-verified-health-contract');
  }

  const loomrun = targets.get('loomrun-production');
  assert.ok(loomrun);
  assert.equal(loomrun.runtime.composeServices, 'web,api,redis');
  assert.equal(loomrun.runtime.builtServices, 'web,api');
  assert.equal(loomrun.runtime.healthServices, 'web,api');
  assert.equal(loomrun.runtime.publicBindings, '127.0.0.1:8107->80');
  assert.equal(loomrun.runtime.internalPorts, 'api:8002,redis:6379');
  assert.equal(loomrun.runtime.networks, 'loomrun_default,shared');
  assert.equal(loomrun.runtime.persistentMounts, '/srv/apps/loomrun/.env:/app/.env:ro,/srv/apps/loomrun/data/storage:/loomrun-storage');
  assert.equal(loomrun.runtime.candidateContextPolicy, 'loomrun-source-root-v1');
  assert.equal(loomrun.health.type, 'http');
  assert.equal(loomrun.health.url, 'http://127.0.0.1:8107/ready');
  assert.equal(loomrun.health.expectedStatus, 200);
  assert.equal(loomrun.runtime.healthContract, 'loomrun-web-root-api-ready-v1');
  assert.equal(loomrun.runtime.composeHealthPolicy, 'docker-healthcheck-required');
  assert.equal(loomrun.runtime.deploymentStatus, 'compose-helper-installed-and-staging-validated');
});

test("project target references resolve to matching target configs", () => {
  const targets = loadTargets(targetDir);
  for (const file of readdirSync(projectDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const project = yaml.load(readFileSync(join(projectDir, file), "utf8")) as {
      project: {
        id: string;
        deployment: { targetId: string; adapter: string; environment: string };
      };
    };
    const target = targets.get(project.project.deployment.targetId);
    assert.ok(target, `missing target for ${project.project.id}`);
    assert.equal(target.projectId, project.project.id);
    assert.equal(target.adapter, project.project.deployment.adapter);
    assert.equal(target.environment, project.project.deployment.environment);
  }
});

test("worker dispatch includes compose but dry-run returns before any adapter execution", () => {
  const server = readFileSync(serverPath, "utf8");
  assert.match(server, /t\.adapter === "exora-production"/);
  assert.match(server, /t\.adapter === "exora-static"/);
  assert.match(server, /t\.adapter === "compose"/);
  assert.match(server, /executeComposeDeployment/);
  assert.match(server, /adapter is not enabled for execution/);
  assert.match(server, /t\.adapter !== "compose"/);
  assert.doesNotMatch(server, /t\.adapter === "static"/);
  assert.ok(server.indexOf("b.dryRun === true") < server.lastIndexOf("executeComposeDeployment"));
});

test("worker preserves deployment audit records for failed live attempts", () => {
  const server = readFileSync(serverPath, "utf8");
  assert.match(server, /INSERT INTO deployments/);
  assert.ok(server.indexOf("INSERT INTO deployments") < server.indexOf("await client.query(\"BEGIN\")"));
  assert.match(server, /state='FAILED'/);
  assert.match(server, /state='LOCK_BUSY'/);
  assert.match(server, /stage: "deploy"/);
});
