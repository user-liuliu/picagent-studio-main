CREATE TABLE IF NOT EXISTS suite_workbench.suite_tasks (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  plan_snapshot_id uuid NOT NULL REFERENCES suite_workbench.plan_snapshots(id) ON DELETE RESTRICT,
  plan_item_id uuid NOT NULL REFERENCES suite_workbench.plan_items(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  image_type text NOT NULL CHECK (image_type IN ('main', 'detail')),
  title text NOT NULL,
  purpose text NOT NULL,
  prompt_draft text NOT NULL,
  prompt_revision integer NOT NULL DEFAULT 1 CHECK (prompt_revision > 0),
  source_input_image_id uuid REFERENCES suite_workbench.input_images(id) ON DELETE RESTRICT,
  generation_params_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('incomplete','pending','generating','generated','refining','failed','archived')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (suite_id, plan_item_id)
);

CREATE TABLE IF NOT EXISTS suite_workbench.task_generation_batches (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('batch','single','retry')),
  requested_count integer NOT NULL CHECK (requested_count > 0),
  task_ids_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (suite_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS suite_workbench.task_result_slots (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES suite_workbench.task_generation_batches(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES suite_workbench.suite_tasks(id) ON DELETE RESTRICT,
  slot_ordinal integer NOT NULL CHECK (slot_ordinal > 0),
  retry_of_slot_id uuid REFERENCES suite_workbench.task_result_slots(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending','generating','succeeded','failed')),
  selected_version_id uuid,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (batch_id, task_id)
);

CREATE TABLE IF NOT EXISTS suite_workbench.task_generation_attempts (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL REFERENCES suite_workbench.task_result_slots(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  provider text NOT NULL,
  model text NOT NULL,
  endpoint text NOT NULL CHECK (endpoint = '/v1/images/edits'),
  request_summary_json jsonb NOT NULL,
  prompt_snapshot_json jsonb NOT NULL,
  prompt_sha256 char(64) NOT NULL,
  context_snapshot_json jsonb NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('base','original')),
  source_object_key text NOT NULL,
  source_input_image_id uuid NOT NULL REFERENCES suite_workbench.input_images(id) ON DELETE RESTRICT,
  source_base_version_id uuid REFERENCES suite_workbench.base_image_versions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  error_code text,
  error_message text,
  external_request_id text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  UNIQUE (slot_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS suite_workbench.task_image_versions (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES suite_workbench.suite_tasks(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES suite_workbench.task_result_slots(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE REFERENCES suite_workbench.task_generation_attempts(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  object_key text NOT NULL UNIQUE,
  process_object_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  sha256 char(64) NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  mime_type text NOT NULL,
  prompt_snapshot_json jsonb NOT NULL,
  context_snapshot_json jsonb NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  is_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  UNIQUE (task_id, version_number)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_result_slots_selected_version_fk') THEN
    ALTER TABLE suite_workbench.task_result_slots
      ADD CONSTRAINT task_result_slots_selected_version_fk
      FOREIGN KEY (selected_version_id) REFERENCES suite_workbench.task_image_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS task_image_versions_current_idx
  ON suite_workbench.task_image_versions(task_id) WHERE is_current;
CREATE UNIQUE INDEX IF NOT EXISTS task_image_versions_final_idx
  ON suite_workbench.task_image_versions(task_id) WHERE is_final;
CREATE INDEX IF NOT EXISTS suite_tasks_suite_ordinal_idx
  ON suite_workbench.suite_tasks(suite_id, ordinal);
CREATE INDEX IF NOT EXISTS task_batches_suite_created_idx
  ON suite_workbench.task_generation_batches(suite_id, created_at DESC);

CREATE TABLE IF NOT EXISTS suite_workbench.suite_canvas_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid NOT NULL UNIQUE REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  layout_version integer NOT NULL DEFAULT 1 CHECK (layout_version > 0),
  viewport_json jsonb NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  nodes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  groups_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
