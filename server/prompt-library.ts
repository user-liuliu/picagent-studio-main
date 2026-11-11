import { createHash } from "node:crypto";

export const PROMPT_STAGES = ["base_refine", "plan", "structure_plan", "category_prompt", "task_image", "reverse_prompt"] as const;
export type PromptStage = (typeof PROMPT_STAGES)[number];
export type PromptVersionStatus = "draft" | "published" | "retired";

export interface PromptInputField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  required: boolean;
  order: number;
  defaultValue?: string | number;
  options?: string[];
}

export interface PromptTemplateRecord {
  templateId: string;
  templateVersionId: string;
  code: string;
  name: string;
  kind: string;
  stage: PromptStage;
  executionTarget: "llm" | "image_model";
  inputSchema: PromptInputField[];
  outputSchema: Record<string, unknown>;
  applicability: Record<string, unknown>;
  body: string;
  userPromptTemplate?: string;
  sourceFile: string;
  sourceHeading: string;
  sourceSha256: string;
}

export interface PromptTemplatePublic {
  templateId: string;
  templateVersionId: string;
  versionNo: number;
  code: string;
  name: string;
  kind: string;
  stage: PromptStage;
  executionTarget: "llm" | "image_model";
  inputSchema: PromptInputField[];
  applicability: Record<string, unknown>;
}

export interface PromptTemplateRuntime extends PromptTemplatePublic {
  outputSchema: Record<string, unknown>;
  body: string;
  userPromptTemplate: string;
  status: PromptVersionStatus;
  sourceFile: string;
  sourceHeading: string;
  sourceSha256: string;
}

const V11_STAGE_CONTRACTS = {
  structure_plan: {
    code: "general.structure-plan",
    schemaVersion: "suite-structure-plan-v2",
    requiredInputKeys: ["platform", "output_language", "product_name", "human_supplement", "emphasis_requirements", "design_constraints", "main_image_count", "detail_image_count_min", "detail_image_count_max", "selected_detail_categories", "category_requirements"],
  },
  category_prompt: {
    code: "general.category-prompt",
    schemaVersion: "suite-category-prompt-v1",
    requiredInputKeys: ["platform", "output_language", "category_code", "category_name", "requested_count", "global_style_card", "approved_fact_refs", "approved_facts", "reference_image_ids", "human_supplement"],
  },
} as const;

export function validatePromptTemplateContract(record: Pick<PromptTemplateRecord, "code" | "kind" | "stage" | "executionTarget" | "inputSchema" | "outputSchema" | "body">): void {
  if (record.stage !== "structure_plan" && record.stage !== "category_prompt") return;
  const contract = V11_STAGE_CONTRACTS[record.stage];
  if (record.code !== contract.code) throw new Error(`V1.1 template code must be ${contract.code}`);
  if (record.kind !== "planner" || record.executionTarget !== "llm") throw new Error(`V1.1 template ${record.code} must be an llm planner`);
  const schemaVersion = (record.outputSchema.properties as Record<string, unknown> | undefined)?.schemaVersion as Record<string, unknown> | undefined;
  if (!schemaVersion || schemaVersion.const !== contract.schemaVersion) throw new Error(`V1.1 template ${record.code} has incompatible output schema`);
  const inputKeys = new Set(record.inputSchema.map((field) => field.key));
  const missing = contract.requiredInputKeys.find((key) => !inputKeys.has(key));
  if (missing) throw new Error(`V1.1 template ${record.code} is missing input field ${missing}`);
  if (!record.body.includes(contract.schemaVersion)) throw new Error(`V1.1 template ${record.code} body must declare ${contract.schemaVersion}`);
  if (record.body.includes("suite-plan-v1")) throw new Error(`V1.1 template ${record.code} still contains the one-shot plan contract`);
}

const FIELD_DEFINITIONS: Array<{ aliases: string[]; key: string; type?: PromptInputField["type"]; options?: string[] }> = [
  { aliases: ["平台", "目标平台"], key: "platform" },
  { aliases: ["目标站点/国家"], key: "target_market_country" },
  { aliases: ["输出语言", "语言"], key: "output_language" },
  { aliases: ["主图数量"], key: "main_image_count", type: "number" },
  { aliases: ["详情页数量"], key: "detail_image_count", type: "number" },
  { aliases: ["主图比例"], key: "main_image_ratio" },
  { aliases: ["详情页比例"], key: "detail_image_ratio" },
  { aliases: ["产品名称"], key: "product_name" },
  { aliases: ["品牌名", "品牌名称"], key: "brand_name" },
  { aliases: ["品类"], key: "product_category" },
  { aliases: ["核心卖点"], key: "selling_points", type: "textarea" },
  { aliases: ["产品参数"], key: "product_parameters", type: "textarea" },
  { aliases: ["目标人群"], key: "target_audience", type: "textarea" },
  { aliases: ["使用场景"], key: "usage_scenarios", type: "textarea" },
  { aliases: ["价格带", "定位", "价格带/定位"], key: "positioning" },
  { aliases: ["设计风格", "详情页风格"], key: "design_style", type: "textarea" },
  { aliases: ["禁止出现"], key: "forbidden_content", type: "textarea" },
  { aliases: ["其他要求"], key: "other_requirements", type: "textarea" },
  { aliases: ["主图类型"], key: "main_image_type", type: "select", options: ["全部", "平台首图", "主图组", "广告主图"] },
  { aliases: ["是否需要模特"], key: "model_requirement", type: "select", options: ["自动判断", "需要", "不需要"] },
  { aliases: ["模特类型"], key: "model_type" },
  { aliases: ["是否禁止人脸"], key: "forbid_face", type: "select", options: ["是", "否"] },
  { aliases: ["是否允许图中文字"], key: "allow_image_text", type: "select", options: ["自动判断", "允许", "不允许"] },
  { aliases: ["海产品类型"], key: "seafood_type", type: "select", options: ["鲜活", "冷冻", "干货", "熟制", "即食", "礼盒", "半成品"] },
  { aliases: ["真实规格"], key: "product_specification" },
  { aliases: ["真实净含量"], key: "net_weight" },
  { aliases: ["真实产地"], key: "origin" },
  { aliases: ["储存方式"], key: "storage_method" },
  { aliases: ["发货方式"], key: "shipping_method" },
  { aliases: ["食用方式"], key: "serving_method" },
];

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function codeFor(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ".").replace(/^\.|\.$/g, "");
  return `${slug || "prompt"}.${index + 1}`;
}

function classify(name: string): Pick<PromptTemplateRecord, "kind" | "stage"> {
  if (/底图|白底|精修/.test(name)) return { kind: "direct_generation", stage: "base_refine" };
  if (/返修|修复|纠偏|重做/.test(name)) return { kind: "repair", stage: "task_image" };
  return { kind: "planner", stage: "plan" };
}

function extractInputSchema(body: string): PromptInputField[] {
  const fields: PromptInputField[] = [];
  const seen = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\\?[-*]|\d+[.)])\s*([^：:\n]{1,40})[：:]\s*(.*)$/);
    if (!match) continue;
    const rawLabel = match[1].replace(/[*_`]/g, "").trim();
    const normalized = rawLabel.replace(/[（(]\s*(?:必填|选填)\s*[）)]/g, "").replace(/\s*\/\s*/g, "/").trim();
    const definition = FIELD_DEFINITIONS.find(({ aliases }) => aliases.includes(normalized));
    if (!definition || seen.has(definition.key)) continue;
    const rawDefault = match[2].trim();
    const field: PromptInputField = {
      key: definition.key,
      label: normalized,
      type: definition.type ?? "text",
      required: /必填/.test(rawLabel),
      order: fields.length,
    };
    if (definition.options) field.options = definition.options;
    if (rawDefault && (definition.type !== "select" || definition.options?.includes(rawDefault))) {
      field.defaultValue = definition.type === "number" && !Number.isNaN(Number(rawDefault)) ? Number(rawDefault) : rawDefault;
    }
    fields.push(field);
    seen.add(definition.key);
  }
  return fields;
}

function inferredPlanInputSchema(name: string): PromptInputField[] {
  const keys = ["platform", "output_language"];
  if (/主图/.test(name)) keys.push("main_image_count", "main_image_ratio");
  if (/详情页/.test(name)) keys.push("detail_image_count", "detail_image_ratio");
  keys.push("product_name", "brand_name", "selling_points", "product_parameters", "target_audience", "usage_scenarios", "positioning", "design_style", "forbidden_content", "other_requirements");
  return keys.map((key, order) => {
    const definition = FIELD_DEFINITIONS.find((item) => item.key === key)!;
    return { key, label: definition.aliases[0], type: definition.type ?? "text", required: false, order, ...(definition.options ? { options: definition.options } : {}) };
  });
}

function mergePlanInputSchema(name: string, extracted: PromptInputField[]): PromptInputField[] {
  const fields = extracted.length ? extracted : inferredPlanInputSchema(name);
  return fields.map((field, order) => ({ ...field, order }));
}

function planOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "items"],
    properties: {
      schemaVersion: { const: "suite-plan-v1" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "purpose", "prompt"],
          properties: { title: { type: "string" }, purpose: { type: "string" }, prompt: { type: "string" } },
        },
      },
    },
  };
}

export function parsePromptMarkdown(markdown: string, sourceFile: string): PromptTemplateRecord[] {
  const sourceSha256 = createHash("sha256").update(markdown).digest("hex");
  const records: PromptTemplateRecord[] = [];
  const headingStack = new Map<number, string>();
  const lines = markdown.split(/\r?\n/);
  let activeFence: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (/^```(?:plain|text|markdown|md)?\s*$/i.test(line)) {
      if (!activeFence) {
        const level4 = headingStack.get(4);
        const level3 = headingStack.get(3);
        const genericLevel3 = level3 && /^(作用|总控提示词)$/.test(level3);
        const name = level4 ?? (!genericLevel3 ? level3 : undefined) ?? headingStack.get(2);
        if (name) activeFence = { name, lines: [] };
      } else {
        const name = activeFence.name;
        const body = activeFence.lines.join("\n").trim();
        const code = codeFor(name, records.length);
        const { kind, stage } = classify(name);
        const extractedInputSchema = extractInputSchema(body);
        records.push({
          templateId: stableUuid(`prompt-template:${code}`),
          templateVersionId: stableUuid(`prompt-version:${code}:${sourceSha256}:${name}`),
          code,
          name,
          kind,
          stage,
          executionTarget: stage === "plan" ? "llm" : "image_model",
          inputSchema: stage === "plan" ? mergePlanInputSchema(name, extractedInputSchema) : extractedInputSchema,
          outputSchema: stage === "plan" ? planOutputSchema() : {},
          applicability: {},
          body,
          sourceFile,
          sourceHeading: name,
          sourceSha256,
        });
        activeFence = null;
      }
      continue;
    }
    if (activeFence) {
      activeFence.lines.push(line);
      continue;
    }
    const heading = line.match(/^(#{2,4})\s+(.+)\s*$/);
    if (!heading) continue;
    const level = heading[1].length;
    const name = heading[2].replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").trim();
    for (const existingLevel of [...headingStack.keys()]) if (existingLevel >= level) headingStack.delete(existingLevel);
    headingStack.set(level, name);
  }
  return records;
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return undefined;
  const value = match[1].trim();
  return value.replace(/^['\"]|['\"]$/g, "");
}

function sectionBody(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const explicitEnd = markdown.indexOf(nextHeading, start + heading.length);
  const nextSection = markdown.slice(start + heading.length).search(/\r?\n##\s+/);
  const inferredEnd = nextSection >= 0 ? start + heading.length + nextSection : -1;
  const end = explicitEnd >= 0 ? explicitEnd : inferredEnd;
  const section = markdown.slice(start + heading.length, end >= 0 ? end : markdown.length).trim();
  return section
    .replace(/^`{3,4}(?:text|yaml|json)?\s*$/gm, "")
    .replace(/^`{3,4}\s*$/gm, "")
    .trim();
}

function parseNormalizedInputSchema(markdown: string): PromptInputField[] {
  const body = sectionBody(markdown, "## 用户输入字段", "## 字段模式与补全规则");
  const fields: PromptInputField[] = [];
  const lines = body.split(/\r?\n/);
  let field: PromptInputField | null = null;
  const finish = () => { if (field) fields.push({ ...field, order: fields.length }); field = null; };
  for (const line of lines) {
    const key = line.match(/^\s*- key:\s*([a-zA-Z0-9_]+)/);
    if (key) { finish(); field = { key: key[1], label: key[1], type: "text", required: false, order: fields.length }; continue; }
    if (!field) continue;
    const label = line.match(/^\s+label:\s*["']?(.*?)["']?\s*$/);
    const type = line.match(/^\s+type:\s*(text|textarea|number|select)\s*$/);
    const required = line.match(/^\s+required:\s*(true|false)\s*$/);
    const defaultValue = line.match(/^\s+default:\s*["']?(.*?)["']?\s*$/);
    const options = line.match(/^\s+options:\s*\[(.*)\]\s*$/);
    if (label) field.label = label[1].trim();
    if (type) field.type = type[1] as PromptInputField["type"];
    if (required) field.required = required[1] === "true";
    if (defaultValue) field.defaultValue = field.type === "number" ? Number(defaultValue[1]) : defaultValue[1];
    if (options) field.options = [...options[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  }
  finish();
  return fields;
}

export function parseNormalizedPromptMarkdown(markdown: string, sourceFile: string): PromptTemplateRecord {
  const code = frontmatterValue(markdown, "code");
  const name = frontmatterValue(markdown, "name") ?? markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const kind = frontmatterValue(markdown, "kind");
  const stage = frontmatterValue(markdown, "stage") as PromptStage | undefined;
  const executionTarget = frontmatterValue(markdown, "execution_target") as PromptTemplateRecord["executionTarget"] | undefined;
  if (!code || !name || !kind || !stage || !executionTarget || !PROMPT_STAGES.includes(stage)) throw new Error(`Invalid normalized prompt metadata: ${sourceFile}`);
  if (executionTarget !== "llm" && executionTarget !== "image_model") throw new Error(`Invalid normalized prompt execution target: ${sourceFile}`);
  const body = sectionBody(markdown, "## System Prompt", "## User Prompt Template");
  const userPromptTemplate = sectionBody(markdown, "## User Prompt Template", "## Output Schema");
  if (!body) throw new Error(`Normalized prompt is missing System Prompt: ${sourceFile}`);
  const outputText = sectionBody(markdown, "## Output Schema", "## 运行时拆分规则");
  let outputSchema: Record<string, unknown> = {};
  if (outputText) {
    const json = outputText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    outputSchema = JSON.parse(json) as Record<string, unknown>;
  }
  const sourceSha256 = createHash("sha256").update(markdown).digest("hex");
  const record: PromptTemplateRecord = {
    templateId: stableUuid(`prompt-template:${code}`),
    templateVersionId: stableUuid(`prompt-version:${code}:${sourceSha256}`),
    code,
    name,
    kind,
    stage,
    executionTarget,
    inputSchema: parseNormalizedInputSchema(markdown),
    outputSchema,
    applicability: {},
    body,
    userPromptTemplate,
    sourceFile,
    sourceHeading: name,
    sourceSha256,
  };
  validatePromptTemplateContract(record);
  return record;
}

export function isNormalizedPromptMarkdown(markdown: string): boolean {
  const normalized = markdown.trimStart();
  return /^---\r?\n/.test(normalized) && /\r?\ncode:\s*.+\r?\n/.test(normalized);
}

export function validateDynamicInput(schema: PromptInputField[], input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (input === undefined) input = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "动态字段必须是对象" };
  const value = input as Record<string, unknown>;
  const allowed = new Map(schema.map((field) => [field.key, field]));
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `Unknown prompt input: ${unknown}` };
  const outputMode = value.output_mode;
  const isMain = outputMode === "combined" || outputMode === "main_only" || (!outputMode && schema.some((field) => field.key === "main_image_count"));
  const isDetail = outputMode === "combined" || outputMode === "detail_only" || (!outputMode && schema.some((field) => field.key === "detail_image_count"));
  const conditional: Record<string, boolean> = {
    main_image_count_mode: isMain,
    main_image_count: isMain && value.main_image_count_mode === "fixed",
    detail_image_count_mode: isDetail,
    detail_image_count: isDetail && value.detail_image_count_mode === "fixed",
    brand_name: value.brand_mode === "provided",
    selling_points: value.selling_points_mode === "provided",
    product_parameters: value.parameters_mode === "provided",
    design_style: value.design_style_mode === "provided",
  };
  for (const field of schema) {
    const current = value[field.key];
    const required = field.required && !(field.key in conditional) || conditional[field.key] === true;
    if (required && (current === undefined || current === null || String(current).trim() === "")) return { ok: false, message: `${field.label}不能为空` };
    if (current !== undefined && current !== null && field.type === "number" && (typeof current !== "number" || !Number.isFinite(current))) return { ok: false, message: `${field.label}必须是数字` };
    if (current !== undefined && current !== null && field.type !== "number" && typeof current !== "string") return { ok: false, message: `${field.label}格式无效` };
  }
  return { ok: true, value: Object.fromEntries(Object.entries(value).filter(([, current]) => current !== undefined)) };
}

export function renderPromptTemplate(template: PromptTemplateRuntime, input: Record<string, unknown>): string {
  const lines = template.inputSchema.flatMap((field) => {
    const value = input[field.key] ?? field.defaultValue;
    return value === undefined || value === null || String(value).trim() === "" ? [] : [`- ${field.label}: ${String(value)}`];
  });
  return lines.length === 0 ? template.body : `${template.body}\n\n用户输入：\n${lines.join("\n")}`;
}
