import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { loadConfig } from './config.js';
import { DeliveryDedupe } from './lib/delivery-dedupe.js';
import { branchFromRef, parsePush, verifyGitHubSignature } from './lib/github.js';
import { JenkinsClient } from './lib/jenkins-client.js';
import { ProjectRegistry } from './lib/project-registry.js';

const cfg = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
await app.register(sensible);

// Replace Fastify's default JSON parser so the exact request bytes remain available
// for GitHub HMAC verification. Parsing happens only after raw bytes are captured.
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  try {
    const raw = body as Buffer;
    (request as typeof request & { rawBody?: Buffer }).rawBody = raw;
    done(null, JSON.parse(raw.toString('utf8')));
  } catch (error) {
    done(error as Error, undefined);
  }
});

const registry = new ProjectRegistry(cfg.projectConfigDir);
await registry.reload();
const dedupe = new DeliveryDedupe();
const jenkins = new JenkinsClient({
  baseUrl: cfg.JENKINS_BASE_URL,
  jobName: cfg.JENKINS_JOB_NAME,
  user: cfg.JENKINS_USER,
  apiToken: cfg.JENKINS_API_TOKEN,
  triggerToken: cfg.JENKINS_TRIGGER_TOKEN
});

app.get('/health/live', async () => ({ ok: true, service: 'central-cicd-controller', version: '0.2.0' }));
app.get('/health/ready', async () => ({ ok: true, projects: registry.list().length }));
app.get('/api/projects', async () => registry.list());
app.post('/api/projects/reload', async (_request, reply) => {
  await registry.reload();
  return reply.send({ ok: true, projects: registry.list().length });
});

app.post('/webhooks/github', async (request, reply) => {
  const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return reply.badRequest('Missing raw request body');

  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  if (!verifyGitHubSignature(rawBody, signature, cfg.GITHUB_WEBHOOK_SECRET)) {
    return reply.unauthorized('Invalid webhook signature');
  }

  const event = request.headers['x-github-event'] as string | undefined;
  const deliveryId = request.headers['x-github-delivery'] as string | undefined;
  if (!deliveryId) return reply.badRequest('Missing GitHub delivery id');
  if (dedupe.hasOrAdd(deliveryId)) return reply.code(202).send({ accepted: true, duplicate: true });

  if (event !== 'push') return reply.code(202).send({ accepted: true, ignored: true, reason: `event:${event ?? 'unknown'}` });

  const push = parsePush(request.body);
  if (push.deleted) return reply.code(202).send({ accepted: true, ignored: true, reason: 'deleted-ref' });
  const branch = branchFromRef(push.ref);
  if (!branch) return reply.code(202).send({ accepted: true, ignored: true, reason: 'not-a-branch' });

  const project = registry.getByRepo(push.repository.full_name);
  if (!project || !project.enabled) return reply.code(202).send({ accepted: true, ignored: true, reason: 'unregistered-or-disabled-project' });
  if (project.github.repositoryId && project.github.repositoryId !== push.repository.id) {
    request.log.warn({ configured: project.github.repositoryId, received: push.repository.id }, 'repository id mismatch');
    return reply.code(202).send({ accepted: true, ignored: true, reason: 'repository-id-mismatch' });
  }
  if (branch !== project.github.branch) return reply.code(202).send({ accepted: true, ignored: true, reason: 'branch-not-deployable', branch });

  const triggered = await jenkins.trigger({ project, commitSha: push.after, repositoryUrl: push.repository.clone_url, deliveryId });
  request.log.info({ projectId: project.id, sha: push.after, branch, queueUrl: triggered.queueUrl }, 'jenkins job triggered');
  return reply.code(202).send({ accepted: true, triggered: true, projectId: project.id, commitSha: push.after, queueUrl: triggered.queueUrl });
});

await app.listen({ host: cfg.HOST, port: cfg.PORT });
