ALTER TABLE suite_workbench.image_edit_snapshots
  ADD COLUMN IF NOT EXISTS source_prompt text NOT NULL DEFAULT '';
