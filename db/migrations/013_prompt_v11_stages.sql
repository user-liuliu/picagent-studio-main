DO $$
BEGIN
  ALTER TABLE prompt_library.prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_stage_check;
  ALTER TABLE prompt_library.prompt_templates
    ADD CONSTRAINT prompt_templates_stage_check CHECK (stage IN ('base_refine', 'plan', 'structure_plan', 'category_prompt', 'task_image', 'reverse_prompt')) NOT VALID;
  ALTER TABLE prompt_library.prompt_template_versions DROP CONSTRAINT IF EXISTS prompt_template_versions_stage_check;
  ALTER TABLE prompt_library.prompt_template_versions
    ADD CONSTRAINT prompt_template_versions_stage_check CHECK (stage IN ('base_refine', 'plan', 'structure_plan', 'category_prompt', 'task_image', 'reverse_prompt')) NOT VALID;
END $$;

CREATE INDEX IF NOT EXISTS prompt_template_versions_v11_stage_idx
  ON prompt_library.prompt_template_versions(stage, created_at DESC);
