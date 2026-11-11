CREATE TABLE IF NOT EXISTS suite_workbench.generation_attempts (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  input_image_id uuid NOT NULL REFERENCES suite_workbench.input_images(id) ON DELETE RESTRICT,
  base_version_id uuid NOT NULL UNIQUE,
  version_number integer NOT NULL CHECK (version_number > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) > 0),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  model text NOT NULL CHECK (model = 'gpt-image-2'),
  endpoint text NOT NULL CHECK (endpoint = '/v1/images/edits'),
  prompt text NOT NULL,
  size text NOT NULL CHECK (size = '1K'),
  quality text NOT NULL CHECK (quality = 'medium'),
  n integer NOT NULL CHECK (n = 1),
  response_format text NOT NULL CHECK (response_format = 'b64_json'),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (input_image_id, idempotency_key),
  CHECK ((status = 'running' AND completed_at IS NULL AND error_code IS NULL) OR (status = 'succeeded' AND completed_at IS NOT NULL AND error_code IS NULL) OR (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS suite_workbench.base_image_versions (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  input_image_id uuid NOT NULL REFERENCES suite_workbench.input_images(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE REFERENCES suite_workbench.generation_attempts(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  object_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  created_at timestamptz NOT NULL,
  UNIQUE (input_image_id, version_number),
  CHECK (position(('suites/' || suite_id::text || '/inputs/' || input_image_id::text || '/base/' || id::text || '/') in object_key) = 1)
);

ALTER TABLE suite_workbench.input_images ADD COLUMN IF NOT EXISTS current_base_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'input_images_current_base_version_id_fkey') THEN
    ALTER TABLE suite_workbench.input_images
      ADD CONSTRAINT input_images_current_base_version_id_fkey
      FOREIGN KEY (current_base_version_id) REFERENCES suite_workbench.base_image_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS generation_attempts_input_created_idx ON suite_workbench.generation_attempts (input_image_id, created_at DESC);
CREATE INDEX IF NOT EXISTS base_image_versions_input_version_idx ON suite_workbench.base_image_versions (input_image_id, version_number DESC);
