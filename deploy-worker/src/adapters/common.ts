import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeployContext } from './types.js';
export const execFileAsync = promisify(execFile);
export async function prepareRelease(ctx: DeployContext): Promise<string> {
  const release = path.join(ctx.target.releaseRoot, ctx.releaseId);
  await fs.mkdir(release, { recursive: true });
  return release;
}
export async function atomicCurrent(release: string, current: string): Promise<void> {
  const tmp = `${current}.next-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.symlink(release, tmp);
  await fs.rename(tmp, current);
}
