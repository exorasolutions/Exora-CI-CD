import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

const Target = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  environment: z.string().min(1),
  adapter: z.enum(['pm2','systemd','static','compose','python']),
  rootPath: z.string().startsWith('/'),
  releaseRoot: z.string().startsWith('/'),
  currentPath: z.string().startsWith('/'),
  health: z.object({
    type: z.enum(['http','none']).default('http'),
    url: z.string().url().optional(),
    expectedStatus: z.number().int().min(100).max(599).optional(),
    timeoutMs: z.number().int().positive().default(10000)
  }).default({ type: 'none', timeoutMs: 10000 }),
  runtime: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(false)
});
export type Target = z.infer<typeof Target>;

export function loadTargets(dir = process.env.TARGET_CONFIG_DIR ?? '../config/targets'): Map<string, Target> {
  const result = new Map<string, Target>();
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return result;
  for (const file of fs.readdirSync(abs).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))) {
    const raw = yaml.load(fs.readFileSync(path.join(abs, file), 'utf8'));
    const parsed = Target.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid target config ${file}: ${parsed.error.message}`);
    if (result.has(parsed.data.id)) throw new Error(`Duplicate target id ${parsed.data.id}`);
    result.set(parsed.data.id, parsed.data);
  }
  return result;
}
