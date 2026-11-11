ALTER TABLE suite_workbench.library_references
  DROP CONSTRAINT IF EXISTS library_references_resource_type_check;
ALTER TABLE suite_workbench.library_references
  ADD CONSTRAINT library_references_resource_type_check CHECK (resource_type IN ('prompt_template','input_image','base_image','task_image_version','process_image','reverse_reference_asset'));

CREATE TABLE IF NOT EXISTS suite_workbench.reverse_reference_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  prompt_snapshot_json jsonb NOT NULL,
  visual_structure_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS reverse_reference_assets_status_idx ON suite_workbench.reverse_reference_assets (status, updated_at DESC);
