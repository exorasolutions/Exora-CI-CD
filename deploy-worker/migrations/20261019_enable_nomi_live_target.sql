BEGIN;

UPDATE deployment_targets
   SET health_url = NULL,
       health_expected_status = 200,
       enabled = TRUE
 WHERE id = 'nomi-production'
   AND project_id = 'nomi'
   AND environment = 'production'
   AND adapter = 'compose'
   AND target_path = '/srv/apps/nomi';

COMMIT;
