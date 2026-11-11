CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_drafts (
  session_id text PRIMARY KEY,
  operations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_ocr_snapshots (
  session_id text NOT NULL,
  source_version_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed')),
  blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, source_version_id)
);

CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_snapshots (
  id uuid PRIMARY KEY,
  source_card_id text NOT NULL,
  source_version_id text NOT NULL,
  parent_version_id text NOT NULL,
  summary text NOT NULL,
  operations_json jsonb NOT NULL,
  provider_json jsonb NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_child_tasks (
  id uuid PRIMARY KEY,
  source_card_id text NOT NULL,
  source_version_id text NOT NULL,
  parent_version_id text NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES suite_workbench.image_edit_snapshots(id) ON DELETE RESTRICT,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','queued','generating','succeeded','failed')),
  current_version_id uuid,
  final_version_id uuid,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_attempts (
  id uuid PRIMARY KEY,
  child_task_id uuid NOT NULL REFERENCES suite_workbench.image_edit_child_tasks(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES suite_workbench.image_edit_snapshots(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  command_json jsonb NOT NULL,
  provider_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('generating','succeeded','failed')),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (child_task_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_versions (
  id uuid PRIMARY KEY,
  child_task_id uuid NOT NULL REFERENCES suite_workbench.image_edit_child_tasks(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE REFERENCES suite_workbench.image_edit_attempts(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  object_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (child_task_id, version_number)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'image_edit_child_current_fk') THEN
    ALTER TABLE suite_workbench.image_edit_child_tasks ADD CONSTRAINT image_edit_child_current_fk FOREIGN KEY (current_version_id) REFERENCES suite_workbench.image_edit_versions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'image_edit_child_final_fk') THEN
    ALTER TABLE suite_workbench.image_edit_child_tasks ADD CONSTRAINT image_edit_child_final_fk FOREIGN KEY (final_version_id) REFERENCES suite_workbench.image_edit_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS suite_workbench.image_edit_idempotency (
  idempotency_key text PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES suite_workbench.image_edit_snapshots(id) ON DELETE RESTRICT,
  child_task_id uuid NOT NULL REFERENCES suite_workbench.image_edit_child_tasks(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES suite_workbench.image_edit_attempts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
