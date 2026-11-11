CREATE TABLE IF NOT EXISTS suite_workbench.library_references (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  resource_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('prompt_template','input_image','base_image','task_image_version','process_image')),
  target_type text NOT NULL CHECK (target_type IN ('plan','task')),
  target_id text NOT NULL,
  resource_version_id text NOT NULL,
  snapshot_json jsonb NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  archived_at timestamptz,
  UNIQUE (suite_id, idempotency_key),
  UNIQUE (suite_id, resource_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS library_references_target_idx
  ON suite_workbench.library_references (suite_id, target_type, target_id, created_at DESC);
