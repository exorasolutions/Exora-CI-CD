BEGIN;

INSERT INTO deployment_targets (
  id, project_id, environment, adapter, target_path,
  health_url, health_expected_status, enabled
)
VALUES (
  'nomi-production', 'nomi', 'production', 'compose', '/srv/apps/nomi',
  NULL, 200, FALSE
)
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  environment = EXCLUDED.environment,
  adapter = EXCLUDED.adapter,
  target_path = EXCLUDED.target_path,
  health_url = EXCLUDED.health_url,
  health_expected_status = EXCLUDED.health_expected_status,
  enabled = FALSE;

COMMIT;
