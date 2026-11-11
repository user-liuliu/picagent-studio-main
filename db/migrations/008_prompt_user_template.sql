ALTER TABLE prompt_library.prompt_template_versions
  ADD COLUMN IF NOT EXISTS user_prompt_template text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION prompt_library.protect_published_prompt_version() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('published', 'retired') AND (
    NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.stage IS DISTINCT FROM OLD.stage OR
    NEW.execution_target IS DISTINCT FROM OLD.execution_target OR NEW.input_schema IS DISTINCT FROM OLD.input_schema OR
    NEW.output_schema IS DISTINCT FROM OLD.output_schema OR NEW.applicability IS DISTINCT FROM OLD.applicability OR
    NEW.body IS DISTINCT FROM OLD.body OR NEW.user_prompt_template IS DISTINCT FROM OLD.user_prompt_template OR
    NEW.source_file IS DISTINCT FROM OLD.source_file OR NEW.source_heading IS DISTINCT FROM OLD.source_heading OR
    NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
  ) THEN
    RAISE EXCEPTION 'published prompt versions are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
