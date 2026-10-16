BEGIN;

-- Permit multiple targets for one project/environment.
-- Target IDs remain unique through the primary key.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname,
           array_agg(att.attname::text ORDER BY att.attname::text) AS columns
      FROM pg_constraint con
      JOIN unnest(con.conkey) AS key_col(attnum) ON TRUE
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = key_col.attnum
     WHERE con.conrelid = 'public.deployment_targets'::regclass
       AND con.contype = 'u'
     GROUP BY con.conname
  LOOP
    IF c.columns = ARRAY['environment', 'project_id']::text[] THEN
      EXECUTE format(
        'ALTER TABLE public.deployment_targets DROP CONSTRAINT %I',
        c.conname
      );
    END IF;
  END LOOP;
END $$;

-- Update the adapter allowlist while retaining other table constraints.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.deployment_targets'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%adapter%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.deployment_targets DROP CONSTRAINT %I',
      c.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.deployment_targets
  ADD CONSTRAINT deployment_targets_adapter_check
  CHECK (
    adapter IN (
      'static',
      'pm2',
      'systemd',
      'compose',
      'exora-production',
      'exora-static'
    )
  );

-- Preserve the existing MERN target, explicitly disabled.
UPDATE public.deployment_targets
   SET enabled = FALSE
 WHERE id = 'exora-production'
   AND project_id = 'exora';

-- Register the static website target but keep it disabled.
INSERT INTO public.deployment_targets (
  id,
  project_id,
  environment,
  adapter,
  target_path,
  health_url,
  health_expected_status,
  enabled
)
VALUES (
  'exora-static',
  'exora',
  'production',
  'exora-static',
  '/srv/apps/exora-website',
  'http://127.0.0.1:8110/',
  200,
  FALSE
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
