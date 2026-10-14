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

test("loads every target config with unique disabled production targets", () => {
  const targets = loadTargets(targetDir);
  for (const id of [
    "cab-production",
    "exora-crm-production",
    "exora-shared-services-production",
    "exora-production",
    "loomrun-web-production",
    "qlix-production",
    "sunkidz-web-production"
  ]) {
    assert.equal(targets.has(id), true, `missing target ${id}`);
  }

  for (const target of targets.values()) {
    assert.equal(target.environment, "production");
    assert.equal(target.rootPath.startsWith("/"), true);
    assert.equal(target.releaseRoot.startsWith(target.rootPath), true);
    if (!["exora-production", "example-static-production"].includes(target.id)) {
      assert.equal(target.enabled, false, `${target.id} must remain disabled until adapter execution is reviewed`);
      assert.match(target.rootPath, /^\/srv\/apps\//);
    }
  }
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
