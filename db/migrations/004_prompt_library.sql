CREATE SCHEMA IF NOT EXISTS prompt_library;

CREATE TABLE IF NOT EXISTS prompt_library.prompt_templates (
  id uuid PRIMARY KEY,
  code varchar(160) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  kind varchar(30) NOT NULL CHECK (kind IN ('planner', 'direct_generation', 'repair')),
  stage varchar(30) NOT NULL CHECK (stage IN ('base_refine', 'plan', 'task_image')),
  execution_target varchar(30) NOT NULL CHECK (execution_target IN ('llm', 'image_model')),
  input_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(input_schema) = 'array'),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  source_file text NOT NULL,
  source_heading text NOT NULL,
  source_sha256 char(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_sha256, source_heading)
);

CREATE TABLE IF NOT EXISTS prompt_library.prompt_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text NOT NULL,
  source_sha256 char(64) NOT NULL,
  imported_count integer NOT NULL CHECK (imported_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_templates_stage_idx ON prompt_library.prompt_templates (stage, created_at DESC);
