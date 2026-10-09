import Fastify from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Pool, PoolClient } from "pg";

type DeployRequest = {
  schemaVersion: number;
  projectId: string;
  environment: string;
  commitSha: string;
  artifact: { path: string; sha256: string };
  targetId: string;
  requestedBy: string;
  jenkinsBuild: string;
};

type Target = {
  id: string;
  projectId: string;
  environment: string;
  adapter: "static" | "pm2" | "systemd" | "compose";
  targetPath: string;
  healthUrl?: string;
  healthExpectedStatus?: number;
  enabled: boolean;
};

const app = Fastify({ logger: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const executionEnabled = process.env.DEPLOY_EXECUTION_ENABLED === "true";
const token = process.env.DEPLOY_WORKER_TOKEN ?? "";

function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function validSha(x: string) { return /^[a-f0-9]{40}$/i.test(x); }
function validDigest(x: string) { return /^[a-f0-9]{64}$/i.test(x); }

async function digest(file: string) {
  const h = crypto.createHash("sha256");
  h.update(await fs.readFile(file));
  return h.digest("hex");
}

async function target(client: PoolClient, id: string): Promise<Target | null> {
  const r = await client.query(
    `SELECT id, project_id AS "projectId", environment, adapter,
            target_path AS "targetPath", health_url AS "healthUrl",
            health_expected_status AS "healthExpectedStatus", enabled
       FROM deployment_targets WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}

async function lock(client: PoolClient, project: string, env: string) {
  const key = `${project}:${env}`;
  const r = await client.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]);
  return Boolean(r.rows[0]?.locked);
}

async function unlock(client: PoolClient, project: string, env: string) {
  await client.query(
    "SELECT pg_advisory_unlock(hashtext($1))", [`${project}:${env}`]);
}

async function health(t: Target) {
  if (!t.healthUrl) return { ok: true, skipped: true };
  const expected = t.healthExpectedStatus ?? 200;
  for (let i=1; i<=5; i++) {
    try {
      const r = await fetch(t.healthUrl, { signal: AbortSignal.timeout(10000) });
      if (r.status === expected) return { ok: true, attempts: i };
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, attempts: 5 };
}

app.get("/health/live", async () => ({ ok: true, executionEnabled }));

app.post("/deploy", async (req, reply) => {
  const auth = String(req.headers.authorization ?? "");
  if (!token || !equal(auth, `Bearer ${token}`))
    return reply.code(401).send({ error: "unauthorized" });

  const b = req.body as DeployRequest;
  if (b?.schemaVersion !== 1 || !b.projectId || !b.environment ||
      !validSha(b.commitSha) || !b.artifact?.path ||
      !validDigest(b.artifact.sha256) || !b.targetId) {
    return reply.code(400).send({ error: "invalid deployment contract" });
  }

  const client = await pool.connect();
  let locked = false;
  try {
    const t = await target(client, b.targetId);
    if (!t || !t.enabled)
      return reply.code(403).send({ error: "target disabled or unknown" });
    if (t.projectId !== b.projectId || t.environment !== b.environment)
      return reply.code(403).send({ error: "target mismatch" });

    const actual = await digest(b.artifact.path);
    if (actual.toLowerCase() !== b.artifact.sha256.toLowerCase())
      return reply.code(409).send({ error: "artifact digest mismatch" });

    await client.query("BEGIN");
    locked = await lock(client, b.projectId, b.environment);
    if (!locked) {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "deployment already in progress" });
    }

    const r = await client.query(
      `INSERT INTO deployments
       (project_id,environment,target_id,commit_sha,artifact_sha256,adapter,state,requested_by,jenkins_build)
       VALUES ($1,$2,$3,$4,$5,$6,'STARTED',$7,$8) RETURNING id`,
      [b.projectId,b.environment,b.targetId,b.commitSha,b.artifact.sha256,
       t.adapter,b.requestedBy,b.jenkinsBuild]);
    const id = r.rows[0].id;

    if (!executionEnabled) {
      await client.query(
        "UPDATE deployments SET state='DRY_RUN', finished_at=now() WHERE id=$1",[id]);
      await unlock(client,b.projectId,b.environment);
      locked=false;
      await client.query("COMMIT");
      return { ok:true, state:"DRY_RUN", deploymentId:id, targetId:t.id };
    }

    // Adapter execution remains intentionally disabled in this phase.
    // A later phase will invoke reviewed adapters using fixed targets.
    await client.query(
      "UPDATE deployments SET state='ADAPTER_PENDING' WHERE id=$1",[id]);

    const hc = await health(t);
    const state = hc.ok ? "SUCCEEDED" : "HEALTH_FAILED";
    await client.query(
      "UPDATE deployments SET state=$1, finished_at=now(), health_result=$2 WHERE id=$3",
      [state, JSON.stringify(hc), id]);

    await unlock(client,b.projectId,b.environment);
    locked=false;
    await client.query("COMMIT");
    return { ok:hc.ok, state, deploymentId:id, health:hc };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    req.log.error(e);
    return reply.code(500).send({error:"deployment processing failed"});
  } finally {
    if (locked) { try { await unlock(client,b.projectId,b.environment); } catch {} }
    client.release();
  }
});

app.listen({host:process.env.HOST ?? "127.0.0.1", port:Number(process.env.PORT ?? 3220)});
