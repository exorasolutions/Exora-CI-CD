import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertInside, sha256File } from "./artifact.js";
import { acquireLock, releaseLock } from "./deploy-lock.js";

test("verifies artifact checksums and rejects paths outside the staging root", async () => {
  const dir = path.join(tmpdir(), `central-cicd-artifact-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const artifact = path.join(dir, "release.tar.gz");
  writeFileSync(artifact, "artifact");
  const expected = createHash("sha256").update("artifact").digest("hex");

  assert.equal(await sha256File(artifact), expected);
  assert.equal(assertInside(artifact, dir), path.resolve(artifact));
  assert.throws(() => assertInside(path.join(dir, "..", "outside.tar.gz"), dir), /outside allowed staging root/);

  rmSync(dir, { recursive: true, force: true });
});

test("prevents concurrent deployments for the same target key", () => {
  const key = `exora:production:${process.pid}`;
  const token = acquireLock(key);
  assert.throws(() => acquireLock(key), /already in progress/);
  releaseLock(key, token);
  assert.doesNotThrow(() => {
    const next = acquireLock(key);
    releaseLock(key, next);
  });
});
