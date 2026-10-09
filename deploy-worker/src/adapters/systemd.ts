import type { DeploymentAdapter, DeploymentContext } from "./types.js";

export class SystemdAdapter implements DeploymentAdapter {
  readonly name = "systemd";
  async prepare(_ctx: DeploymentContext) {}
  async activate(_ctx: DeploymentContext) {
    // Phase 5: no shell execution. Later phase invokes only a registered unit.
  }
}
