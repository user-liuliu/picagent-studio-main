CREATE TABLE IF NOT EXISTS prompt_library.prompt_template_versions (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES prompt_library.prompt_templates(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  name varchar(200) NOT NULL,
  kind varchar(30) NOT NULL CHECK (kind IN ('planner', 'direct_generation', 'repair')),
  stage varchar(30) NOT NULL CHECK (stage IN ('base_refine', 'plan', 'task_image')),
  execution_target varchar(30) NOT NULL CHECK (execution_target IN ('llm', 'image_model')),
  input_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(input_schema) = 'array'),
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_schema) = 'object'),
  applicability jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(applicability) = 'object'),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  source_file text NOT NULL,
  source_heading text NOT NULL,
  source_sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (template_id, version_no),
  UNIQUE (template_id, source_sha256, source_heading)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'prompt_library' AND table_name = 'prompt_templates' AND column_name = 'body'
  ) THEN
    INSERT INTO prompt_library.prompt_template_versions
      (id, template_id, version_no, name, kind, stage, execution_target, input_schema, output_schema, applicability, body, status, source_file, source_heading, source_sha256, created_at)
    SELECT gen_random_uuid(), id, 1, name, kind, stage, execution_target, input_schema, '{}'::jsonb, '{}'::jsonb, body, 'draft', source_file, source_heading, source_sha256, created_at
    FROM prompt_library.prompt_templates
    ON CONFLICT (template_id, source_sha256, source_heading) DO NOTHING;
  END IF;
END $$;

DROP INDEX IF EXISTS prompt_library.prompt_templates_stage_idx;
ALTER TABLE prompt_library.prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_status_check;
ALTER TABLE prompt_library.prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_source_sha256_source_heading_key;
ALTER TABLE prompt_library.prompt_templates
  DROP COLUMN IF EXISTS input_schema,
  DROP COLUMN IF EXISTS body,
  DROP COLUMN IF EXISTS source_file,
  DROP COLUMN IF EXISTS source_heading,
  DROP COLUMN IF EXISTS source_sha256,
  DROP COLUMN IF EXISTS status;
ALTER TABLE prompt_library.prompt_templates ADD COLUMN IF NOT EXISTS lifecycle_status varchar(20) NOT NULL DEFAULT 'active';
ALTER TABLE prompt_library.prompt_templates ADD COLUMN IF NOT EXISTS published_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_lifecycle_status_check') THEN
    ALTER TABLE prompt_library.prompt_templates ADD CONSTRAINT prompt_templates_lifecycle_status_check CHECK (lifecycle_status IN ('active', 'disabled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_templates_published_version_fk') THEN
    ALTER TABLE prompt_library.prompt_templates ADD CONSTRAINT prompt_templates_published_version_fk FOREIGN KEY (published_version_id) REFERENCES prompt_library.prompt_template_versions(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS prompt_template_versions_one_published_idx
  ON prompt_library.prompt_template_versions(template_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS prompt_template_versions_stage_idx
  ON prompt_library.prompt_template_versions(stage, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_imports_source_idx
  ON prompt_library.prompt_imports(source_file, source_sha256);

CREATE OR REPLACE FUNCTION prompt_library.protect_published_prompt_version() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('published', 'retired') AND (
    NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.stage IS DISTINCT FROM OLD.stage OR
    NEW.execution_target IS DISTINCT FROM OLD.execution_target OR NEW.input_schema IS DISTINCT FROM OLD.input_schema OR
    NEW.output_schema IS DISTINCT FROM OLD.output_schema OR NEW.applicability IS DISTINCT FROM OLD.applicability OR
    NEW.body IS DISTINCT FROM OLD.body OR NEW.source_file IS DISTINCT FROM OLD.source_file OR
    NEW.source_heading IS DISTINCT FROM OLD.source_heading OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
  ) THEN
    RAISE EXCEPTION 'published prompt versions are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS protect_published_prompt_version ON prompt_library.prompt_template_versions;
CREATE TRIGGER protect_published_prompt_version BEFORE UPDATE ON prompt_library.prompt_template_versions
  FOR EACH ROW EXECUTE FUNCTION prompt_library.protect_published_prompt_version();

ALTER TABLE suite_workbench.generation_attempts ADD COLUMN IF NOT EXISTS prompt_template_version_id uuid;
ALTER TABLE suite_workbench.generation_attempts ADD COLUMN IF NOT EXISTS dynamic_input_json jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_attempts_prompt_template_version_fk') THEN
    ALTER TABLE suite_workbench.generation_attempts ADD CONSTRAINT generation_attempts_prompt_template_version_fk FOREIGN KEY (prompt_template_version_id) REFERENCES prompt_library.prompt_template_versions(id);
  END IF;
END $$;
