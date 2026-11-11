ALTER TABLE prompt_library.prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_stage_check;
ALTER TABLE prompt_library.prompt_template_versions DROP CONSTRAINT IF EXISTS prompt_template_versions_stage_check;

-- Normalize legacy rows before validating the V1 stage contract.
UPDATE prompt_library.prompt_templates
SET stage = 'task_image'
WHERE stage NOT IN ('base_refine', 'plan', 'structure_plan', 'category_prompt', 'task_image', 'reverse_prompt');

UPDATE prompt_library.prompt_template_versions
SET stage = 'task_image'
WHERE stage NOT IN ('base_refine', 'plan', 'structure_plan', 'category_prompt', 'task_image', 'reverse_prompt');

ALTER TABLE prompt_library.prompt_templates
  ADD CONSTRAINT prompt_templates_stage_check CHECK (stage IN ('base_refine', 'plan', 'structure_plan', 'category_prompt', 'task_image', 'reverse_prompt')) NOT VALID;
ALTER TABLE prompt_library.prompt_template_versions
  ADD CONSTRAINT prompt_template_versions_stage_check CHECK (stage IN ('base_refine', 'plan', 'structure_plan', 'category_prompt', 'task_image', 'reverse_prompt')) NOT VALID;
