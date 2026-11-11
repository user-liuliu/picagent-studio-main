ALTER TABLE suite_workbench.suite_tasks
  ALTER COLUMN plan_snapshot_id DROP NOT NULL,
  ALTER COLUMN plan_item_id DROP NOT NULL;

ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS origin_kind text NOT NULL DEFAULT 'suite_plan';
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS reverse_plan_id uuid REFERENCES suite_workbench.reverse_plans(id) ON DELETE RESTRICT;
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS reverse_reference_id uuid REFERENCES suite_workbench.reverse_references(id) ON DELETE RESTRICT;
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS reverse_prompt_version_id uuid REFERENCES suite_workbench.reverse_prompt_versions(id) ON DELETE RESTRICT;
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS reverse_task_group_id uuid;
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS source_library_reference_id uuid REFERENCES suite_workbench.library_references(id) ON DELETE RESTRICT;
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS source_resource_version_id text;
ALTER TABLE suite_workbench.suite_tasks ADD COLUMN IF NOT EXISTS source_revision integer NOT NULL DEFAULT 0;

ALTER TABLE suite_workbench.suite_tasks DROP CONSTRAINT IF EXISTS suite_tasks_origin_kind_check;
ALTER TABLE suite_workbench.suite_tasks ADD CONSTRAINT suite_tasks_origin_kind_check CHECK (origin_kind IN ('suite_plan','reverse_import')) NOT VALID;

CREATE TABLE IF NOT EXISTS suite_workbench.reverse_canvas_imports (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  reverse_plan_id uuid NOT NULL REFERENCES suite_workbench.reverse_plans(id) ON DELETE RESTRICT,
  task_group_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  task_ids_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (suite_id, idempotency_key)
);

ALTER TABLE suite_workbench.task_generation_attempts ALTER COLUMN source_input_image_id DROP NOT NULL;
ALTER TABLE suite_workbench.task_generation_attempts ADD COLUMN IF NOT EXISTS source_library_reference_id uuid REFERENCES suite_workbench.library_references(id) ON DELETE RESTRICT;
ALTER TABLE suite_workbench.task_generation_attempts ADD COLUMN IF NOT EXISTS source_resource_version_id text;
ALTER TABLE suite_workbench.task_generation_attempts DROP CONSTRAINT IF EXISTS task_generation_attempts_source_kind_check;
ALTER TABLE suite_workbench.task_generation_attempts ADD CONSTRAINT task_generation_attempts_source_kind_check CHECK (source_kind IN ('base','original','library')) NOT VALID;

CREATE INDEX IF NOT EXISTS reverse_canvas_imports_plan_idx ON suite_workbench.reverse_canvas_imports(reverse_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS suite_tasks_reverse_group_idx ON suite_workbench.suite_tasks(reverse_task_group_id, ordinal) WHERE origin_kind='reverse_import';
