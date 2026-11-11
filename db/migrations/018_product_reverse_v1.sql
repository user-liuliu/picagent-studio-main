ALTER TABLE prompt_library.prompt_template_versions DROP CONSTRAINT IF EXISTS prompt_template_versions_stage_check;
DO $$ BEGIN
  ALTER TABLE prompt_library.prompt_template_versions ADD CONSTRAINT prompt_template_versions_stage_check CHECK (stage IN ('base_refine','plan','structure_plan','category_prompt','task_image','reverse_prompt')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE prompt_library.prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_stage_check;
DO $$ BEGIN
  ALTER TABLE prompt_library.prompt_templates ADD CONSTRAINT prompt_templates_stage_check CHECK (stage IN ('base_refine','plan','structure_plan','category_prompt','task_image','reverse_prompt')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS suite_workbench.reverse_plans (
  id uuid PRIMARY KEY, mode varchar(10) NOT NULL CHECK (mode IN ('main','detail')), status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')),
  baseline_reference_id uuid, idempotency_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS suite_workbench.reverse_references (
  id uuid PRIMARY KEY, plan_id uuid NOT NULL REFERENCES suite_workbench.reverse_plans(id), ordinal integer NOT NULL, filename text NOT NULL, mime_type text NOT NULL,
  sha256 char(64) NOT NULL, width integer NOT NULL, height integer NOT NULL, object_key text NOT NULL, thumbnail_object_key text NOT NULL,
  template_version_id uuid REFERENCES prompt_library.prompt_template_versions(id), effective_prompt_version_id uuid, removed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suite_workbench.reverse_references DROP CONSTRAINT IF EXISTS reverse_references_plan_id_sha256_key;
CREATE UNIQUE INDEX IF NOT EXISTS reverse_references_active_sha256_idx ON suite_workbench.reverse_references(plan_id,sha256) WHERE removed_at IS NULL;
ALTER TABLE suite_workbench.reverse_plans DROP CONSTRAINT IF EXISTS reverse_plans_baseline_reference_fk;
DO $$ BEGIN
  ALTER TABLE suite_workbench.reverse_plans ADD CONSTRAINT reverse_plans_baseline_reference_fk FOREIGN KEY (baseline_reference_id) REFERENCES suite_workbench.reverse_references(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE IF NOT EXISTS suite_workbench.reverse_attempts (
  id uuid PRIMARY KEY, reference_id uuid NOT NULL REFERENCES suite_workbench.reverse_references(id), status varchar(12) NOT NULL CHECK (status IN ('pending','running','succeeded','failed')),
  retry_of_attempt_id uuid REFERENCES suite_workbench.reverse_attempts(id), template_version_id uuid NOT NULL REFERENCES prompt_library.prompt_template_versions(id), mode varchar(10) NOT NULL,
  baseline_reference_id uuid REFERENCES suite_workbench.reverse_references(id), request_summary_json jsonb NOT NULL DEFAULT '{}', raw_output_json jsonb,
  error_code text, error_message text, prompt_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS suite_workbench.reverse_prompt_versions (
  id uuid PRIMARY KEY, reference_id uuid NOT NULL REFERENCES suite_workbench.reverse_references(id), kind varchar(10) NOT NULL CHECK (kind IN ('model','user')),
  prompt text NOT NULL, raw_output_json jsonb, template_version_id uuid NOT NULL REFERENCES prompt_library.prompt_template_versions(id), mode varchar(10) NOT NULL,
  provider_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suite_workbench.reverse_references DROP CONSTRAINT IF EXISTS reverse_references_effective_prompt_fk;
DO $$ BEGIN
  ALTER TABLE suite_workbench.reverse_references ADD CONSTRAINT reverse_references_effective_prompt_fk FOREIGN KEY (effective_prompt_version_id) REFERENCES suite_workbench.reverse_prompt_versions(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE suite_workbench.reverse_attempts DROP CONSTRAINT IF EXISTS reverse_attempts_prompt_version_fk;
DO $$ BEGIN
  ALTER TABLE suite_workbench.reverse_attempts ADD CONSTRAINT reverse_attempts_prompt_version_fk FOREIGN KEY (prompt_version_id) REFERENCES suite_workbench.reverse_prompt_versions(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO prompt_library.prompt_templates (id,code,name,kind,stage,execution_target,lifecycle_status)
SELECT gen_random_uuid(), v.code, v.name, 'planner', 'reverse_prompt', 'llm', 'active' FROM (VALUES
 ('reverse.main.white','白底商品主图'),('reverse.main.scene','场景主图'),('reverse.main.selling','卖点信息主图'),('reverse.main.promo','促销活动主图'),
 ('reverse.detail.hero','首屏 / 品牌表达'),('reverse.detail.selling','核心卖点'),('reverse.detail.scene','生活场景'),('reverse.detail.close','细节特写'),('reverse.detail.spec','尺寸规格'),('reverse.detail.trust','促销 / 信任背书')
) v(code,name) ON CONFLICT(code) DO NOTHING;

WITH rows AS (SELECT t.id,t.code,t.name,CASE WHEN t.code LIKE 'reverse.main.%' THEN 'main' ELSE 'detail' END target_type FROM prompt_library.prompt_templates t WHERE t.code LIKE 'reverse.%')
INSERT INTO prompt_library.prompt_template_versions (id,template_id,version_no,name,kind,stage,execution_target,input_schema,output_schema,applicability,body,user_prompt_template,status,source_file,source_heading,source_sha256,published_at)
SELECT gen_random_uuid(),r.id,1,r.name,'planner','reverse_prompt','llm','[]',jsonb_build_object('type','object','properties',jsonb_build_object('schemaVersion',jsonb_build_object('const','reverse-prompt-v1'),'referenceImageId',jsonb_build_object('type','string'),'prompt',jsonb_build_object('type','string')),'required',jsonb_build_array('schemaVersion','referenceImageId','prompt')),jsonb_build_object('targetType',r.target_type,'summary','逐图提炼可执行中文生图提示词'),
'你是电商视觉反推专家。只输出 JSON：schemaVersion 必须是 reverse-prompt-v1，referenceImageId 必须原样返回，prompt 是完整中文生图提示词。提炼构图、空间、色彩、光影、材质和信息排版，但不得迁移参考商品品牌、Logo、参数、功效、认证、价格或促销事实。必须声明后续用户产品白底图是唯一产品外观来源，商品结构、比例、颜色、材质和可见细节不得改变。详情模式的色彩基准只影响色彩与光影秩序。','模式：{{mode}}；当前参考图 ID：{{referenceImageId}}。请分析图像并输出契约 JSON。','published','builtin:reverse-v1',r.name,encode(digest('reverse-v1:'||r.code,'sha256'),'hex'),now()
FROM rows r WHERE NOT EXISTS (SELECT 1 FROM prompt_library.prompt_template_versions v WHERE v.template_id=r.id);
UPDATE prompt_library.prompt_templates t SET published_version_id=v.id FROM prompt_library.prompt_template_versions v WHERE v.template_id=t.id AND v.stage='reverse_prompt' AND v.status='published' AND t.published_version_id IS NULL;
