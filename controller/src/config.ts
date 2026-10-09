import { resolve } from 'node:path';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3210),
  PROJECT_CONFIG_DIR: z.string().default('../config/projects'),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  JENKINS_BASE_URL: z.string().url(),
  JENKINS_JOB_NAME: z.string().min(1).default('central-cicd-build'),
  JENKINS_USER: z.string().min(1),
  JENKINS_API_TOKEN: z.string().min(1),
  JENKINS_TRIGGER_TOKEN: z.string().min(12).optional(),
  JENKINS_CA_FILE: z.string().optional()
});

export type AppConfig = z.infer<typeof Env> & { projectConfigDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.parse(env);
  return {
    ...parsed,
    projectConfigDir: resolve(process.cwd(), parsed.PROJECT_CONFIG_DIR)
  };
}
