ALTER TABLE suite_workbench.plan_items
  ADD COLUMN IF NOT EXISTS category_code text,
  ADD COLUMN IF NOT EXISTS reference_image_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allows_text_overlay text,
  ADD COLUMN IF NOT EXISTS text_content_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS aspect_ratio text,
  ADD COLUMN IF NOT EXISTS suggested_params_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS global_style_card_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt_sha256 char(64);

ALTER TABLE suite_workbench.suite_tasks
  ADD COLUMN IF NOT EXISTS category_code text,
  ADD COLUMN IF NOT EXISTS reference_image_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS global_style_card_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt_sha256 char(64);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_items_allows_text_overlay_check') THEN
    ALTER TABLE suite_workbench.plan_items ADD CONSTRAINT plan_items_allows_text_overlay_check CHECK (allows_text_overlay IS NULL OR allows_text_overlay IN ('platform_default','yes','no'));
  END IF;
END $$;
