import type { DeploymentAdapter, DeploymentContext } from "./types.js";

export class ComposeAdapter implements DeploymentAdapter {
  readonly name = "compose";
  async prepare(_ctx: DeploymentContext) {}
  async activate(_ctx: DeploymentContext) {
    // Phase 5: no shell execution. Later phase uses a registered compose project.
  }
}
