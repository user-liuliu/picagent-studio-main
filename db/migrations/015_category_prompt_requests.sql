CREATE TABLE IF NOT EXISTS suite_workbench.plan_category_requests (
  id uuid PRIMARY KEY,
  suite_id uuid NOT NULL REFERENCES suite_workbench.suites(id) ON DELETE RESTRICT,
  plan_snapshot_id uuid NOT NULL REFERENCES suite_workbench.plan_snapshots(id) ON DELETE RESTRICT,
  category_code text NOT NULL,
  requested_count integer NOT NULL CHECK (requested_count > 0),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  idempotency_key text NOT NULL,
  retry_of_request_id uuid REFERENCES suite_workbench.plan_category_requests(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES prompt_library.prompt_template_versions(id) ON DELETE RESTRICT,
  dynamic_input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_fact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_image_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  base_version_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text NOT NULL,
  model text NOT NULL,
  is_fake boolean NOT NULL DEFAULT false,
  request_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary_json jsonb,
  output_items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (suite_id, plan_snapshot_id, category_code, idempotency_key)
);

CREATE INDEX IF NOT EXISTS plan_category_requests_snapshot_idx
  ON suite_workbench.plan_category_requests(plan_snapshot_id, category_code, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS plan_category_requests_active_unique
  ON suite_workbench.plan_category_requests(suite_id, plan_snapshot_id, category_code)
  WHERE status IN ('running', 'succeeded');

UPDATE suite_workbench.plan_category_requests
SET status='failed', error_code='GENERATION_INTERRUPTED', error_message='类别提示词生成服务中断，请重试', completed_at=now()
WHERE status='running' AND created_at < now() - interval '10 minutes';
