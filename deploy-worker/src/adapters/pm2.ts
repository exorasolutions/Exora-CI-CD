import type { DeploymentAdapter, DeploymentContext } from "./types.js";

export class Pm2Adapter implements DeploymentAdapter {
  readonly name = "pm2";
  async prepare(_ctx: DeploymentContext) {}
  async activate(_ctx: DeploymentContext) {
    // Phase 5: no shell execution. Later phase uses a fixed process name
    // and a least-privilege helper.
  }
}
