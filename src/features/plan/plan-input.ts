import type { ApiPromptTemplate, ApiRagChunk } from "../../api/client";

export function planTemplateScope(template: ApiPromptTemplate | undefined): "combined" | "main_only" | "detail_only" | "unknown" {
  const keys = new Set((template?.inputSchema ?? []).map((field) => field.key));
  const hasMain = keys.has("main_image_count");
  const hasDetail = keys.has("detail_image_count");
  if (hasMain && hasDetail) return "combined";
  if (hasMain) return "main_only";
  if (hasDetail) return "detail_only";
  return "unknown";
}

export function preferredPlanTemplate(templates: ApiPromptTemplate[]): ApiPromptTemplate | undefined {
  return templates.find((template) => planTemplateScope(template) === "combined") ?? templates[0];
}

export function updatePromptInputValue(current: Record<string, unknown>, field: ApiPromptTemplate["inputSchema"][number], rawValue: string) {
  const next = { ...current, [field.key]: field.type === "number" && rawValue !== "" ? Number(rawValue) : rawValue };
  if (rawValue !== "" && field.key === "main_image_count") next.main_image_count_mode = "fixed";
  if (rawValue !== "" && field.key === "detail_image_count") next.detail_image_count_mode = "fixed";
  return next;
}

export function inputForTemplate(template: ApiPromptTemplate | undefined, current: Record<string, unknown>) {
  return Object.fromEntries((template?.inputSchema ?? []).sort((a,b)=>a.order-b.order).map((field) => {
    const existing = current[field.key];
    if (existing !== undefined && existing !== null && String(existing).trim() !== "") return [field.key, existing];
    if (field.defaultValue !== undefined) return [field.key, field.defaultValue];
    if (field.key === "output_language") return [field.key, "中文"];
    if (field.key.endsWith("_count_mode")) return [field.key, "auto"];
    if (field.key === "brand_mode") return [field.key, "no_brand"];
    if (field.key === "selling_points_mode") return [field.key, "derive"];
    if (field.key === "parameters_mode") return [field.key, "to_confirm"];
    if (field.key === "design_style_mode") return [field.key, "auto"];
    if (field.type === "select") return [field.key, field.options?.[0] ?? ""];
    return [field.key, ""];
  }));
}

export function fillEmptyFromSelected(input: Record<string, unknown>, template: ApiPromptTemplate | undefined, selected: ApiRagChunk[]) {
  const allowed = new Set((template?.inputSchema ?? []).map((field) => field.key));
  const next = { ...input };
  for (const chunk of selected) for (const [key,value] of Object.entries(chunk.fieldValues ?? {})) {
    if (allowed.has(key) && (next[key] === undefined || next[key] === null || String(next[key]).trim() === "")) next[key] = value;
  }
  return next;
}

export function compactInput(input:Record<string,unknown>){return Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined&&value!==null&&String(value).trim()!==""));}

export function structurePlanDynamicInput(brief: {
  platform: string;
  output_language: string;
  product_name: string;
  human_supplement: string;
  emphasis_requirements: string;
  design_constraints: string;
}, structureInput: Record<string, unknown>) {
  return {
    ...structureInput,
    platform: brief.platform,
    output_language: brief.output_language,
    product_name: brief.product_name,
    human_supplement: brief.human_supplement,
    emphasis_requirements: brief.emphasis_requirements,
    design_constraints: brief.design_constraints,
  };
}
