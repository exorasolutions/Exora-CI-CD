import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

export const ProjectFile = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    enabled: z.boolean().default(true),
    github: z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      repositoryId: z.coerce.number().int().positive().optional(),
      branch: z.string().min(1)
    }),
    build: z.object({
      profile: z.string().min(1),
      agentLabel: z.string().min(1).default('linux-build'),
      testsRequired: z.boolean().default(true),
      timeoutMinutes: z.number().int().min(1).max(180).default(30)
    }),
    deployment: z.object({
      mode: z.enum(['manual', 'automatic']),
      adapter: z.enum(['pm2', 'systemd', 'static', 'compose', 'python', 'exora-production']),
      targetId: z.string().min(1),
      environment: z.string().min(1).default('production')
    }),
    healthCheck: z.object({
      type: z.enum(['http', 'none']).default('http'),
      url: z.string().url().optional()
    }).optional()
  })
});

export type Project = z.infer<typeof ProjectFile>['project'];

export class ProjectRegistry {
  #byId = new Map<string, Project>();
  #byRepo = new Map<string, Project>();

  constructor(private readonly directory: string) {}

  async reload() {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const byId = new Map<string, Project>();
    const byRepo = new Map<string, Project>();

    for (const entry of entries) {
      if (!entry.isFile() || !/\.(ya?ml)$/i.test(entry.name)) continue;
      const raw = await readFile(join(this.directory, entry.name), 'utf8');
      const parsed = ProjectFile.parse(YAML.parse(raw));
      const project = parsed.project;
      const repoKey = `${project.github.owner}/${project.github.repo}`.toLowerCase();
      if (byId.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`);
      if (byRepo.has(repoKey)) throw new Error(`Duplicate repository mapping: ${repoKey}`);
      byId.set(project.id, project);
      byRepo.set(repoKey, project);
    }

    this.#byId = byId;
    this.#byRepo = byRepo;
  }

  list() { return [...this.#byId.values()]; }
  getById(id: string) { return this.#byId.get(id); }
  getByRepo(fullName: string) { return this.#byRepo.get(fullName.toLowerCase()); }
}
