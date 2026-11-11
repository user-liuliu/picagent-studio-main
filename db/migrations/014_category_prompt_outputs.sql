ALTER TABLE suite_workbench.plan_snapshots
  ADD COLUMN IF NOT EXISTS category_outputs_json jsonb NOT NULL DEFAULT '{}'::jsonb;
