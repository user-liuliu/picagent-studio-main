CREATE TABLE IF NOT EXISTS suite_workbench.validation_rag_chunks (
  id text NOT NULL,
  source_version text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  content text NOT NULL,
  field_values_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_asset_paths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_sha256 char(64) NOT NULL,
  source_kind text NOT NULL CHECK (source_kind = 'validation_seed'),
  status text NOT NULL CHECK (status IN ('published', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, source_version)
);

CREATE TABLE IF NOT EXISTS suite_workbench.plan_generation_attempts (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  template_version_id uuid NOT NULL REFERENCES prompt_library.prompt_template_versions(id) ON DELETE RESTRICT,
  dynamic_input_json jsonb NOT NULL,
  human_input_json jsonb NOT NULL,
  selected_chunks_json jsonb NOT NULL,
  input_image_ids_json jsonb NOT NULL,
  base_version_ids_json jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  is_fake boolean NOT NULL DEFAULT false,
  error_code text,
  error_message text,
  output_summary_json jsonb,
  snapshot_id uuid,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (suite_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS suite_workbench.plan_snapshots (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  revision_kind text NOT NULL CHECK (revision_kind IN ('llm', 'human')),
  parent_snapshot_id uuid REFERENCES suite_workbench.plan_snapshots(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES prompt_library.prompt_template_versions(id) ON DELETE RESTRICT,
  dynamic_input_json jsonb NOT NULL,
  human_input_json jsonb NOT NULL,
  input_image_ids_json jsonb NOT NULL,
  base_version_ids_json jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  is_fake boolean NOT NULL,
  request_summary_json jsonb NOT NULL,
  raw_output_summary_json jsonb NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (suite_id, revision_number)
);

CREATE TABLE IF NOT EXISTS suite_workbench.plan_chunk_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_snapshot_id uuid NOT NULL REFERENCES suite_workbench.plan_snapshots(id) ON DELETE RESTRICT,
  source_chunk_id text NOT NULL,
  source_version text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  field_values_json jsonb NOT NULL,
  source_kind text NOT NULL,
  source_asset_paths_json jsonb NOT NULL,
  content_sha256 char(64) NOT NULL,
  UNIQUE (plan_snapshot_id, source_chunk_id)
);

CREATE TABLE IF NOT EXISTS suite_workbench.plan_items (
  id uuid PRIMARY KEY,
  plan_snapshot_id uuid NOT NULL REFERENCES suite_workbench.plan_snapshots(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  title text NOT NULL,
  purpose text NOT NULL,
  prompt text NOT NULL,
  UNIQUE (plan_snapshot_id, ordinal)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_attempt_snapshot_fk') THEN
    ALTER TABLE suite_workbench.plan_generation_attempts ADD CONSTRAINT plan_attempt_snapshot_fk FOREIGN KEY (snapshot_id) REFERENCES suite_workbench.plan_snapshots(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS validation_rag_chunks_search_idx ON suite_workbench.validation_rag_chunks USING gin (to_tsvector('simple', title || ' ' || summary || ' ' || content));
CREATE INDEX IF NOT EXISTS plan_attempts_suite_created_idx ON suite_workbench.plan_generation_attempts(suite_id, created_at DESC);

CREATE OR REPLACE FUNCTION suite_workbench.protect_plan_snapshot() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'plan snapshots are immutable'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS protect_plan_snapshot ON suite_workbench.plan_snapshots;
CREATE TRIGGER protect_plan_snapshot BEFORE UPDATE OR DELETE ON suite_workbench.plan_snapshots FOR EACH ROW EXECUTE FUNCTION suite_workbench.protect_plan_snapshot();
