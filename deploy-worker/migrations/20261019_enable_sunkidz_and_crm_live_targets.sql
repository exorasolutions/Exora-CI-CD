BEGIN;

INSERT INTO deployment_targets (id, project_id, environment, adapter, target_path, health_url, health_expected_status, enabled)
VALUES
  ('sunkidz-production', 'sunkidz', 'production', 'compose', '/srv/apps/sunkidz', NULL, 200, TRUE),
  ('exora-crm-production', 'exora-crm', 'production', 'compose', '/srv/apps/exora_crm', NULL, 200, TRUE)
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  environment = EXCLUDED.environment,
  adapter = EXCLUDED.adapter,
  target_path = EXCLUDED.target_path,
  health_url = EXCLUDED.health_url,
  health_expected_status = EXCLUDED.health_expected_status,
  enabled = TRUE;

COMMIT;
