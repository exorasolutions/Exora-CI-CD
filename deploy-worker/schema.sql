CREATE TABLE IF NOT EXISTS deployment_targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('static','pm2','systemd','compose','exora-production')),
  target_path TEXT NOT NULL,
  health_url TEXT,
  health_expected_status INTEGER NOT NULL DEFAULT 200,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(project_id, environment)
);

CREATE TABLE IF NOT EXISTS deployments (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES deployment_targets(id),
  commit_sha CHAR(40) NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  adapter TEXT NOT NULL,
  state TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  jenkins_build TEXT,
  health_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS deployments_project_env_idx
ON deployments(project_id, environment, created_at DESC);
