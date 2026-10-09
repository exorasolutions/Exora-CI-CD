import type { Project } from './project-registry.js';

export type TriggerInput = {
  project: Project;
  commitSha: string;
  repositoryUrl: string;
  deliveryId: string;
};

export class JenkinsClient {
  constructor(private readonly cfg: {
    baseUrl: string;
    jobName: string;
    user: string;
    apiToken: string;
    triggerToken?: string;
  }) {}

  async trigger(input: TriggerInput): Promise<{ queueUrl?: string }> {
    const jobPath = `/job/${encodeURIComponent(this.cfg.jobName)}/buildWithParameters`;
    const url = new URL(jobPath, ensureSlash(this.cfg.baseUrl));
    const params: Record<string, string> = {
      PROJECT_ID: input.project.id,
      REPOSITORY_URL: input.repositoryUrl,
      COMMIT_SHA: input.commitSha,
      BUILD_PROFILE: input.project.build.profile,
      AGENT_LABEL: input.project.build.agentLabel,
      TESTS_REQUIRED: String(input.project.build.testsRequired),
      DEPLOYMENT_MODE: input.project.deployment.mode,
      DEPLOYMENT_ADAPTER: input.project.deployment.adapter,
      TARGET_ID: input.project.deployment.targetId,
      ENVIRONMENT: input.project.deployment.environment,
      DELIVERY_ID: input.deliveryId
    };
    if (this.cfg.triggerToken) params.token = this.cfg.triggerToken;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const basic = Buffer.from(`${this.cfg.user}:${this.cfg.apiToken}`).toString('base64');
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Length': '0' },
      redirect: 'manual'
    });
    if (![200, 201, 202].includes(response.status)) {
      const body = await response.text();
      throw new Error(`Jenkins trigger failed (${response.status}): ${body.slice(0, 500)}`);
    }
    return { queueUrl: response.headers.get('location') ?? undefined };
  }
}

function ensureSlash(value: string) { return value.endsWith('/') ? value : `${value}/`; }
