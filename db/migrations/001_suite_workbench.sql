CREATE SCHEMA IF NOT EXISTS suite_workbench;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS suite_workbench.suites (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  status text NOT NULL CHECK (status IN ('draft', 'in_progress')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS suite_workbench.input_images (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 6),
  original_object_key text NOT NULL,
  thumbnail_object_key text NOT NULL,
  sha256 char(64) NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  mime_type text NOT NULL,
  original_filename text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (suite_id, ordinal),
  CHECK (original_object_key <> thumbnail_object_key),
  CHECK (position(('suites/' || suite_id::text || '/inputs/' || id::text || '/') in original_object_key) = 1),
  CHECK (position(('suites/' || suite_id::text || '/inputs/' || id::text || '/') in thumbnail_object_key) = 1)
);

CREATE TABLE IF NOT EXISTS suite_workbench.idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS suite_workbench.audit_events (
  id uuid PRIMARY KEY,
  suite_id uuid REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  action text NOT NULL,
  request_id uuid NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
