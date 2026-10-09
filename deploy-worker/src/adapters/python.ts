import { execFileAsync, prepareRelease } from './common.js';
import type { DeployContext } from './types.js';
export async function deployPython(ctx: DeployContext) {
  const release = await prepareRelease(ctx);
  await execFileAsync('tar', ['-xzf', ctx.artifactPath, '-C', release, '--no-same-owner', '--no-same-permissions']);
  const unit = ctx.target.runtime.unit;
  if (!unit) throw new Error('python target missing runtime.unit');
  await execFileAsync('systemctl', ['restart', unit]);
  return { releasePath: release };
}
