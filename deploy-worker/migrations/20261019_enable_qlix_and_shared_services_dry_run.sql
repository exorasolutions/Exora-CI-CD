BEGIN;
INSERT INTO deployment_targets (id, project_id, environment, adapter, target_path, health_url, health_expected_status, enabled) VALUES
  ('qlix-production', 'qlix', 'production', 'compose', '/srv/apps/qlix', 'http://127.0.0.1:4000/api/v1/health', 200, TRUE),
  ('exora-shared-services-production', 'exora-shared-services', 'production', 'compose', '/srv/apps/shared', NULL, 200, TRUE)
ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id, environment=EXCLUDED.environment, adapter=EXCLUDED.adapter, target_path=EXCLUDED.target_path, health_url=EXCLUDED.health_url, health_expected_status=EXCLUDED.health_expected_status, enabled=TRUE;
COMMIT;
