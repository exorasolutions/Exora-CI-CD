export type DeploymentContext = {
  projectId: string;
  environment: string;
  targetId: string;
  targetRoot: string;
  releaseId: string;
  artifactPath: string;
  processName?: string;
  systemdUnit?: string;
  composeFile?: string;
};

export type DeployContext = {
  releaseId: string;
  artifactPath: string;
  target: {
    releaseRoot: string;
    currentPath: string;
    runtime: Record<string, string>;
  };
};

export interface DeploymentAdapter {
  readonly name: string;
  prepare(ctx: DeploymentContext): Promise<void>;
  activate(ctx: DeploymentContext): Promise<void>;
}
