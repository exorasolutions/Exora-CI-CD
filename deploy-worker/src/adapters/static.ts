import { ReleaseManager } from "../release/releaseManager.js";
import type { DeploymentAdapter, DeploymentContext } from "./types.js";

export class StaticAdapter implements DeploymentAdapter {
  readonly name = "static";
  async prepare(ctx: DeploymentContext) {
    await new ReleaseManager(ctx.targetRoot).prepare(ctx.releaseId);
    // Artifact extraction/copy is intentionally added only after archive validation.
  }
  async activate(ctx: DeploymentContext) {
    await new ReleaseManager(ctx.targetRoot).activate(ctx.releaseId);
  }
}
