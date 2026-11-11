ALTER TABLE suite_workbench.plan_items
  ADD COLUMN IF NOT EXISTS image_type text;

UPDATE suite_workbench.plan_items
SET image_type = 'main'
WHERE image_type IS NULL;

ALTER TABLE suite_workbench.plan_items
  ALTER COLUMN image_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_items_image_type_check') THEN
    ALTER TABLE suite_workbench.plan_items
      ADD CONSTRAINT plan_items_image_type_check CHECK (image_type IN ('main', 'detail'));
  END IF;
END $$;
