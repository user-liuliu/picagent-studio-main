import { createHash, randomUUID } from "node:crypto";
import { processGeneratedImage, processImage } from "./image.js";
import { PROMPT_STAGES, renderPromptTemplate, validateDynamicInput, type PromptStage } from "./prompt-library.js";
import { MemoryCategoryPromptRepository } from "./repositories/memory-category-prompt-repository.js";
import { MemoryReverseRepository } from "./repositories/memory-reverse-repository.js";
import { materializeCategoryPlanItems } from "./suite-task-prompt.js";
import type { ImageEditorApiResponse } from "./image-editor-api.js";
import type {
  BaseImageVersion,
  CategoryPromptItem,
  CategoryPromptLlmInput,
  CategoryPromptRequest,
  CategoryPromptRepository,
  ErrorEnvelope,
  GenerationAttempt,
  ImageProvider,
  InputImage,
  LlmClient,
  PlanAttempt,
  PlanRepository,
  PlanSnapshot,
  PlatformRepository,
  PromptRepository,
  RagClient,
  ResponseEnvelope,
  StorageAdapter,
  StructureAllocation,
  StructurePlanV2,
  SuiteAggregate,
  SuiteRepository,
  UploadFile,
  TaskRepository,
  SuiteTask,
  TaskGenerationAttempt,
  TaskGenerationBatch,
  TaskResultSlot,
  TaskImageVersion,
  LibraryRepository,
  ReverseRepository, ReversePlan, ReverseReference, ReverseAttempt, ReversePromptVersion,
} from "./types.js";
import { failObservation, finishObservation, startTool } from "./observability.js";

export interface AppResponse { status: number; body: ResponseEnvelope<unknown> | ErrorEnvelope; headers?: Record<string, string>; raw?: Buffer }
export interface Ticket02App {
  request(method: string, path: string, options?: { headers?: Record<string, string>; body?: unknown }): Promise<AppResponse>;
  upload(suiteId: string, file: UploadFile): Promise<AppResponse>;
  preview(suiteId: string, imageId: string, kind: "original" | "thumbnail"): Promise<AppResponse>;
  previewBaseVersion(suiteId: string, imageId: string, versionId: string): Promise<AppResponse>;
  previewTaskVersion(taskId: string, versionId: string): Promise<AppResponse>;
  previewLibraryResource(resourceId: string): Promise<AppResponse>;
  previewReverseReference(planId: string, referenceId: string, kind?: "original" | "thumbnail"): Promise<AppResponse>;
}

async function observedPromptLoad(repository: PromptRepository, templateVersionId: string, stage?: PromptStage) {
  const observation = startTool("prompt.load", { templateVersionId, stage }, { template_version_id: templateVersionId, stage: stage ?? "any" });
  try {
    const template = await repository.getPublishedVersion(templateVersionId, stage);
    finishObservation(observation, template ? { found: true, stage: template.stage } : { found: false });
    return template;
  } catch (error) {
    failObservation(observation, error);
    throw error;
  }
}

const errorMessages: Record<string, string> = {
  INVALID_SUITE_ID: "方案不存在",
  INVALID_INPUT_IMAGE: "原图不存在",
  INVALID_BASE_VERSION: "底图版本不存在",
  EMPTY_NAME: "方案名称不能为空",
  INVALID_ORDINAL: "上传序号必须是 1 到 6",
  TOO_MANY_IMAGES: "一个方案最多上传 6 张原图",
  DUPLICATE_ORDINAL: "该上传序号已经存在",
  DUPLICATE_IMAGE: "同一方案内不能重复上传相同图片",
  UNSUPPORTED_IMAGE_MIME: "仅支持 JPG、PNG 或 WebP 图片",
  INVALID_IMAGE: "文件不是有效图片",
  MIME_MISMATCH: "图片真实类型与声明类型不一致",
  IMAGE_TOO_LARGE: "图片文件超过 12MB 限制",
  IMAGE_DIMENSIONS_TOO_LARGE: "图片尺寸超过限制",
  MISSING_IDEMPOTENCY_KEY: "生成请求缺少幂等键",
  INVALID_PROMPT_STAGE: "提示词阶段无效",
  PROMPT_REPOSITORY_NOT_CONFIGURED: "提示词库未配置",
  PROMPT_TEMPLATE_REQUIRED: "请选择提示词模板",
  PROMPT_TEMPLATE_NOT_FOUND: "提示词模板未发布或阶段不匹配",
  PLATFORM_NOT_FOUND: "目标平台不在维护表中",
  PROMPT_INPUT_INVALID: "提示词动态字段无效",
  IMAGE_PROVIDER_NOT_CONFIGURED: "图像生成服务未配置",
  IMAGE_PROVIDER_FAILED: "图像生成服务调用失败",
  INVALID_GENERATED_IMAGE: "图像生成服务返回了无效图片",
  INPUT_OBJECT_NOT_FOUND: "原图对象不存在",
  INPUT_OBJECT_READ_FAILED: "原图对象读取失败",
  INPUT_IMAGE_HAS_HISTORY: "已有生成记录的原图不能取消",
  STORAGE_WRITE_FAILED: "生成图片保存失败",
  GENERATION_PERSIST_FAILED: "生成结果保存失败",
  IMAGE_PROVIDER_TIMEOUT: "图像生成服务响应超时",
  LLM_NOT_CONFIGURED: "DashScope LLM 未配置",
  PLAN_REPOSITORY_NOT_CONFIGURED: "计划仓储未配置",
  PLAN_TEMPLATE_NOT_FOUND: "计划模板未发布或阶段不匹配",
  RAG_NOT_CONFIGURED: "商品资料检索未配置",
  RAG_CHUNK_NOT_FOUND: "所选商品资料不存在或未发布",
  RAG_CHUNK_VERSION_DRIFT: "所选商品资料版本已变化，请重新选择",
  LLM_OUTPUT_SCHEMA_INVALID: "LLM 输出不符合计划 Schema",
  LLM_OUTPUT_COUNT_MISMATCH: "模型返回的主图或详情页数量与固定数量不一致，请重试",
  STRUCTURE_PLAN_INVALID: "图片结构计划不符合数量或类别约束",
  STRUCTURE_PLAN_NEEDS_INPUT: "必生类别缺少已确认商品事实",
  STRUCTURE_PLAN_NOT_CONFIRMED: "图片结构计划尚未确认",
  CATEGORY_PROMPT_REPOSITORY_NOT_CONFIGURED: "类别提示词仓储未配置",
  CATEGORY_PROMPT_TEMPLATE_NOT_FOUND: "类别提示词模板未发布或阶段不匹配",
  CATEGORY_PROMPT_NOT_CONFIRMED: "图片结构计划尚未确认，不能生成类别提示词",
  INVALID_CATEGORY_PROMPT_REQUEST: "类别提示词请求不存在",
  CATEGORY_PROMPT_INVALID: "类别提示词输出不符合类别或事实约束",
  CATEGORY_PROMPT_COUNT_MISMATCH: "类别提示词数量与确认数量不一致，请重试",
  CATEGORY_PROMPT_FAILED: "类别提示词生成失败",
  CATEGORY_PROMPT_LLM_NOT_CONFIGURED: "类别提示词模型未配置",
  CATEGORY_PROMPTS_NOT_READY: "类别提示词尚未全部成功，请重试失败类别",
  LLM_PROVIDER_FAILED: "LLM 计划生成失败",
  LLM_TIMEOUT: "计划生成超时，请重试",
  TASK_REPOSITORY_NOT_CONFIGURED: "套图任务仓储未配置",
  INVALID_PLAN_SNAPSHOT: "没有可用的计划快照",
  NO_TASKS_TO_GENERATE: "没有可生成的套图任务",
  INVALID_SUITE_TASK: "套图任务不存在",
  INVALID_TASK_BATCH: "生成批次不存在",
  TASK_IMAGE_PROVIDER_NOT_CONFIGURED: "图像生成服务未配置",
  TASK_IMAGE_PROVIDER_FAILED: "套图图片生成失败",
  REVERSE_CANVAS_NO_RESULTS: "至少需要一条成功提示词才能进入共享画布",
  REVERSE_WHITE_RESOURCE_REQUIRED: "请先从图片资源库选择产品白底图",
  TASK_INVALID_SOURCE: "套图任务没有可用输入图",
  TASK_INVALID_GENERATED_IMAGE: "套图图片生成结果无效",
  TASK_STORAGE_WRITE_FAILED: "套图图片保存失败",
  INVALID_TASK_VERSION: "图片版本不存在",
  LAYOUT_VERSION_CONFLICT: "画布布局已被其他操作更新，请刷新后重试",
  LIBRARY_RESOURCE_NOT_FOUND: "资源不存在或已归档",
  LIBRARY_VERSION_INVALID: "资源版本无效",
  LIBRARY_RESOURCE_FORBIDDEN: "资源不属于当前方案",
  LIBRARY_STAGE_MISMATCH: "资源阶段与目标不匹配",
  LIBRARY_TARGET_NOT_FOUND: "引用目标不存在",
  LIBRARY_REPOSITORY_NOT_CONFIGURED: "资源库未配置",
  REVERSE_REPOSITORY_NOT_CONFIGURED: "反推仓储未配置",
  INVALID_REVERSE_PLAN: "反推方案不存在",
  INVALID_REVERSE_MODE: "反推模式无效",
  REVERSE_TEMPLATE_REQUIRED: "请选择反推模板",
  REVERSE_TEMPLATE_NOT_FOUND: "反推模板未发布或模式不匹配",
  REVERSE_REFERENCE_LIMIT: "一个方案最多上传 16 张参考图",
  REVERSE_REFERENCE_NOT_FOUND: "反推参考图不存在",
  REVERSE_LLM_NOT_CONFIGURED: "反推模型未配置",
  REVERSE_OUTPUT_INVALID: "反推模型输出不符合契约",
};

function ok<T>(data: T, status = 200): AppResponse { return { status, body: { data, requestId: randomUUID() } }; }
function fail(code: string, status = 400, message?: string): AppResponse { return { status, body: { error: { code, message: message ?? errorMessages[code] ?? "请求失败" }, requestId: randomUUID() } }; }
function versionView(version: BaseImageVersion) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    width: version.width,
    height: version.height,
    mimeType: version.mimeType,
    sha256: version.sha256,
    createdAt: version.createdAt,
    previewUrl: `/api/suites/${version.suiteId}/input-images/${version.inputImageId}/base-versions/${version.id}/preview`,
  };
}
function attemptView(attempt: GenerationAttempt) {
  return {
    id: attempt.id,
    versionNumber: attempt.versionNumber,
    status: attempt.status,
    model: attempt.model,
    templateVersionId: attempt.promptTemplateVersionId,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    createdAt: attempt.createdAt,
    completedAt: attempt.completedAt,
  };
}

function validPlanOutput(value: unknown, outputSchema?: Record<string, unknown>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const output = value as Record<string, unknown>;
  if (output.schemaVersion !== "suite-plan-v1" || !Array.isArray(output.items) || output.items.length === 0) return false;
  const itemSchema = outputSchema && typeof outputSchema.items === "object" && outputSchema.items !== null ? outputSchema.items as Record<string, unknown> : undefined;
  const itemProperties = itemSchema && typeof itemSchema.properties === "object" && itemSchema.properties !== null ? itemSchema.properties as Record<string, unknown> : {};
  const requiresImageType = "imageType" in itemProperties;
  return output.items.every((item) => item && typeof item === "object" && !Array.isArray(item)
    && ["title", "purpose", "prompt"].every((key) => typeof (item as Record<string, unknown>)[key] === "string" && String((item as Record<string, unknown>)[key]).trim())
    && (!requiresImageType || ((item as Record<string, unknown>).imageType === "main" || (item as Record<string, unknown>).imageType === "detail")));
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); } catch { return value; }
}

function normalizePlanOutput(value: unknown): { schemaVersion: "suite-plan-v1"; items: Array<{ itemId: string; imageType: "main" | "detail"; ordinal: number; title: string; purpose: string; prompt: string }> } | null {
  let parsed = parseJsonLike(value);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const object = parsed as Record<string, unknown>;
    if (typeof object.items === "string") parsed = parseJsonLike(object.items);
  }
  const object = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  const candidates: Array<{ value: unknown; imageType?: "main" | "detail" }> = Array.isArray(parsed)
    ? parsed.map((value) => ({ value }))
    : object
      ? ["items", "plans", "imagePlans", "image_plans", "mainImages", "detailImages", "images", "cards", "prompts", "图片计划", "主图生图提示词", "详情页生图提示词"].flatMap((key) => {
        const candidate = parseJsonLike(object[key]);
        if (!Array.isArray(candidate)) return [];
        const imageType = ["detailImages", "详情页生图提示词"].includes(key) ? "detail" as const
          : ["mainImages", "主图生图提示词"].includes(key) ? "main" as const : undefined;
        return candidate.map((value) => ({ value, imageType }));
      })
      : [];
  if (!candidates.length && object && (object.title || object.name || object.prompt || object["提示词"])) candidates.push({ value: object });
  const items = candidates.map(({ value, imageType: wrapperImageType }, index) => {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const prompt = String(source.prompt ?? source.text ?? source.body ?? source["提示词"] ?? "").trim();
    const title = String(source.title ?? source.name ?? source.heading ?? source["产品专属职责"] ?? source["职责"] ?? `图片 ${index + 1}`).trim();
    const purpose = String(source.purpose ?? source.reason ?? source.description ?? source["为什么需要这张图"] ?? "完成本套图中的独立图片职责").trim();
    if (!prompt) return null;
    return {
      itemId: String(source.itemId ?? source.id ?? `item-${index + 1}`),
      imageType: source.imageType === "detail" ? "detail" as const : wrapperImageType ?? "main" as const,
      ordinal: typeof source.ordinal === "number" && Number.isInteger(source.ordinal) ? source.ordinal : index + 1,
      title,
      purpose,
      prompt,
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return items.length ? { schemaVersion: "suite-plan-v1", items } : null;
}

function summarizeOutput(value: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const serialized = JSON.stringify(value) ?? "";
  return { sha256: (awaitableHash(serialized)), byteLength: Buffer.byteLength(serialized), itemCount: value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).items) ? ((value as Record<string, unknown>).items as unknown[]).length : 0, ...extra };
}

function designerFactsText(input: Record<string, unknown>): string {
  const supplement = typeof input.human_supplement === "string" ? input.human_supplement.trim() : "";
  const emphasis = typeof input.emphasis_requirements === "string" ? input.emphasis_requirements.trim() : "";
  if (!supplement) return emphasis;
  if (!emphasis || supplement === emphasis) return supplement;
  return `${supplement}\n${emphasis}`;
}

function awaitableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function planAttemptView(attempt: PlanAttempt, snapshot: PlanSnapshot | null) {
  return { id: attempt.id, suiteId: attempt.suiteId, status: attempt.status, templateVersionId: attempt.templateVersionId, provider: attempt.provider, errorCode: attempt.errorCode, errorMessage: attempt.errorMessage, outputSummary: attempt.outputSummary, snapshot: snapshot ? planSnapshotView(snapshot) : null, createdAt: attempt.createdAt, completedAt: attempt.completedAt };
}

function planSnapshotView(snapshot: PlanSnapshot) {
  return { id:snapshot.id,suiteId:snapshot.suiteId,revisionNumber:snapshot.revisionNumber,revisionKind:snapshot.revisionKind,parentSnapshotId:snapshot.parentSnapshotId,templateVersionId:snapshot.templateVersionId,dynamicInput:snapshot.dynamicInput,humanInput:snapshot.humanInput,chunks:snapshot.chunks.map(({content:_content,...chunk})=>chunk),inputImageIds:snapshot.inputImageIds,baseVersionIds:snapshot.baseVersionIds,provider:snapshot.provider,schemaVersion:snapshot.schemaVersion,items:snapshot.items,phase:snapshot.phase ?? "legacy_plan",confirmationStatus:snapshot.confirmationStatus ?? "confirmed",confirmedAt:snapshot.confirmedAt ?? null,structure:snapshot.structure ?? null,categoryOutputs:snapshot.categoryOutputs ?? {},createdAt:snapshot.createdAt };
}

const DETAIL_CATEGORY_CODES = new Set(["appearance_angles", "lifestyle_use", "feature_benefit", "material_detail", "size_scale", "included_items", "compatibility_application", "variant_bundle", "packaging_unboxing", "care_instruction"]);
type StructureOutput = StructurePlanV2 & { schemaVersion: "suite-structure-plan-v2" };

function normalizeStructureAllocation(value: unknown, main = false): StructureAllocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const category = String(row.category ?? "").trim();
  const requirement = main ? "optional" : row.requirement;
  if ((main && category !== "main") || (!main && requirement !== "required" && requirement !== "optional")) return null;
  if (!Number.isInteger(row.count) || Number(row.count) < 0 || !Array.isArray(row.sourceImageIds) || !Array.isArray(row.factRefs) || !Array.isArray(row.missingFacts)) return null;
  return {
    category,
    requirement: requirement as "required" | "optional",
    count: Number(row.count),
    reason: String(row.reason ?? ""),
    sourceImageIds: row.sourceImageIds.map(String),
    factRefs: row.factRefs.map(String),
    missingFacts: row.missingFacts.map(String),
  };
}

function normalizeStructureOutput(value: unknown): StructureOutput | null {
  const parsed = parseJsonLike(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const status = source.status;
  const mainAllocation = normalizeStructureAllocation(source.mainAllocation, true);
  const rawAllocations = Array.isArray(source.categoryAllocations) ? source.categoryAllocations : null;
  const categoryAllocations = rawAllocations?.map((item) => normalizeStructureAllocation(item)) ?? null;
  const globalStyleCard = source.globalStyleCard;
  if (source.schemaVersion !== "suite-structure-plan-v2" || (status !== "READY_FOR_REVIEW" && status !== "NEEDS_HUMAN_INPUT") || !mainAllocation || !Number.isInteger(source.detailImageCount) || !categoryAllocations || categoryAllocations.some((item) => !item) || !globalStyleCard || typeof globalStyleCard !== "object" || Array.isArray(globalStyleCard) || typeof (globalStyleCard as Record<string, unknown>).promptPrefix !== "string") return null;
  return {
    schemaVersion: "suite-structure-plan-v2",
    status,
    mainAllocation: { category: "main", count: mainAllocation.count, reason: mainAllocation.reason, sourceImageIds: mainAllocation.sourceImageIds, factRefs: mainAllocation.factRefs, missingFacts: mainAllocation.missingFacts },
    detailImageCount: Number(source.detailImageCount),
    categoryAllocations: categoryAllocations as StructureAllocation[],
    globalStyleCard: { promptPrefix: String((globalStyleCard as Record<string, unknown>).promptPrefix) },
  };
}

function validateStructureOutput(output: StructureOutput, input: Record<string, unknown>, imageIds: string[], factIds: string[] = []): string | null {
  const min = Number(input.detail_image_count_min); const max = Number(input.detail_image_count_max);
  if (!Number.isInteger(output.mainAllocation.count) || output.mainAllocation.count !== Number(input.main_image_count)) return "main_image_count";
  if (output.mainAllocation.sourceImageIds.some((id) => !imageIds.includes(id))) return "main:sourceImageIds";
  if (output.mainAllocation.factRefs.some((id) => !factIds.includes(id))) return "main:factRefs";
  if (!Number.isInteger(output.detailImageCount) || output.detailImageCount < min || output.detailImageCount > max) return "detail_image_count_range";
  const selectedValue = Array.isArray(input.selected_detail_categories) ? input.selected_detail_categories : JSON.parse(String(input.selected_detail_categories ?? "[]"));
  const requirementsValue = input.category_requirements && typeof input.category_requirements === "object" ? input.category_requirements : JSON.parse(String(input.category_requirements ?? "{}"));
  const selected = new Set((Array.isArray(selectedValue) ? selectedValue : []).map(String));
  const requirements = new Map<string, "required" | "optional">(Object.entries(requirementsValue as Record<string, unknown>).map(([key, value]) => [key, value === "required" ? "required" : "optional"]));
  const seen = new Set<string>(); let total = 0;
  for (const row of output.categoryAllocations) {
    if (!DETAIL_CATEGORY_CODES.has(row.category) || !selected.has(row.category) || seen.has(row.category)) return row.category || "category";
    if (row.requirement !== requirements.get(row.category) || !Number.isInteger(row.count) || row.count < 0) return row.category;
    if (row.requirement === "required" && row.count < 1 && output.status !== "NEEDS_HUMAN_INPUT") return row.category;
    if (row.sourceImageIds.some((id) => !imageIds.includes(id))) return `${row.category}:sourceImageIds`;
    if (row.factRefs.some((id) => !factIds.includes(id))) return `${row.category}:factRefs`;
    total += row.count; seen.add(row.category);
  }
  if (selected.size !== seen.size || total !== output.detailImageCount) return "category_total";
  return null;
}

function isStructurePlanV2(structure: PlanSnapshot["structure"]): structure is StructurePlanV2 {
  return Boolean(structure && "mainAllocation" in structure && "status" in structure);
}

function parseStructureJsonValue(value: unknown, fallback: unknown): unknown {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

const DETAIL_CATEGORY_NAMES: Record<string, string> = {
  main: "主图",
  appearance_angles: "多角度外观图",
  lifestyle_use: "生活场景图",
  feature_benefit: "信息卖点图",
  material_detail: "细节特写图",
  size_scale: "尺寸规格图",
  included_items: "配件全家福",
  compatibility_application: "适配与应用图",
  variant_bundle: "组合与变体图",
  packaging_unboxing: "包装与开箱图",
  care_instruction: "使用与维护图",
};

function normalizeCategoryPromptOutput(value: unknown): { schemaVersion: "suite-category-prompt-v1"; category: string; items: CategoryPromptItem[] } | null {
  const parsed = parseJsonLike(value);
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const source = root as Record<string, unknown>;
  const category = String(source.category ?? source.category_code ?? "").trim();
  if ((source.schemaVersion !== undefined && source.schemaVersion !== "suite-category-prompt-v1") || !category || !Array.isArray(source.items)) return null;
  const items: CategoryPromptItem[] = [];
  for (const raw of source.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const rawTextContent = Array.isArray(row.textContent) ? row.textContent : Array.isArray(row.text_content) ? row.text_content : [];
    const textContent = rawTextContent.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const text = String((entry as Record<string, unknown>).text ?? "").trim();
      const sourceValue = String((entry as Record<string, unknown>).source ?? "").trim();
      return text && sourceValue ? [{ text, source: sourceValue }] : [];
    });
    const rawOverlay = row.allowsTextOverlay ?? row.allows_text_overlay;
    const allowsTextOverlay = rawOverlay === "yes" || rawOverlay === "no" || rawOverlay === "platform_default" ? rawOverlay : "platform_default";
    const prompt = String(row.prompt ?? [
      row.subject ? `画面主体：${String(row.subject).trim()}` : "",
      row.composition ? `构图：${String(row.composition).trim()}` : "",
      row.camera ? `镜头：${String(row.camera).trim()}` : "",
      row.style ? `视觉风格：${String(row.style).trim()}` : "",
      Array.isArray(row.negative_constraints) && row.negative_constraints.length ? `负面约束：${row.negative_constraints.map(String).join("；")}` : "",
    ].filter(Boolean).join("\n")).trim();
    const item: CategoryPromptItem = {
      stableId: String(row.stableId ?? row.stable_id ?? row.item_id ?? "").trim(),
      category: String(row.category ?? row.category_code ?? category).trim(),
      title: String(row.title ?? row.image_role ?? "").trim(),
      purpose: String(row.purpose ?? row.composition ?? row.image_role ?? "").trim(),
      referenceImageIds: Array.isArray(row.referenceImageIds) ? row.referenceImageIds.map(String) : Array.isArray(row.reference_image_ids) ? row.reference_image_ids.map(String) : [],
      factRefs: Array.isArray(row.factRefs) ? row.factRefs.map(String) : Array.isArray(row.fact_refs) ? row.fact_refs.map(String) : [],
      prompt,
      allowsTextOverlay,
      textContent,
      aspectRatio: String(row.aspectRatio ?? row.aspect_ratio ?? "1:1").trim(),
      suggestedParams: row.suggestedParams && typeof row.suggestedParams === "object" && !Array.isArray(row.suggestedParams) ? row.suggestedParams as Record<string, unknown> : row.suggested_params && typeof row.suggested_params === "object" && !Array.isArray(row.suggested_params) ? row.suggested_params as Record<string, unknown> : {},
    };
    if (!item.stableId || !item.category || !item.title || !item.purpose || !item.prompt || !item.aspectRatio) return null;
    items.push(item);
  }
  return { schemaVersion: "suite-category-prompt-v1", category, items };
}

function categoryRequestView(request: CategoryPromptRequest) {
  return {
    id: request.id,
    suiteId: request.suiteId,
    planSnapshotId: request.planSnapshotId,
    categoryCode: request.categoryCode,
    requestedCount: request.requestedCount,
    status: request.status,
    idempotencyKey: request.idempotencyKey,
    retryOfRequestId: request.retryOfRequestId,
    templateVersionId: request.templateVersionId,
    provider: request.provider,
    requestSummary: request.requestSummary,
    responseSummary: request.responseSummary,
    items: request.items,
    errorCode: request.errorCode,
    errorMessage: request.errorMessage,
    createdAt: request.createdAt,
    completedAt: request.completedAt,
  };
}

export function planOutputMatchesRequestedCounts(output: { items: Array<{ imageType: "main" | "detail" }> }, dynamicInput: Record<string, unknown>): boolean {
  const outputMode = dynamicInput.output_mode;
  const expectations = [
    { imageType: "main" as const, enabled: outputMode !== "detail_only", mode: dynamicInput.main_image_count_mode, count: dynamicInput.main_image_count },
    { imageType: "detail" as const, enabled: outputMode !== "main_only", mode: dynamicInput.detail_image_count_mode, count: dynamicInput.detail_image_count },
  ];
  return expectations.every(({ imageType, enabled, mode, count }) => {
    if (!enabled || mode !== "fixed" || typeof count !== "number") return true;
    return output.items.filter((item) => item.imageType === imageType).length === count;
  });
}

function taskView(task: SuiteTask) { return task; }
function taskAttemptView(attempt: TaskGenerationAttempt) { return attempt; }
function taskBatchView(batch: TaskGenerationBatch) { return batch; }
function taskSlotView(slot: TaskResultSlot) { return slot; }
function taskVersionView(version: TaskImageVersion) { return version; }

export function createTicket02App(deps: { repository: SuiteRepository; storage: StorageAdapter; provider?: ImageProvider; promptRepository?: PromptRepository; platformRepository?: PlatformRepository; planRepository?: PlanRepository; categoryPromptRepository?: CategoryPromptRepository; taskRepository?: TaskRepository; ragClient?: RagClient; llmClient?: LlmClient; libraryRepository?: LibraryRepository; reverseRepository?: ReverseRepository; imageEditorApi?: { request(method: string, path: string, options?: { headers?: Record<string, string>; body?: unknown }): Promise<ImageEditorApiResponse> } }): Ticket02App {
  const uploadIdempotency = new Map<string, InputImage>();
  const categoryPromptRepository = deps.categoryPromptRepository ?? new MemoryCategoryPromptRepository();
  const reverseRepository = deps.reverseRepository ?? new MemoryReverseRepository();
  const reversePlanWrites = new Map<string, Promise<void>>();
  const withReversePlanWrite = async <T>(planId: string, action: () => Promise<T>): Promise<T> => {
    const previous = reversePlanWrites.get(planId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const current = previous.catch(() => undefined).then(() => gate);
    reversePlanWrites.set(planId, current);
    await previous.catch(() => undefined);
    try { return await action(); }
    finally { release(); if (reversePlanWrites.get(planId) === current) reversePlanWrites.delete(planId); }
  };

  const resolveCategorySourceSnapshot = async (snapshot: PlanSnapshot): Promise<PlanSnapshot> => {
    if (!deps.planRepository) return snapshot;
    let current = snapshot;
    const visited = new Set<string>();
    while (typeof current.requestSummary.sourceSnapshotId === "string" && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = await deps.planRepository.getSnapshot(current.requestSummary.sourceSnapshotId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };

  const listCategoryRequestsForSnapshot = async (snapshot: PlanSnapshot) => {
    const source = await resolveCategorySourceSnapshot(snapshot);
    return categoryPromptRepository.listRequests(source.id);
  };

  const samePlanItems = (left: PlanSnapshot["items"], right: PlanSnapshot["items"]) => left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other && item.id === other.id && item.prompt === other.prompt && item.title === other.title && item.purpose === other.purpose;
  });

  const appendMaterializedSnapshot = async (candidate: PlanSnapshot, items: PlanSnapshot["items"]) => {
    try {
      return await deps.planRepository!.appendRevision(candidate);
    } catch (error) {
      const conflict = error && typeof error === "object" && (error as { code?: string }).code === "23505" && (error as { constraint?: string }).constraint === "plan_snapshots_suite_id_revision_number_key";
      if (!conflict) throw error;
      const latest = await deps.planRepository!.getLatestSnapshot(candidate.suiteId);
      if (!latest || latest.phase !== "structure_plan" || latest.confirmationStatus !== "confirmed" || !samePlanItems(latest.items, items)) throw error;
      return latest;
    }
  };

  const appendConfirmedSnapshot = async (candidate: PlanSnapshot) => {
    try {
      return await deps.planRepository!.appendRevision(candidate);
    } catch (error) {
      const conflict = error && typeof error === "object" && (error as { code?: string }).code === "23505" && (error as { constraint?: string }).constraint === "plan_snapshots_suite_id_revision_number_key";
      if (!conflict) throw error;
      const latest = await deps.planRepository!.getLatestSnapshot(candidate.suiteId);
      if (!latest || latest.phase !== "structure_plan" || latest.confirmationStatus !== "confirmed" || JSON.stringify(latest.structure) !== JSON.stringify(candidate.structure)) throw error;
      return latest;
    }
  };

  const categoryPlanInput = (snapshot: PlanSnapshot, categoryCode: string, requestedCount: number, allocation: Record<string, unknown> | null) => {
    const styleCard = snapshot.structure?.globalStyleCard ?? {};
    const factRefs = allocation && Array.isArray(allocation.factRefs) ? allocation.factRefs.map(String) : [];
    const sourceImageIds = allocation && Array.isArray(allocation.sourceImageIds) ? allocation.sourceImageIds.map(String) : snapshot.inputImageIds;
    const categoryName = DETAIL_CATEGORY_NAMES[categoryCode] ?? categoryCode;
    const universalInput: Record<string, unknown> = {};
    for (const key of ["platform", "output_language", "product_name", "product_category", "brand", "target_market_country", "platform_text_rule", "text_strategy", "emphasis_requirements", "design_constraints"]) {
      if (snapshot.dynamicInput[key] !== undefined) universalInput[key] = snapshot.dynamicInput[key];
    }
    const facts = designerFactsText(snapshot.dynamicInput);
    if (facts) universalInput.human_supplement = facts;
    return {
      ...universalInput,
      category_code: categoryCode,
      category_name: categoryName,
      requested_count: requestedCount,
      global_style_card: styleCard,
      approved_fact_refs: factRefs,
      approved_facts: snapshot.chunks.filter((chunk) => factRefs.includes(chunk.sourceChunkId)).map((chunk) => ({ id: chunk.sourceChunkId, version: chunk.sourceVersion, title: chunk.title, content: chunk.content, fieldValues: chunk.fieldValues })),
      reference_image_ids: sourceImageIds,
      platform_text_rule: snapshot.dynamicInput.platform_text_rule ?? snapshot.dynamicInput.text_strategy ?? "platform rules from confirmed planning input",
    };
  };

  const categoryAllocationsForSnapshot = (snapshot: PlanSnapshot) => {
    if (!isStructurePlanV2(snapshot.structure) || snapshot.phase !== "structure_plan" || snapshot.confirmationStatus !== "confirmed" || snapshot.structure.status !== "READY_FOR_REVIEW") return [];
    const result: Array<{ categoryCode: string; requestedCount: number; allocation: Record<string, unknown> | null }> = [];
    if (snapshot.structure.mainAllocation.count > 0) result.push({ categoryCode: "main", requestedCount: snapshot.structure.mainAllocation.count, allocation: snapshot.structure.mainAllocation as unknown as Record<string, unknown> });
    for (const raw of snapshot.structure.categoryAllocations) {
      const allocation = raw as unknown as Record<string, unknown>;
      const code = String(allocation.category);
      if (!DETAIL_CATEGORY_CODES.has(code)) continue;
      const count = Number(allocation.count);
      if (Number.isInteger(count) && count > 0) result.push({ categoryCode: code, requestedCount: count, allocation });
    }
    return result;
  };

  const loadCategoryVisionImages = async (suiteId: string, snapshot: PlanSnapshot, allocation: Record<string, unknown> | null) => {
    const requestedIds = allocation && Array.isArray(allocation.sourceImageIds) ? allocation.sourceImageIds.map(String) : snapshot.inputImageIds;
    const images = await deps.repository.getInputImages(suiteId);
    const selected = images.filter((image) => requestedIds.includes(image.id));
    if (!selected.length) throw new Error("PLAN_INPUT_IMAGE_NOT_FOUND");
    const visionImages: NonNullable<CategoryPromptLlmInput["visionImages"]> = [];
    for (const image of selected) {
      let sourceKind: "base" | "original" = "original";
      let sourceVersionId: string | null = null;
      let sourceObjectKey = image.originalObjectKey;
      if (image.currentBaseVersionId) {
        const base = await deps.repository.getBaseImageVersion(suiteId, image.id, image.currentBaseVersionId);
        if (base) { sourceKind = "base"; sourceVersionId = base.id; sourceObjectKey = base.objectKey; }
      }
      if (sourceKind === "original") {
        const generationInputKey = image.originalObjectKey.replace(/\/original$/, "/generation-input.jpg");
        const generationInput = generationInputKey !== image.originalObjectKey ? await deps.storage.get(generationInputKey) : null;
        if (generationInput) { sourceObjectKey = generationInputKey; }
      }
      const source = await deps.storage.get(sourceObjectKey);
      if (!source) throw new Error("PLAN_INPUT_IMAGE_NOT_FOUND");
      visionImages.push({ id: image.id, sourceKind, sourceVersionId, mimeType: source.contentType, bytes: source.bytes });
    }
    return visionImages;
  };

  const createTaskBatch = async (suiteId: string, tasks: SuiteTask[], kind: "batch" | "single" | "retry", idempotencyKey: string, retryOfSlotId?: string, sourceVersionIds: Record<string, string> = {}) => {
    if (!deps.taskRepository) throw new Error("TASK_REPOSITORY_NOT_CONFIGURED");
    const now = new Date().toISOString();
    const batch: TaskGenerationBatch = { id: randomUUID(), suiteId, kind, requestedCount: tasks.length, taskIds: tasks.map((task) => task.id), status: "running", idempotencyKey, createdAt: now, startedAt: now, finishedAt: null };
    const slots: TaskResultSlot[] = tasks.map((task, index) => ({ id: randomUUID(), batchId: batch.id, taskId: task.id, slotOrdinal: index + 1, retryOfSlotId: retryOfSlotId ?? null, status: "generating", selectedVersionId: null, createdAt: now, completedAt: null }));
    const attempts: TaskGenerationAttempt[] = [];
    for (const [index, task] of tasks.entries()) {
      let sourceKind: "base" | "original" | "library" = "original"; let sourceObjectKey = ""; let sourceBaseVersionId: string | null = null; let sourceInputImageId: string | null = null; let sourceLibraryReferenceId: string | null = null; let sourceResourceVersionId: string | null = null;
      const generationParams = task.generationParams ?? {};
      const materialRefs = Array.isArray(generationParams.productMaterialRefs) ? generationParams.productMaterialRefs.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, 3) : [];
      const inputImages: Array<{ bytes: Buffer; mimeType: string; filename: string; role: string; objectKey: string; resourceId?: string; resourceVersionId?: string; libraryReferenceId?: string }> = [];
      if (materialRefs.length && deps.libraryRepository) {
        const references = await deps.libraryRepository.listReferences(suiteId, "task", task.id);
        for (const [materialIndex, material] of materialRefs.entries()) {
          const referenceId = typeof material.libraryReferenceId === "string" ? material.libraryReferenceId : "";
          const reference = references.find((item) => item.id === referenceId);
          const source = reference?.snapshot.source as Record<string, unknown> | undefined;
          if (!reference || reference.resourceType !== "base_image" || typeof source?.objectKey !== "string") throw new Error("TASK_INVALID_SOURCE");
          const stored = await deps.storage.get(source.objectKey);
          if (!stored) throw new Error("TASK_INVALID_SOURCE");
          inputImages.push({ bytes: stored.bytes, mimeType: stored.contentType, filename: `product-${materialIndex + 1}.png`, role: materialIndex === 0 ? "product_primary" : "product_detail", objectKey: source.objectKey, resourceId: reference.resourceId, resourceVersionId: reference.resourceVersionId, libraryReferenceId: reference.id });
        }
        const first = inputImages[0];
        if (first) { sourceKind = "library"; sourceObjectKey = (references.find((item) => item.id === first.libraryReferenceId)?.snapshot.source as Record<string, unknown>)?.objectKey as string; sourceLibraryReferenceId = first.libraryReferenceId ?? null; sourceResourceVersionId = first.resourceVersionId ?? null; sourceBaseVersionId = first.resourceVersionId ?? null; }
      }
      const currentTaskVersionId = sourceVersionIds[task.id];
      if (currentTaskVersionId) {
        const history = await deps.taskRepository.listTaskVersions(task.id);
        const current = history.versions.find((version) => version.id === currentTaskVersionId && version.isCurrent);
        if (!current) throw new Error("TASK_CURRENT_VERSION_NOT_FOUND");
        sourceKind = "original";
        sourceObjectKey = current.objectKey;
        sourceBaseVersionId = null;
        sourceInputImageId = task.sourceInputImageId;
      } else if (!inputImages.length && task.sourceLibraryReferenceId && deps.libraryRepository) {
        const reference = (await deps.libraryRepository.listReferences(suiteId, "task", task.id)).find((item) => item.id === task.sourceLibraryReferenceId);
        const source = reference?.snapshot.source as Record<string, unknown> | undefined;
        if (!reference || reference.resourceType !== "base_image" || typeof source?.objectKey !== "string") throw new Error("TASK_INVALID_SOURCE");
        sourceKind = "library"; sourceObjectKey = source.objectKey; sourceLibraryReferenceId = reference.id; sourceResourceVersionId = reference.resourceVersionId;
        sourceBaseVersionId = typeof reference.snapshot.baseVersionId === "string" ? reference.snapshot.baseVersionId : null;
      } else if (!inputImages.length) {
        const image = await deps.repository.getInputImage(suiteId, task.sourceInputImageId ?? "");
        if (!image) throw new Error("TASK_INVALID_SOURCE");
        sourceKind = "original"; sourceObjectKey = image.originalObjectKey; sourceInputImageId = image.id;
        if (image.currentBaseVersionId) { const base = await deps.repository.getBaseImageVersion(suiteId, image.id, image.currentBaseVersionId); if (base) { sourceKind = "base"; sourceObjectKey = base.objectKey; sourceBaseVersionId = base.id; } }
      }
      if (task.originKind === "reverse_import" && generationParams.explosiveReferenceEnabled !== false && task.reversePlanId && task.reverseReferenceId) {
        const ref = await reverseRepository.getPlan(task.reversePlanId).then((plan) => plan?.references.find((item) => item.id === task.reverseReferenceId));
        const stored = ref ? await deps.storage.get(ref.objectKey) : null;
        if (stored) inputImages.push({ bytes: stored.bytes, mimeType: stored.contentType, filename: "explosive-reference.png", role: "explosive_reference", objectKey: ref?.objectKey ?? "" });
      }
      if (!inputImages.length) inputImages.push({ bytes: (await deps.storage.get(sourceObjectKey))?.bytes ?? Buffer.alloc(0), mimeType: "image/png", filename: task.title.replace(/[^\w.-]+/g, "_") + ".png", role: "product", objectKey: sourceObjectKey });
      const inputSnapshot = inputImages.map((item) => ({ role: item.role, filename: item.filename, mimeType: item.mimeType, resourceId: item.resourceId ?? null, resourceVersionId: item.resourceVersionId ?? null, libraryReferenceId: item.libraryReferenceId ?? null, objectKey: item.objectKey }));
      attempts.push({ id: randomUUID(), slotId: slots[index].id, attemptNo: 1, provider: deps.provider ? "image-provider" : "unconfigured", model: "gpt-image-2", endpoint: "/v1/images/edits", requestSummary: { n: 1, imageCount: inputImages.length, inputRoles: inputImages.map((item) => item.role), size: generationParams.size ?? "1K", quality: generationParams.quality ?? "medium" }, promptSnapshot: { prompt: task.promptDraft, promptRevision: task.promptRevision, planSnapshotId: task.planSnapshotId, planItemId: task.planItemId, reversePromptVersionId: task.reversePromptVersionId ?? null, categoryCode: task.categoryCode ?? null, referenceImageIds: task.referenceImageIds ?? [], factRefs: task.factRefs ?? [], globalStyleCard: task.globalStyleCard ?? {}, finalPrompt: task.promptDraft, generationParams, productMaterialRefs: materialRefs, explosiveReferenceEnabled: generationParams.explosiveReferenceEnabled !== false, inputImages: inputSnapshot }, promptSha256: task.promptSha256 ?? createHash("sha256").update(task.promptDraft).digest("hex"), contextSnapshot: { suiteTaskId: task.id, planSnapshotId: task.planSnapshotId, planItemId: task.planItemId, reversePlanId: task.reversePlanId ?? null, reverseReferenceId: task.reverseReferenceId ?? null, sourceRevision: task.sourceRevision ?? 0, imageType: task.imageType, categoryCode: task.categoryCode ?? null, globalStyleCard: task.globalStyleCard ?? {}, inputImages: inputImages.map((item) => ({ objectKey: item.objectKey, mimeType: item.mimeType, filename: item.filename, role: item.role })) }, sourceKind, sourceObjectKey, sourceInputImageId, sourceBaseVersionId, sourceLibraryReferenceId, sourceResourceVersionId, status: "running", errorCode: null, errorMessage: null, externalRequestId: null, startedAt: now, finishedAt: null });
    }
    const reservation = await deps.taskRepository.beginBatch({ batch, slots, attempts });
    if (!reservation.duplicate) {
      for (const attempt of attempts) void executeTaskAttempt(attempt, tasks.find((task) => task.id === attempt.contextSnapshot.suiteTaskId) ?? tasks[attempts.indexOf(attempt)], slots.find((slot) => slot.id === attempt.slotId)!);
    }
    return reservation;
  };

  const executeTaskAttempt = async (attempt: TaskGenerationAttempt, task: SuiteTask, slot: TaskResultSlot) => {
    if (!deps.taskRepository) return;
    const finish = new Date().toISOString();
    if (!deps.provider) { await deps.taskRepository.failAttempt(attempt.id, "TASK_IMAGE_PROVIDER_NOT_CONFIGURED", errorMessages.TASK_IMAGE_PROVIDER_NOT_CONFIGURED, finish); return; }
    try {
      const source = await deps.storage.get(attempt.sourceObjectKey);
      if (!source) { await deps.taskRepository.failAttempt(attempt.id, "TASK_INVALID_SOURCE", errorMessages.TASK_INVALID_SOURCE, finish); return; }
      const snapshotInputs = Array.isArray(attempt.contextSnapshot.inputImages) ? attempt.contextSnapshot.inputImages as Array<Record<string, unknown>> : [];
      const images = snapshotInputs.length ? (await Promise.all(snapshotInputs.map(async (item) => { const objectKey = typeof item.objectKey === "string" ? item.objectKey : ""; const stored = objectKey ? await deps.storage.get(objectKey) : null; return stored ? { bytes: stored.bytes, mimeType: stored.contentType, filename: String(item.filename ?? "reference.png"), role: String(item.role ?? "reference") } : null; }))).filter((item): item is { bytes: Buffer; mimeType: string; filename: string; role: string } => Boolean(item)) : [{ bytes: source.bytes, mimeType: source.contentType, filename: task.title.replace(/[^\w.-]+/g, "_") + ".png", role: "product" }];
      if (images.length > 1 && deps.provider.supportsMultipleImages === false) { await deps.taskRepository.failAttempt(attempt.id, "TASK_PROVIDER_MULTI_IMAGE_UNSUPPORTED", "当前图片模型不支持多图输入", finish); return; }
      const generated = await deps.provider.edit({ requestId: attempt.id, flow: "suite-task-generation", endpoint: "/v1/images/edits", image: images[0].bytes, imageMimeType: images[0].mimeType, imageFilename: images[0].filename, images, model: "gpt-image-2", prompt: task.promptDraft, size: (task.generationParams.size === "2K" || task.generationParams.size === "4K" ? "1K" : "1K"), quality: "medium", n: 1, responseFormat: "b64_json" });
      const processed = await processGeneratedImage(generated.bytes);
      const objectKey = `suites/${task.suiteId}/tasks/${task.id}/versions/${randomUUID()}/final.png`;
      await deps.storage.put({ key: objectKey, bytes: processed.bytes, contentType: processed.mimeType });
      await deps.taskRepository.completeAttempt({ attemptId: attempt.id, slotId: slot.id, taskId: task.id, objectKey, processObjectKeys: [], sha256: processed.sha256, width: processed.width, height: processed.height, mimeType: processed.mimeType, completedAt: new Date().toISOString() });
    } catch (error) {
      await deps.taskRepository.failAttempt(attempt.id, error instanceof Error && error.message.includes("TIMEOUT") ? "TASK_IMAGE_PROVIDER_TIMEOUT" : "TASK_IMAGE_PROVIDER_FAILED", errorMessages.TASK_IMAGE_PROVIDER_FAILED, new Date().toISOString()).catch(() => undefined);
    }
  };

  const request = async (method: string, path: string, options: { headers?: Record<string, string>; body?: unknown } = {}): Promise<AppResponse> => {
    if (path.startsWith("/api/image-editor/")) return deps.imageEditorApi ? deps.imageEditorApi.request(method, path, options) : fail("IMAGE_EDITOR_NOT_CONFIGURED", 503);
    const idempotencyKey = options.headers?.["idempotency-key"] ?? options.headers?.["Idempotency-Key"];
    const reversePlanMatch = path.match(/^\/api\/reverse-plans\/([^/]+)$/);
    if (method === "POST" && path === "/api/reverse-plans") {
      const result = await reverseRepository.createPlan(idempotencyKey); const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      if (body.mode === "detail") result.plan.mode = "detail";
      return ok(await reverseRepository.savePlan(result.plan), result.duplicate ? 200 : 201);
    }
    if (method === "GET" && path === "/api/reverse-plans") return ok(await reverseRepository.listPlans());
    if (reversePlanMatch && method === "GET") { const plan = await reverseRepository.getPlan(reversePlanMatch[1]); return plan ? ok(plan) : fail("INVALID_REVERSE_PLAN", 404); }
    if (reversePlanMatch && method === "PATCH") {
      const plan = await reverseRepository.getPlan(reversePlanMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      if (body.mode !== undefined && body.mode !== "main" && body.mode !== "detail") return fail("INVALID_REVERSE_MODE");
      const next = { ...plan, mode: (body.mode ?? plan.mode) as "main" | "detail", baselineReferenceId: typeof body.baselineReferenceId === "string" ? body.baselineReferenceId : body.baselineReferenceId === null ? null : plan.baselineReferenceId, updatedAt: new Date().toISOString() };
      if (next.mode === "detail" && !next.baselineReferenceId && next.references[0]) next.baselineReferenceId = next.references[0].id;
      return ok(await reverseRepository.savePlan(next));
    }
    const reverseRefsMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/references$/);
    if (reverseRefsMatch && method === "POST") {
      return withReversePlanWrite(reverseRefsMatch[1], async () => {
        const plan = await reverseRepository.getPlan(reverseRefsMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404);
        if (plan.references.length >= 16) return fail("REVERSE_REFERENCE_LIMIT", 400);
        const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
        if (typeof body.filename !== "string" || typeof body.mimeType !== "string" || typeof body.bytesBase64 !== "string") return fail("INVALID_INPUT_IMAGE");
        let processed; try { processed = await processImage(Buffer.from(body.bytesBase64, "base64"), body.mimeType); } catch (error) { const code = error instanceof Error ? error.message : "INVALID_IMAGE"; return fail(code); }
        if (plan.references.some((item) => item.sha256 === processed.sha256)) return fail("DUPLICATE_IMAGE", 409, "该参考图已存在");
        const referenceId = randomUUID(); const objectKey = `reverse-plans/${plan.id}/references/${referenceId}/original`; const thumbKey = `reverse-plans/${plan.id}/references/${referenceId}/thumbnail`;
        await deps.storage.put({ key: objectKey, bytes: Buffer.from(body.bytesBase64, "base64"), contentType: processed.mimeType }); await deps.storage.put({ key: thumbKey, bytes: processed.thumbnail, contentType: "image/jpeg" });
        const reference: ReverseReference = { id: referenceId, planId: plan.id, ordinal: plan.references.length + 1, filename: body.filename, mimeType: processed.mimeType, sha256: processed.sha256, width: processed.width, height: processed.height, objectKey, thumbnailObjectKey: thumbKey, templateVersionId: null, attempts: [], promptVersions: [], effectivePromptVersionId: null, createdAt: new Date().toISOString() };
        const next = { ...plan, references: [...plan.references, reference], baselineReferenceId: plan.mode === "detail" && !plan.baselineReferenceId ? reference.id : plan.baselineReferenceId, updatedAt: new Date().toISOString() }; await reverseRepository.savePlan(next); return ok(reference, 201);
      });
    }
    const reverseRefMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/references\/([^/]+)$/);
    if (reverseRefMatch && method === "PATCH") {
      const plan = await reverseRepository.getPlan(reverseRefMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {}; const refs = [...plan.references]; const ref = refs.find((item) => item.id === reverseRefMatch[2]); if (!ref) return fail("REVERSE_REFERENCE_NOT_FOUND", 404);
      if (typeof body.templateVersionId === "string") { if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503); const template = await deps.promptRepository.getPublishedVersion(body.templateVersionId, "reverse_prompt"); if (!template || template.applicability.targetType !== plan.mode) return fail("REVERSE_TEMPLATE_NOT_FOUND", 400); ref.templateVersionId = template.templateVersionId; }
      if (typeof body.ordinal === "number") { const target = Math.max(1, Math.min(refs.length, Math.trunc(body.ordinal))); refs.splice(refs.indexOf(ref), 1); refs.splice(target - 1, 0, ref); refs.forEach((item, i) => item.ordinal = i + 1); }
      await reverseRepository.savePlan({ ...plan, references: refs, updatedAt: new Date().toISOString() }); return ok(ref);
    }
    if (reverseRefMatch && method === "DELETE") {
      const plan = await reverseRepository.getPlan(reverseRefMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const removed = plan.references.find((item) => item.id === reverseRefMatch[2]); if (!removed) return fail("REVERSE_REFERENCE_NOT_FOUND", 404);
      const refs = plan.references.filter((item) => item.id !== removed.id); refs.forEach((item, index) => item.ordinal = index + 1); const baselineReferenceId = plan.baselineReferenceId === removed.id ? refs[0]?.id ?? null : plan.baselineReferenceId;
      await reverseRepository.savePlan({ ...plan, references: refs, baselineReferenceId, updatedAt: new Date().toISOString() }); return ok({ id: removed.id, removed: true, baselineReferenceId });
    }
    const reverseRunMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/references\/([^/]+)\/(run|retry)$/);
    if (reverseRunMatch && method === "POST") {
      const plan = await reverseRepository.getPlan(reverseRunMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const ref = plan.references.find((item) => item.id === reverseRunMatch[2]); if (!ref) return fail("REVERSE_REFERENCE_NOT_FOUND", 404); if (!ref.templateVersionId) return fail("REVERSE_TEMPLATE_REQUIRED");
      if (!deps.llmClient?.generateReversePrompt || !deps.promptRepository) return fail("REVERSE_LLM_NOT_CONFIGURED", 503);
      const template = await observedPromptLoad(deps.promptRepository, ref.templateVersionId, "reverse_prompt"); if (!template || template.applicability.targetType !== plan.mode) return fail("REVERSE_TEMPLATE_NOT_FOUND", 400);
      const source = await deps.storage.get(ref.objectKey); if (!source) return fail("INPUT_OBJECT_NOT_FOUND", 404); let baseline: Buffer | undefined; if (plan.mode === "detail" && plan.baselineReferenceId && plan.baselineReferenceId !== ref.id) { const base = plan.references.find((item) => item.id === plan.baselineReferenceId); if (base) baseline = (await deps.storage.get(base.objectKey))?.bytes; }
      const attempt: ReverseAttempt = { id: randomUUID(), referenceId: ref.id, status: "running", retryOfAttemptId: reverseRunMatch[3] === "retry" ? [...ref.attempts].reverse().find((item) => item.status === "failed")?.id ?? null : null, templateVersionId: template.templateVersionId, mode: plan.mode, baselineReferenceId: plan.baselineReferenceId, requestSummary: { provider: deps.llmClient.provider, model: deps.llmClient.model, inputRoles: baseline ? ["reference", "series_color_baseline"] : ["reference"] }, rawOutput: null, errorCode: null, errorMessage: null, promptVersionId: null, createdAt: new Date().toISOString(), completedAt: null }; ref.attempts.push(attempt); await reverseRepository.savePlan({ ...plan, updatedAt: new Date().toISOString() });
      void (async () => {
        try {
          const output = await deps.llmClient!.generateReversePrompt!({ template: { body: template.body, userPromptTemplate: template.userPromptTemplate, templateVersionId: template.templateVersionId }, referenceImageId: ref.id, referenceImage: source.bytes, baselineImage: baseline, mode: plan.mode });
          const parsed = typeof output === "string" ? JSON.parse(output) : output; const row = parsed as Record<string, unknown>;
          if (!row || row.schemaVersion !== "reverse-prompt-v1" || row.referenceImageId !== ref.id || typeof row.prompt !== "string" || !row.prompt.trim()) throw new Error("REVERSE_OUTPUT_INVALID");
          const generatedPrompt = row.prompt.trim();
          await withReversePlanWrite(plan.id, async () => {
            const latest = await reverseRepository.getPlan(plan.id); const latestRef = latest?.references.find((item) => item.id === ref.id); const latestAttempt = latestRef?.attempts.find((item) => item.id === attempt.id);
            if (!latest || !latestRef || !latestAttempt) return;
            const version: ReversePromptVersion = { id: randomUUID(), referenceId: ref.id, kind: "model", prompt: generatedPrompt, rawOutput: output, templateVersionId: template.templateVersionId, mode: plan.mode, provider: { name: deps.llmClient!.provider, model: deps.llmClient!.model, isFake: deps.llmClient!.isFake }, createdAt: new Date().toISOString() };
            latestRef.promptVersions.push(version); latestRef.effectivePromptVersionId = version.id; latestAttempt.status = "succeeded"; latestAttempt.rawOutput = output; latestAttempt.promptVersionId = version.id; latestAttempt.completedAt = new Date().toISOString();
            await reverseRepository.savePlan({ ...latest, updatedAt: new Date().toISOString() });
          });
        } catch (error) {
          await withReversePlanWrite(plan.id, async () => {
            const latest = await reverseRepository.getPlan(plan.id); const latestAttempt = latest?.references.find((item) => item.id === ref.id)?.attempts.find((item) => item.id === attempt.id);
            if (!latest || !latestAttempt) return;
            latestAttempt.status = "failed"; latestAttempt.errorCode = error instanceof Error ? error.message : "REVERSE_OUTPUT_INVALID"; latestAttempt.errorMessage = latestAttempt.errorCode; latestAttempt.completedAt = new Date().toISOString();
            await reverseRepository.savePlan({ ...latest, updatedAt: new Date().toISOString() });
          });
        }
      })();
      return ok({ attemptId: attempt.id }, 202);
    }
    const reverseBatchMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/attempts$/);
    if (reverseBatchMatch && method === "POST") {
      const plan = await reverseRepository.getPlan(reverseBatchMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const results: Array<{ referenceId: string; attemptId?: string; error?: string }> = [];
      for (const reference of plan.references) {
        if (!reference.templateVersionId || reference.attempts.some((item) => item.status === "succeeded")) continue;
        const response = await request("POST", `/api/reverse-plans/${plan.id}/references/${reference.id}/run`, { headers: options.headers }); const data = "data" in response.body ? response.body.data as { attemptId: string } : null;
        results.push(data ? { referenceId: reference.id, attemptId: data.attemptId } : { referenceId: reference.id, error: "error" in response.body ? response.body.error.code : "REVERSE_OUTPUT_INVALID" });
      }
      return ok({ planId: plan.id, attempts: results }, 202);
    }
    const reverseAttemptMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/attempts\/([^/]+)$/);
    if (reverseAttemptMatch && method === "GET") { const plan = await reverseRepository.getPlan(reverseAttemptMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const found = plan.references.flatMap((item) => item.attempts).find((item) => item.id === reverseAttemptMatch[2]); return found ? ok(found) : fail("REVERSE_REFERENCE_NOT_FOUND", 404); }
    const reversePromptMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/references\/([^/]+)\/prompt$/);
    if (reversePromptMatch && method === "PATCH") {
      const plan = await reverseRepository.getPlan(reversePromptMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const ref = plan.references.find((item) => item.id === reversePromptMatch[2]); if (!ref) return fail("REVERSE_REFERENCE_NOT_FOUND", 404);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {}; if (typeof body.prompt !== "string" || !body.prompt.trim()) return fail("REVERSE_OUTPUT_INVALID");
      const source = ref.promptVersions.find((item) => item.id === ref.effectivePromptVersionId) ?? [...ref.promptVersions].reverse()[0]; if (!source) return fail("REVERSE_OUTPUT_INVALID");
      const version: ReversePromptVersion = { ...source, id: randomUUID(), kind: "user", prompt: body.prompt.trim(), rawOutput: null, createdAt: new Date().toISOString() }; ref.promptVersions.push(version); ref.effectivePromptVersionId = version.id; await reverseRepository.savePlan({ ...plan, updatedAt: new Date().toISOString() }); return ok(version, 201);
    }
    const reverseAssetMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/references\/([^/]+)\/asset$/);
    if (reverseAssetMatch && method === "POST") {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503); const plan = await reverseRepository.getPlan(reverseAssetMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404); const ref = plan.references.find((item) => item.id === reverseAssetMatch[2]); if (!ref) return fail("REVERSE_REFERENCE_NOT_FOUND", 404); const prompt = ref.promptVersions.find((item) => item.id === ref.effectivePromptVersionId); if (!prompt) return fail("REVERSE_OUTPUT_INVALID");
      const result = await deps.libraryRepository.createReverseReferenceAsset({ title: ref.filename, summary: `${plan.mode === "main" ? "主图" : "详情图"}反推资产，不作为商品事实`, objectKey: ref.objectKey, mimeType: ref.mimeType, promptSnapshot: { prompt: prompt.prompt, promptVersionId: prompt.id }, visualStructure: { mode: plan.mode }, source: { reversePlanId: plan.id, referenceId: ref.id, sha256: ref.sha256, templateVersionId: prompt.templateVersionId } }); return ok(result, 201);
    }
    const reverseCanvasMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/canvas-imports$/);
    if (reverseCanvasMatch && method === "POST") {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const plan = await reverseRepository.getPlan(reverseCanvasMatch[1]); if (!plan) return fail("INVALID_REVERSE_PLAN", 404);
      const items = plan.references.map((reference) => ({ reference, prompt: reference.promptVersions.find((version) => version.id === reference.effectivePromptVersionId) })).filter((item): item is { reference: ReverseReference; prompt: ReversePromptVersion } => Boolean(item.prompt && item.reference.attempts.some((attempt) => attempt.status === "succeeded")));
      if (!items.length) return fail("REVERSE_CANVAS_NO_RESULTS", 409);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      let suite = typeof body.targetSuiteId === "string" ? await deps.repository.getSuite(body.targetSuiteId) : null;
      if (typeof body.targetSuiteId === "string" && !suite) return fail("INVALID_SUITE_ID", 404);
      if (!suite) suite = await deps.repository.createSuite(typeof body.name === "string" && body.name.trim() ? body.name.trim() : `爆品图反推 ${new Date().toISOString().slice(0, 10)}`, `${idempotencyKey}:suite`);
      const taskGroupId = typeof body.taskGroupId === "string" ? body.taskGroupId : randomUUID();
      const result = await deps.taskRepository.createReverseTasks({ suiteId: suite.id, reversePlanId: plan.id, taskGroupId, mode: plan.mode, idempotencyKey, items: items.map(({ reference, prompt }) => ({ referenceId: reference.id, ordinal: reference.ordinal, filename: reference.filename, promptVersionId: prompt.id, prompt: prompt.prompt })) });
      return ok({ suiteId: suite.id, taskGroupId: result.created[0]?.reverseTaskGroupId ?? taskGroupId, taskIds: result.created.map((task) => task.id), duplicate: result.duplicate }, result.duplicate ? 200 : 201);
    }
    if (method === "POST" && path === "/api/suites") {
      const name = typeof options.body === "object" && options.body !== null && "name" in options.body ? String((options.body as { name: unknown }).name).trim() : "";
      if (!name) return fail("EMPTY_NAME");
      return ok(await deps.repository.createSuite(name, idempotencyKey), 201);
    }
    if (method === "GET" && path === "/api/suites") return ok(await deps.repository.listSuites());
    const libraryResourceMatch = path.match(/^\/api\/library\/resources\/([^/]+)$/);
    if (method === "GET" && libraryResourceMatch) {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const resource = await deps.libraryRepository.getResource(libraryResourceMatch[1]);
      return resource ? ok(resource) : fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
    }
    const libraryPreviewMatch = path.match(/^\/api\/library\/resources\/([^/]+)\/preview$/);
    if (method === "GET" && libraryPreviewMatch) return await (async () => {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const resource = await deps.libraryRepository.getResource(libraryPreviewMatch[1]);
      if (!resource) return fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
      const target = await deps.libraryRepository.getPreviewObject(resource.id);
      return target ? previewObject(target.objectKey, deps.storage) : fail("OBJECT_NOT_FOUND", 404);
    })();
    if (method === "GET" && path.startsWith("/api/library/resources")) {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const resourceType = params.get("resourceType") as import("./types.js").LibraryResourceType | null;
      const stage = params.get("stage") as PromptStage | null;
      if (stage && !PROMPT_STAGES.includes(stage)) return fail("INVALID_PROMPT_STAGE");
      const status = params.get("status") as import("./types.js").LibraryAssetStatus | null;
      if (status && !["draft", "published", "archived"].includes(status)) return fail("INVALID_LIBRARY_STATUS");
      return ok(await deps.libraryRepository.listResources({ resourceType: resourceType ?? undefined, stage: stage ?? undefined, suiteId: params.get("suiteId") ?? undefined, query: params.get("query") ?? undefined, status: status ?? undefined, page: Number(params.get("page") ?? 1), pageSize: Number(params.get("pageSize") ?? 24) }));
    }
    const reverseAssetStatusMatch = path.match(/^\/api\/library\/resources\/([^/]+)\/status$/);
    if (method === "POST" && reverseAssetStatusMatch) {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const status = body.status as import("./types.js").LibraryAssetStatus;
      if (!["draft", "published", "archived"].includes(status)) return fail("INVALID_LIBRARY_STATUS");
      const resource = await deps.libraryRepository.setResourceStatus(reverseAssetStatusMatch[1], status);
      return resource ? ok(resource) : fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
    }
    if (method === "POST" && path === "/api/library/reverse-reference-assets") {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      if (typeof body.title !== "string" || typeof body.objectKey !== "string" || typeof body.mimeType !== "string" || !body.promptSnapshot || typeof body.promptSnapshot !== "object") return fail("INVALID_REVERSE_REFERENCE_ASSET");
      const asset = await deps.libraryRepository.createReverseReferenceAsset({ suiteId: typeof body.suiteId === "string" ? body.suiteId : null, title: body.title, summary: typeof body.summary === "string" ? body.summary : "", objectKey: body.objectKey, mimeType: body.mimeType, promptSnapshot: body.promptSnapshot as Record<string, unknown>, visualStructure: body.visualStructure && typeof body.visualStructure === "object" ? body.visualStructure as Record<string, unknown> : {}, source: body.source && typeof body.source === "object" ? body.source as Record<string, unknown> : {} });
      return ok(asset, 201);
    }
    const libraryReferencesMatch = path.match(/^\/api\/suites\/([^/]+)\/library\/references(?:\/([^/?]+))?(?:\?.*)?$/);
    if (libraryReferencesMatch && method === "GET") {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      return ok(await deps.libraryRepository.listReferences(libraryReferencesMatch[1], (params.get("targetType") as "plan" | "task" | null) ?? undefined, params.get("targetId") ?? undefined));
    }
    if (libraryReferencesMatch && method === "POST" && !libraryReferencesMatch[2]) {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      if (typeof body.resourceId !== "string" || (body.targetType !== "plan" && body.targetType !== "task") || typeof body.targetId !== "string") return fail("LIBRARY_RESOURCE_NOT_FOUND");
      try { const result = await deps.libraryRepository.createReference({ suiteId: libraryReferencesMatch[1], resourceId: body.resourceId, targetType: body.targetType, targetId: body.targetId, idempotencyKey, createdBy: typeof body.createdBy === "string" ? body.createdBy : null }); return ok(result.reference, result.duplicate ? 200 : 201); }
      catch (error) { const code = error instanceof Error ? error.message : "LIBRARY_RESOURCE_NOT_FOUND"; return fail(code, code === "LIBRARY_RESOURCE_FORBIDDEN" || code === "LIBRARY_TARGET_NOT_FOUND" ? 403 : code === "LIBRARY_RESOURCE_NOT_FOUND" ? 404 : 409); }
    }
    if (libraryReferencesMatch && method === "DELETE" && libraryReferencesMatch[2]) {
      if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const archived = await deps.libraryRepository.archiveReference(libraryReferencesMatch[1], libraryReferencesMatch[2]);
      return archived ? ok(archived) : fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
    }
    const promptCopyMatch = path.match(/^\/api\/prompt-templates\/([^/]+)\/copy(?:\?.*)?$/);
    const promptVersionMatch = path.match(/^\/api\/prompt-templates\/([^/]+)\/versions$/);
    if (method === "GET" && promptVersionMatch) {
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      return ok(await deps.promptRepository.listVersions(promptVersionMatch[1]));
    }
    const promptLifecycleMatch = path.match(/^\/api\/prompt-templates\/([^/]+)$/);
    if (method === "PATCH" && promptLifecycleMatch) {
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const updated = await deps.promptRepository.updateDraft(promptLifecycleMatch[1], {
        name: typeof body.name === "string" ? body.name : undefined,
        body: typeof body.body === "string" ? body.body : undefined,
        userPromptTemplate: typeof body.userPromptTemplate === "string" ? body.userPromptTemplate : undefined,
        inputSchema: Array.isArray(body.inputSchema) ? body.inputSchema as never : undefined,
        outputSchema: body.outputSchema && typeof body.outputSchema === "object" ? body.outputSchema as Record<string, unknown> : undefined,
        applicability: body.applicability && typeof body.applicability === "object" ? body.applicability as Record<string, unknown> : undefined,
      });
      return updated ? ok(updated) : fail("PROMPT_DRAFT_NOT_FOUND", 404);
    }
    const promptCopyPostMatch = path.match(/^\/api\/prompt-templates\/([^/]+)\/copy$/);
    if (method === "POST" && promptCopyPostMatch) {
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      const copied = await deps.promptRepository.copyVersion(promptCopyPostMatch[1]);
      return copied ? ok(copied, 201) : fail("PROMPT_TEMPLATE_NOT_FOUND", 404);
    }
    const promptPublishMatch = path.match(/^\/api\/prompt-templates\/([^/]+)\/publish$/);
    if (method === "POST" && promptPublishMatch) {
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      const published = await deps.promptRepository.publishVersion(promptPublishMatch[1]);
      return published ? ok(published) : fail("PROMPT_TEMPLATE_NOT_FOUND", 404);
    }
    const promptRetireMatch = path.match(/^\/api\/prompt-templates\/([^/]+)\/retire$/);
    if (method === "POST" && promptRetireMatch) {
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      const retired = await deps.promptRepository.retireVersion(promptRetireMatch[1]);
      return retired ? ok(retired) : fail("PROMPT_TEMPLATE_NOT_FOUND", 404);
    }
    if (method === "GET" && promptCopyMatch) {
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const stageValue = params.get("stage") ?? undefined;
      if (stageValue && !PROMPT_STAGES.includes(stageValue as PromptStage)) return fail("INVALID_PROMPT_STAGE");
      const template = await deps.promptRepository.getPublishedVersion(promptCopyMatch[1], stageValue as PromptStage | undefined);
      if (!template) return fail("PROMPT_TEMPLATE_NOT_FOUND", 404);
      return ok({ templateId: template.templateId, templateVersionId: template.templateVersionId, versionNo: template.versionNo, code: template.code, name: template.name, kind: template.kind, stage: template.stage, executionTarget: template.executionTarget, inputSchema: template.inputSchema, applicability: template.applicability, body: template.body, userPromptTemplate: template.userPromptTemplate });
    }
    if (method === "GET" && path.startsWith("/api/prompt-templates")) {
      if (!deps.promptRepository) return ok([]);
      const stageValue = new URLSearchParams(path.split("?")[1] ?? "").get("stage") ?? undefined;
      if (stageValue && !PROMPT_STAGES.includes(stageValue as PromptStage)) return fail("INVALID_PROMPT_STAGE");
      return ok(await deps.promptRepository.listPublished(stageValue as PromptStage | undefined));
    }
    if (method === "GET" && path === "/api/platforms") {
      return ok(deps.platformRepository ? await deps.platformRepository.listEnabled() : []);
    }
    if (method === "GET" && path === "/api/health") return ok({ ready: true });

    if (method === "POST" && path === "/api/rag/chunks/search") {
      if (!deps.ragClient) return fail("RAG_NOT_CONFIGURED", 503);
      const query = options.body && typeof options.body === "object" && "query" in options.body ? String((options.body as { query: unknown }).query) : "";
      const observation = startTool("rag.query", { query }, { query_length: query.length });
      try {
        const result = await deps.ragClient.search(query);
        finishObservation(observation, { result_count: Array.isArray(result) ? result.length : undefined });
        return ok(result);
      } catch (error) {
        failObservation(observation, error);
        throw error;
      }
    }

    const planAttemptMatch = path.match(/^\/api\/plan-attempts\/([^/]+)$/);
    if (method === "GET" && planAttemptMatch) {
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const attempt = await deps.planRepository.getAttempt(planAttemptMatch[1]);
      if (!attempt) return fail("INVALID_PLAN_ATTEMPT", 404);
      const snapshot = attempt.snapshotId ? await deps.planRepository.getSnapshot(attempt.snapshotId) : null;
      return ok(planAttemptView(attempt, snapshot));
    }

    const structureMatch = path.match(/^\/api\/suites\/([^/]+)\/structure-plan$/);
    if (method === "GET" && structureMatch) {
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const snapshot = await deps.planRepository.getLatestSnapshot(structureMatch[1]);
      const attempt = await deps.planRepository.getLatestAttempt(structureMatch[1]);
      return ok({ attempt: attempt ? planAttemptView(attempt, attempt.snapshotId === snapshot?.id ? snapshot : null) : null, snapshot: snapshot && snapshot.phase === "structure_plan" ? planSnapshotView(snapshot) : null });
    }
    if (method === "POST" && structureMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      if (!deps.ragClient) return fail("RAG_NOT_CONFIGURED", 503);
      if (!deps.llmClient) return fail("LLM_NOT_CONFIGURED", 503);
      const suite = await deps.repository.getSuite(structureMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const body = options.body && typeof options.body === "object" && !Array.isArray(options.body) ? options.body as Record<string, unknown> : {};
      const templateVersionId = typeof body.templateVersionId === "string" ? body.templateVersionId : "";
      const template = await deps.promptRepository.getPublishedVersion(templateVersionId, "structure_plan");
      if (!template) return fail("PLAN_TEMPLATE_NOT_FOUND", 404);
       const rawInput = body.dynamicInput && typeof body.dynamicInput === "object" && !Array.isArray(body.dynamicInput) ? body.dynamicInput as Record<string, unknown> : {};
       const dynamicInput = { ...rawInput, selected_detail_categories: Array.isArray(rawInput.selected_detail_categories) ? JSON.stringify(rawInput.selected_detail_categories) : rawInput.selected_detail_categories, category_requirements: rawInput.category_requirements && typeof rawInput.category_requirements === "object" ? JSON.stringify(rawInput.category_requirements) : rawInput.category_requirements };
      const validated = validateDynamicInput(template.inputSchema, dynamicInput);
      if (!validated.ok) return fail("PROMPT_INPUT_INVALID", 400, validated.message);
      const platformValue = typeof validated.value.platform === "string" ? validated.value.platform.trim() : "";
      const platformProfile = platformValue && deps.platformRepository ? await deps.platformRepository.find(platformValue) : null;
      if (platformValue && deps.platformRepository && !platformProfile) return fail("PLATFORM_NOT_FOUND");
      const humanInput = body.humanInput && typeof body.humanInput === "object" && !Array.isArray(body.humanInput) ? body.humanInput as Record<string, unknown> : {};
      const refs = Array.isArray(body.selectedChunks) ? body.selectedChunks.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).version === "string" ? [{ id: (item as { id: string }).id, version: (item as { version: string }).version }] : []) : [];
      const chunks = await deps.ragClient.getByIds(refs);
      for (const ref of refs) { const chunk = chunks.find((item) => item.id === ref.id); if (!chunk || !chunk.published) return fail("RAG_CHUNK_NOT_FOUND", 409); if (chunk.version !== ref.version) return fail("RAG_CHUNK_VERSION_DRIFT", 409); }
      const images = await deps.repository.getInputImages(suite.id);
      if (images.length < 1 || images.length > 6) return fail("INVALID_INPUT_IMAGE");
      const visionImages = [];
      for (const image of images) { let key = image.originalObjectKey; let source = await deps.storage.get(key); if (image.currentBaseVersionId) { const base = await deps.repository.getBaseImageVersion(suite.id, image.id, image.currentBaseVersionId); if (base) { key = base.objectKey; source = await deps.storage.get(key); } } if (!source) return fail("PLAN_INPUT_IMAGE_NOT_FOUND", 409); visionImages.push({ id: image.id, sourceKind: image.currentBaseVersionId ? "base" as const : "original" as const, sourceVersionId: image.currentBaseVersionId, mimeType: source.contentType, bytes: source.bytes }); }
      const createdAt = new Date().toISOString();
      const attempt: PlanAttempt = { id: randomUUID(), suiteId: suite.id, idempotencyKey, status: "running", templateVersionId, dynamicInput: validated.value, humanInput, selectedChunks: refs, inputImageIds: images.map((item) => item.id), baseVersionIds: images.flatMap((item) => item.currentBaseVersionId ? [item.currentBaseVersionId] : []), provider: { name: deps.llmClient.provider, model: deps.llmClient.model, isFake: deps.llmClient.isFake }, errorCode: null, errorMessage: null, outputSummary: null, snapshotId: null, createdAt, completedAt: null };
      const reservation = await deps.planRepository.beginAttempt(attempt);
      if (reservation.duplicate) return ok({ attemptId: reservation.attempt.id, status: reservation.attempt.status }, reservation.attempt.status === "running" ? 202 : 200);
      void (async () => {
        try {
          const raw = await deps.llmClient!.generatePlan({ requestId: attempt.id, templateVersionId, templateBody: template.body, userPromptTemplate: template.userPromptTemplate, dynamicInput: validated.value, humanInput, chunks, inputImageIds: attempt.inputImageIds, baseVersionIds: attempt.baseVersionIds, visionImages, platformProfile: platformProfile ?? undefined });
          const output = normalizeStructureOutput(raw);
          if (!output) { await deps.planRepository!.failAttempt(attempt.id, "LLM_OUTPUT_SCHEMA_INVALID", errorMessages.LLM_OUTPUT_SCHEMA_INVALID, summarizeOutput(raw)); return; }
          const supplementRef = designerFactsText(validated.value) ? ["human_supplement"] : [];
          let validationError: string | null = null; try { validationError = validateStructureOutput(output, { ...validated.value, selected_detail_categories: JSON.parse(String(validated.value.selected_detail_categories)), category_requirements: JSON.parse(String(validated.value.category_requirements)) }, attempt.inputImageIds, [...chunks.map((chunk) => chunk.id), ...supplementRef]); } catch { validationError = "input_json"; }
           if (validationError) { await deps.planRepository!.failAttempt(attempt.id, "STRUCTURE_PLAN_INVALID", errorMessages.STRUCTURE_PLAN_INVALID, summarizeOutput(raw, { validationError })); return; }
          const latest = await deps.planRepository!.getLatestSnapshot(suite.id);
          const snapshot: PlanSnapshot = { id: randomUUID(), suiteId: suite.id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, revisionKind: "llm", parentSnapshotId: latest?.id ?? null, templateVersionId, dynamicInput: validated.value, humanInput, chunks: chunks.map((chunk) => ({ sourceChunkId: chunk.id, sourceVersion: chunk.version, title: chunk.title, content: chunk.content, fieldValues: chunk.fieldValues, sourceKind: chunk.sourceKind, sourceAssetPaths: chunk.sourceAssetPaths, contentSha256: chunk.contentSha256 })), inputImageIds: attempt.inputImageIds, baseVersionIds: attempt.baseVersionIds, provider: attempt.provider, requestSummary: { phase: "structure_plan", templateVersionId }, rawOutputSummary: summarizeOutput(raw), schemaVersion: output.schemaVersion, items: [], phase: "structure_plan", confirmationStatus: "draft", confirmedAt: null, structure: { status: output.status, mainAllocation: output.mainAllocation, detailImageCount: output.detailImageCount, categoryAllocations: output.categoryAllocations, globalStyleCard: output.globalStyleCard }, createdAt: new Date().toISOString() };
          await deps.planRepository!.completeAttempt(attempt.id, snapshot);
        } catch (error) { await deps.planRepository!.failAttempt(attempt.id, error instanceof Error && error.message === "LLM_TIMEOUT" ? "LLM_TIMEOUT" : "LLM_PROVIDER_FAILED", error instanceof Error && error.message === "LLM_TIMEOUT" ? errorMessages.LLM_TIMEOUT : errorMessages.LLM_PROVIDER_FAILED).catch(() => undefined); }
      })();
      return ok({ attemptId: attempt.id, status: "running" }, 202);
    }
    const structureConfirmMatch = path.match(/^\/api\/suites\/([^/]+)\/structure-plan\/confirm$/);
    if (method === "POST" && structureConfirmMatch) {
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const latest = await deps.planRepository.getLatestSnapshot(structureConfirmMatch[1]);
      if (!latest || latest.phase !== "structure_plan" || latest.schemaVersion !== "suite-structure-plan-v2" || !isStructurePlanV2(latest.structure)) return fail("INVALID_PLAN_SNAPSHOT", 409);
      // Confirmation is terminal for a snapshot. Repeated clicks must reuse the
      // already-confirmed immutable snapshot instead of inserting its plan items again.
      if (latest.confirmationStatus === "confirmed") return ok(planSnapshotView(latest));
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const requestedStructure = body.structure && typeof body.structure === "object" && !Array.isArray(body.structure) ? body.structure as Record<string, unknown> : {};
      const structure = {
        ...latest.structure,
        ...requestedStructure,
        categoryAllocations: Array.isArray(requestedStructure.categoryAllocations) ? requestedStructure.categoryAllocations : latest.structure.categoryAllocations,
        globalStyleCard: requestedStructure.globalStyleCard && typeof requestedStructure.globalStyleCard === "object" && !Array.isArray(requestedStructure.globalStyleCard) ? requestedStructure.globalStyleCard as Record<string, unknown> : latest.structure.globalStyleCard,
      };
      const candidate = normalizeStructureOutput({ ...structure, schemaVersion: "suite-structure-plan-v2" });
      if (!candidate) return fail("STRUCTURE_PLAN_INVALID", 409);
      const allocations = candidate.categoryAllocations;
      const selectedCategories = allocations.map((value) => value.category);
      const categoryRequirements = Object.fromEntries(allocations.map((value) => [value.category, value.requirement]));
      const supplementRef = designerFactsText(latest.dynamicInput) ? ["human_supplement"] : [];
      const validationError = validateStructureOutput(candidate, { ...latest.dynamicInput, selected_detail_categories: selectedCategories, category_requirements: categoryRequirements }, latest.inputImageIds, [...latest.chunks.map((chunk) => chunk.sourceChunkId), ...supplementRef]);
      if (validationError) return fail("STRUCTURE_PLAN_INVALID", 409);
      if (candidate.status !== "READY_FOR_REVIEW" || candidate.mainAllocation.missingFacts.length > 0 || candidate.categoryAllocations.some((row) => row.count > 0 && row.missingFacts.length > 0)) return fail("STRUCTURE_PLAN_NEEDS_INPUT", 409);
      const { schemaVersion: _schemaVersion, ...confirmedStructure } = candidate;
      const next: PlanSnapshot = { ...latest, id: randomUUID(), revisionNumber: latest.revisionNumber + 1, revisionKind: "human", parentSnapshotId: latest.id, confirmationStatus: "confirmed", confirmedAt: new Date().toISOString(), structure: confirmedStructure, createdAt: new Date().toISOString() };
      return ok(planSnapshotView(await appendConfirmedSnapshot(next)));
    }

    const categoryRequestMatch = path.match(/^\/api\/category-prompt-requests\/([^/]+)$/);
    if (method === "GET" && categoryRequestMatch) {
      const request = await categoryPromptRepository.getRequest(categoryRequestMatch[1]);
      return request ? ok(categoryRequestView(request)) : fail("INVALID_CATEGORY_PROMPT_REQUEST", 404);
    }

    const categoryPromptsMatch = path.match(/^\/api\/suites\/([^/]+)(?:\/plan)?\/category-prompts$/);
    if (method === "GET" && categoryPromptsMatch) {
      const suiteId = categoryPromptsMatch[1];
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const snapshot = await deps.planRepository.getLatestSnapshot(suiteId);
      if (!snapshot || snapshot.phase !== "structure_plan" || snapshot.confirmationStatus !== "confirmed") return ok({ planSnapshotId: snapshot?.id ?? null, status: "not_ready", requests: [] });
      const requests = await listCategoryRequestsForSnapshot(snapshot);
      const expectedRequestCount = categoryAllocationsForSnapshot(snapshot).length;
      const status = requests.length < expectedRequestCount || requests.some((request) => request.status === "running") ? "running" : requests.some((request) => request.status === "failed") ? "partial" : requests.length ? "succeeded" : "pending";
      return ok({ planSnapshotId: snapshot.id, status, expectedRequestCount, requests: requests.map(categoryRequestView) });
    }
    if (method === "POST" && categoryPromptsMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      if (!deps.llmClient) return fail("CATEGORY_PROMPT_LLM_NOT_CONFIGURED", 503);
      const suite = await deps.repository.getSuite(categoryPromptsMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const body = options.body && typeof options.body === "object" && !Array.isArray(options.body) ? options.body as Record<string, unknown> : {};
       const snapshotId = typeof body.planSnapshotId === "string" ? body.planSnapshotId : undefined;
       const requestedSnapshot = snapshotId ? await deps.planRepository.getSnapshot(snapshotId) : await deps.planRepository.getLatestSnapshot(suite.id);
       const snapshot = requestedSnapshot ? await resolveCategorySourceSnapshot(requestedSnapshot) : null;
       if (!snapshot || snapshot.suiteId !== suite.id || snapshot.phase !== "structure_plan" || snapshot.confirmationStatus !== "confirmed" || !isStructurePlanV2(snapshot.structure) || snapshot.structure.status !== "READY_FOR_REVIEW") return fail("CATEGORY_PROMPT_NOT_CONFIRMED", 409);
       const allocations = categoryAllocationsForSnapshot(snapshot);
      if (!allocations.length) return fail("STRUCTURE_PLAN_INVALID", 409);
      const templateVersionId = typeof body.templateVersionId === "string" ? body.templateVersionId : "";
      let template = templateVersionId ? await deps.promptRepository.getPublishedVersion(templateVersionId, "category_prompt") : null;
      if (!template) {
        const [published] = await deps.promptRepository.listPublished("category_prompt");
        template = published ? await deps.promptRepository.getPublishedVersion(published.templateVersionId, "category_prompt") : null;
      }
      if (!template) return fail("CATEGORY_PROMPT_TEMPLATE_NOT_FOUND", 404);
       const humanInput = snapshot.humanInput;
      const platformValue = typeof snapshot.dynamicInput.platform === "string" ? snapshot.dynamicInput.platform.trim() : "";
      const platformProfile = platformValue && deps.platformRepository ? await deps.platformRepository.find(platformValue) : null;
      if (platformValue && deps.platformRepository && !platformProfile) return fail("PLATFORM_NOT_FOUND");
      const run = async () => {
        for (const entry of allocations) {
          const dynamicInput = categoryPlanInput(snapshot, entry.categoryCode, entry.requestedCount, entry.allocation);
           const approvedFactRefs = entry.allocation && Array.isArray(entry.allocation.factRefs) ? entry.allocation.factRefs.map(String) : [];
          const requestKey = `${idempotencyKey}:${snapshot.id}:${entry.categoryCode}`;
          const request: CategoryPromptRequest = {
            id: randomUUID(), suiteId: suite.id, planSnapshotId: snapshot.id, categoryCode: entry.categoryCode, requestedCount: entry.requestedCount, status: "running", idempotencyKey: requestKey, retryOfRequestId: null,
            templateVersionId: template!.templateVersionId, dynamicInput, humanInput, approvedFactRefs, inputImageIds: snapshot.inputImageIds, baseVersionIds: snapshot.baseVersionIds,
            provider: { name: deps.llmClient!.provider, model: deps.llmClient!.model, isFake: deps.llmClient!.isFake }, requestSummary: { phase: "category_prompt", categoryCode: entry.categoryCode, requestedCount: entry.requestedCount, planSnapshotId: snapshot.id, templateVersionId: template!.templateVersionId }, responseSummary: null, items: [], errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), completedAt: null,
          };
          const reservation = await categoryPromptRepository.beginRequest(request);
          if (reservation.duplicate && reservation.request.status !== "running") continue;
          if (reservation.duplicate) continue;
          try {
             const chunks = snapshot.chunks.filter((chunk) => approvedFactRefs.includes(chunk.sourceChunkId)).map((chunk) => ({ id: chunk.sourceChunkId, version: chunk.sourceVersion, title: chunk.title, summary: chunk.title, content: chunk.content, fieldValues: chunk.fieldValues, sourceKind: chunk.sourceKind, sourceAssetPaths: chunk.sourceAssetPaths, contentSha256: chunk.contentSha256, published: true }));
            const visionImages = await loadCategoryVisionImages(suite.id, snapshot, entry.allocation);
            const llmInput: CategoryPromptLlmInput = { requestId: request.id, templateVersionId: template!.templateVersionId, templateBody: template!.body, userPromptTemplate: template!.userPromptTemplate, dynamicInput, humanInput, chunks, inputImageIds: visionImages.map((image) => image.id), baseVersionIds: snapshot.baseVersionIds, visionImages, platformProfile: platformProfile ?? undefined, categoryCode: entry.categoryCode, requestedCount: entry.requestedCount, approvedFactRefs };
            if (!deps.llmClient!.generateCategoryPrompt) throw new Error("CATEGORY_PROMPT_LLM_NOT_CONFIGURED");
            const raw = await deps.llmClient!.generateCategoryPrompt(llmInput);
            const output = normalizeCategoryPromptOutput(raw);
            const summary = summarizeOutput(raw);
            if (!output || output.category !== entry.categoryCode) { await categoryPromptRepository.failRequest(request.id, "CATEGORY_PROMPT_INVALID", errorMessages.CATEGORY_PROMPT_INVALID, summary); continue; }
            if (output.items.length !== entry.requestedCount) { await categoryPromptRepository.failRequest(request.id, "CATEGORY_PROMPT_COUNT_MISMATCH", errorMessages.CATEGORY_PROMPT_COUNT_MISMATCH, summary); continue; }
            const allowedReferenceImageIds = entry.allocation && Array.isArray(entry.allocation.sourceImageIds) ? entry.allocation.sourceImageIds.map(String) : snapshot.inputImageIds;
            const stableIds = new Set<string>();
            const invalid = output.items.some((item) => stableIds.has(item.stableId) || (stableIds.add(item.stableId), item.category !== entry.categoryCode || item.referenceImageIds.some((id) => !allowedReferenceImageIds.includes(id)) || item.factRefs.some((ref) => !approvedFactRefs.includes(ref))));
            if (invalid) { await categoryPromptRepository.failRequest(request.id, "CATEGORY_PROMPT_INVALID", errorMessages.CATEGORY_PROMPT_INVALID, summary); continue; }
            await categoryPromptRepository.completeRequest(request.id, output.items, summary);
          } catch (error) {
            const code = error instanceof Error && error.message === "CATEGORY_PROMPT_LLM_NOT_CONFIGURED" ? "CATEGORY_PROMPT_LLM_NOT_CONFIGURED" : error instanceof Error && error.message === "LLM_TIMEOUT" ? "LLM_TIMEOUT" : error instanceof Error && error.message === "PLAN_INPUT_IMAGE_NOT_FOUND" ? "PLAN_INPUT_IMAGE_NOT_FOUND" : "CATEGORY_PROMPT_FAILED";
            await categoryPromptRepository.failRequest(request.id, code, errorMessages[code] ?? errorMessages.CATEGORY_PROMPT_FAILED).catch(() => undefined);
          }
        }
      };
      void run().catch(() => undefined);
      return ok({ planSnapshotId: snapshot.id, status: "running", categories: allocations.map((entry) => ({ categoryCode: entry.categoryCode, requestedCount: entry.requestedCount })) }, 202);
    }

    const categoryRetryMatch = path.match(/^\/api\/suites\/([^/]+)(?:\/plan)?\/category-prompts\/([^/]+)\/retry$/);
    if (method === "POST" && categoryRetryMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.planRepository || !deps.promptRepository || !deps.llmClient) return fail("CATEGORY_PROMPT_LLM_NOT_CONFIGURED", 503);
      const suite = await deps.repository.getSuite(categoryRetryMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const snapshot = await deps.planRepository.getLatestSnapshot(suite.id);
      if (!snapshot || snapshot.confirmationStatus !== "confirmed" || snapshot.phase !== "structure_plan" || !snapshot.structure) return fail("CATEGORY_PROMPT_NOT_CONFIRMED", 409);
      const categoryRequests = await categoryPromptRepository.listRequests(snapshot.id);
      const previous = categoryRequests.find((request) => request.id === categoryRetryMatch[2]) ?? categoryRequests.filter((request) => request.categoryCode === categoryRetryMatch[2]).at(-1);
      if (!previous || previous.status !== "failed") return fail("INVALID_CATEGORY_PROMPT_REQUEST", 404);
      const body = options.body && typeof options.body === "object" && !Array.isArray(options.body) ? options.body as Record<string, unknown> : {};
      const templateVersionId = typeof body.templateVersionId === "string" ? body.templateVersionId : previous.templateVersionId;
      const template = await observedPromptLoad(deps.promptRepository, templateVersionId, "category_prompt");
      if (!template) return fail("CATEGORY_PROMPT_TEMPLATE_NOT_FOUND", 404);
      const platformValue = typeof snapshot.dynamicInput.platform === "string" ? snapshot.dynamicInput.platform.trim() : "";
      const platformProfile = platformValue && deps.platformRepository ? await deps.platformRepository.find(platformValue) : null;
      if (platformValue && deps.platformRepository && !platformProfile) return fail("PLATFORM_NOT_FOUND");
      const allocation = previous.categoryCode === "main" && isStructurePlanV2(snapshot.structure)
        ? snapshot.structure.mainAllocation as unknown as Record<string, unknown>
        : snapshot.structure.categoryAllocations.map((item) => item as Record<string, unknown>).find((item) => String(item.category) === previous.categoryCode) ?? null;
      const dynamicInput = categoryPlanInput(snapshot, previous.categoryCode, previous.requestedCount, allocation);
      const retryRequest: CategoryPromptRequest = { ...previous, id: randomUUID(), status: "running", idempotencyKey: `${idempotencyKey}:${snapshot.id}:${previous.categoryCode}:retry`, retryOfRequestId: previous.id, templateVersionId: template.templateVersionId, dynamicInput, requestSummary: { ...previous.requestSummary, retryOfRequestId: previous.id }, responseSummary: null, items: [], errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), completedAt: null };
      const reservation = await categoryPromptRepository.beginRequest(retryRequest);
      if (reservation.duplicate) return ok(categoryRequestView(reservation.request), reservation.request.status === "running" ? 202 : 200);
      void (async () => {
        try {
          const approvedFactRefs = retryRequest.approvedFactRefs;
          const chunks = snapshot.chunks.filter((chunk) => approvedFactRefs.includes(chunk.sourceChunkId)).map((chunk) => ({ id: chunk.sourceChunkId, version: chunk.sourceVersion, title: chunk.title, summary: chunk.title, content: chunk.content, fieldValues: chunk.fieldValues, sourceKind: chunk.sourceKind, sourceAssetPaths: chunk.sourceAssetPaths, contentSha256: chunk.contentSha256, published: true }));
          const visionImages = await loadCategoryVisionImages(suite.id, snapshot, allocation);
          if (!deps.llmClient!.generateCategoryPrompt) throw new Error("CATEGORY_PROMPT_LLM_NOT_CONFIGURED");
          const raw = await deps.llmClient!.generateCategoryPrompt({ requestId: retryRequest.id, templateVersionId: template.templateVersionId, templateBody: template.body, userPromptTemplate: template.userPromptTemplate, dynamicInput, humanInput: retryRequest.humanInput, chunks, inputImageIds: visionImages.map((image) => image.id), baseVersionIds: snapshot.baseVersionIds, visionImages, platformProfile: platformProfile ?? undefined, categoryCode: retryRequest.categoryCode, requestedCount: retryRequest.requestedCount, approvedFactRefs });
          const output = normalizeCategoryPromptOutput(raw);
          const summary = summarizeOutput(raw);
          if (!output || output.category !== retryRequest.categoryCode) { await categoryPromptRepository.failRequest(retryRequest.id, "CATEGORY_PROMPT_INVALID", errorMessages.CATEGORY_PROMPT_INVALID, summary); return; }
          if (output.items.length !== retryRequest.requestedCount) { await categoryPromptRepository.failRequest(retryRequest.id, "CATEGORY_PROMPT_COUNT_MISMATCH", errorMessages.CATEGORY_PROMPT_COUNT_MISMATCH, summary); return; }
          const allowedReferenceImageIds = allocation && Array.isArray(allocation.sourceImageIds) ? allocation.sourceImageIds.map(String) : snapshot.inputImageIds;
          const stableIds = new Set<string>();
          if (output.items.some((item) => stableIds.has(item.stableId) || (stableIds.add(item.stableId), item.category !== retryRequest.categoryCode || item.referenceImageIds.some((id) => !allowedReferenceImageIds.includes(id)) || item.factRefs.some((ref) => !approvedFactRefs.includes(ref))))) { await categoryPromptRepository.failRequest(retryRequest.id, "CATEGORY_PROMPT_INVALID", errorMessages.CATEGORY_PROMPT_INVALID, summary); return; }
          await categoryPromptRepository.completeRequest(retryRequest.id, output.items, summary);
        } catch (error) { const code = error instanceof Error && error.message === "LLM_TIMEOUT" ? "LLM_TIMEOUT" : "CATEGORY_PROMPT_FAILED"; await categoryPromptRepository.failRequest(retryRequest.id, code, errorMessages[code] ?? errorMessages.CATEGORY_PROMPT_FAILED).catch(() => undefined); }
      })();
      return ok(categoryRequestView(retryRequest), 202);
    }

    const planMatch = path.match(/^\/api\/suites\/([^/]+)\/plan$/);
    if (method === "GET" && planMatch) {
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const [attempt, snapshot] = await Promise.all([deps.planRepository.getLatestAttempt(planMatch[1]), deps.planRepository.getLatestSnapshot(planMatch[1])]);
      return ok({ attempt: attempt ? planAttemptView(attempt, attempt.snapshotId === snapshot?.id ? snapshot : null) : null, snapshot: snapshot ? planSnapshotView(snapshot) : null });
    }
    if (method === "POST" && planMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      if (!deps.ragClient) return fail("RAG_NOT_CONFIGURED", 503);
      if (!deps.llmClient) return fail("LLM_NOT_CONFIGURED", 503);
      const suite = await deps.repository.getSuite(planMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const body = options.body && typeof options.body === "object" && !Array.isArray(options.body) ? options.body as Record<string, unknown> : {};
      const templateVersionId = typeof body.templateVersionId === "string" ? body.templateVersionId : "";
      const template = await observedPromptLoad(deps.promptRepository, templateVersionId, "plan");
      if (!template) return fail("PLAN_TEMPLATE_NOT_FOUND", 404);
      const validated = validateDynamicInput(template.inputSchema, body.dynamicInput);
      if (!validated.ok) return fail("PROMPT_INPUT_INVALID", 400, validated.message);
      const platformValue = typeof validated.value.platform === "string" ? validated.value.platform.trim() : "";
      const platformProfile = platformValue && deps.platformRepository ? await deps.platformRepository.find(platformValue) : null;
      if (platformValue && deps.platformRepository && !platformProfile) return fail("PLATFORM_NOT_FOUND");
      const humanInput = body.humanInput && typeof body.humanInput === "object" && !Array.isArray(body.humanInput) ? body.humanInput as Record<string, unknown> : {};
      const refs = Array.isArray(body.selectedChunks) ? body.selectedChunks.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).version === "string" ? [{ id: (item as { id: string }).id, version: (item as { version: string }).version }] : []) : [];
      const chunks = await deps.ragClient.getByIds(refs);
      for (const ref of refs) {
        const chunk = chunks.find((item) => item.id === ref.id);
        if (!chunk || !chunk.published) return fail("RAG_CHUNK_NOT_FOUND", 409);
        if (chunk.version !== ref.version) return fail("RAG_CHUNK_VERSION_DRIFT", 409);
      }
      const images = await deps.repository.getInputImages(suite.id);
      const visionImages = [];
      for (const image of images) {
        let sourceKind: "base" | "original" = "original";
        let sourceVersionId: string | null = null;
        let sourceObjectKey = image.originalObjectKey;
        let source = null;
        if (image.currentBaseVersionId) {
          const base = await deps.repository.getBaseImageVersion(suite.id, image.id, image.currentBaseVersionId);
          if (base) { sourceKind = "base"; sourceVersionId = base.id; sourceObjectKey = base.objectKey; }
        }
        if (sourceKind === "original") {
          const generationInputKey = image.originalObjectKey.replace(/\/original$/, "/generation-input.jpg");
          if (generationInputKey !== image.originalObjectKey) source = await deps.storage.get(generationInputKey);
          if (source) sourceObjectKey = generationInputKey;
        }
        source ??= await deps.storage.get(sourceObjectKey);
        if (!source) return fail("PLAN_INPUT_IMAGE_NOT_FOUND", 409);
        visionImages.push({ id: image.id, sourceKind, sourceVersionId, mimeType: source.contentType, bytes: source.bytes });
      }
      const createdAt = new Date().toISOString();
      const attempt: PlanAttempt = { id: randomUUID(), suiteId: suite.id, idempotencyKey, status: "running", templateVersionId, dynamicInput: validated.value, humanInput, selectedChunks: refs, inputImageIds: images.map((item) => item.id), baseVersionIds: images.flatMap((item) => item.currentBaseVersionId ? [item.currentBaseVersionId] : []), provider: { name: deps.llmClient.provider, model: deps.llmClient.model, isFake: deps.llmClient.isFake }, errorCode: null, errorMessage: null, outputSummary: null, snapshotId: null, createdAt, completedAt: null };
      const reservation = await deps.planRepository.beginAttempt(attempt);
      if (reservation.duplicate) return ok({ attemptId: reservation.attempt.id, status: reservation.attempt.status }, reservation.attempt.status === "running" ? 202 : 200);
      void (async () => {
        let raw: unknown;
        try { raw = await deps.llmClient!.generatePlan({ requestId: attempt.id, templateVersionId, templateBody: template.body, userPromptTemplate: template.userPromptTemplate, dynamicInput: validated.value, humanInput, chunks, inputImageIds: attempt.inputImageIds, baseVersionIds: attempt.baseVersionIds, visionImages, platformProfile: platformProfile ?? undefined }); }
        catch (error) { const code = error instanceof Error && error.message === "LLM_TIMEOUT" ? "LLM_TIMEOUT" : "LLM_PROVIDER_FAILED"; await deps.planRepository!.failAttempt(attempt.id, code, errorMessages[code]); return; }
        const normalizedOutput = normalizePlanOutput(raw);
        if (!normalizedOutput || !validPlanOutput(normalizedOutput, template.outputSchema)) { await deps.planRepository!.failAttempt(attempt.id, "LLM_OUTPUT_SCHEMA_INVALID", errorMessages.LLM_OUTPUT_SCHEMA_INVALID, summarizeOutput(raw)); return; }
        if (!planOutputMatchesRequestedCounts(normalizedOutput, validated.value)) { await deps.planRepository!.failAttempt(attempt.id, "LLM_OUTPUT_COUNT_MISMATCH", errorMessages.LLM_OUTPUT_COUNT_MISMATCH, summarizeOutput(raw)); return; }
        const latest = await deps.planRepository!.getLatestSnapshot(suite.id);
        const output = normalizedOutput;
        const snapshot: PlanSnapshot = { id: randomUUID(), suiteId: suite.id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, revisionKind: "llm", parentSnapshotId: latest?.id ?? null, templateVersionId, dynamicInput: validated.value, humanInput, chunks: chunks.map((chunk) => ({ sourceChunkId: chunk.id, sourceVersion: chunk.version, title: chunk.title, content: chunk.content, fieldValues: chunk.fieldValues, sourceKind: chunk.sourceKind, sourceAssetPaths: chunk.sourceAssetPaths, contentSha256: chunk.contentSha256 })), inputImageIds: attempt.inputImageIds, baseVersionIds: attempt.baseVersionIds, provider: attempt.provider, requestSummary: { dynamicFieldCount: Object.keys(validated.value).length, chunkCount: chunks.length, inputImageCount: attempt.inputImageIds.length, templateVersionId }, rawOutputSummary: summarizeOutput(raw), schemaVersion: output.schemaVersion, items: output.items.map((item, index) => ({ id: randomUUID(), ordinal: index + 1, imageType: item.imageType ?? "main", title: item.title, purpose: item.purpose, prompt: item.prompt })), createdAt: new Date().toISOString() };
        await deps.planRepository!.completeAttempt(attempt.id, snapshot);
      })().catch((error) => deps.planRepository!.failAttempt(attempt.id, error instanceof Error && error.message === "LLM_TIMEOUT" ? "LLM_TIMEOUT" : "LLM_PROVIDER_FAILED", error instanceof Error && error.message === "LLM_TIMEOUT" ? errorMessages.LLM_TIMEOUT : errorMessages.LLM_PROVIDER_FAILED).catch(() => undefined));
      return ok({ attemptId: attempt.id, status: "running" }, 202);
    }
    if (method === "PATCH" && planMatch) {
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const latest = await deps.planRepository.getLatestSnapshot(planMatch[1]);
      if (!latest) return fail("INVALID_PLAN_SNAPSHOT", 404);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      if (!Array.isArray(body.items) || !validPlanOutput({ schemaVersion: "suite-plan-v1", items: body.items }, { items: { properties: { imageType: {} } } })) return fail("LLM_OUTPUT_SCHEMA_INVALID");
      const items = body.items as Array<{ imageType?: "main" | "detail"; title:string;purpose:string;prompt:string }>;
      const snapshot: PlanSnapshot = { ...latest, id: randomUUID(), revisionNumber: latest.revisionNumber + 1, revisionKind: "human", parentSnapshotId: latest.id, items: items.map((item,index)=>({id:randomUUID(),ordinal:index+1,imageType:item.imageType ?? "main",title:item.title,purpose:item.purpose,prompt:item.prompt})), createdAt:new Date().toISOString() };
      return ok(planSnapshotView(await deps.planRepository.appendRevision(snapshot)));
    }
    const startCheckMatch = path.match(/^\/api\/suites\/([^/]+)\/start-creation-check$/);
    if (method === "POST" && startCheckMatch) {
      if (!deps.planRepository) return fail("PLAN_REPOSITORY_NOT_CONFIGURED", 503);
      const [images,snapshot] = await Promise.all([deps.repository.getInputImages(startCheckMatch[1]),deps.planRepository.getLatestSnapshot(startCheckMatch[1])]);
      if (!images.length) return fail("INVALID_INPUT_IMAGE");
      if (images.some((image)=>!image.currentBaseVersionId)) return fail("BASE_IMAGE_REQUIRED");
      if (!snapshot) return fail("INVALID_PLAN_SNAPSHOT");
       if (snapshot.phase === "structure_plan" && snapshot.confirmationStatus === "confirmed") {
         const items = materializeCategoryPlanItems(snapshot, await listCategoryRequestsForSnapshot(snapshot));
         if (!items) return fail("CATEGORY_PROMPTS_NOT_READY", 409);
         return ok({ ready: true, planSnapshotId: snapshot.id, itemCount: items.length });
       }
       if (!snapshot.items.length) return fail("INVALID_PLAN_SNAPSHOT");
       return ok({ ready:true,planSnapshotId:snapshot.id,itemCount:snapshot.items.length });
    }

    const workbenchMatch = path.match(/^\/api\/suites\/([^/]+)\/workbench$/);
    if (method === "GET" && workbenchMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const suite = await deps.repository.getSuite(workbenchMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const [inputImages, snapshot, tasks, batches, slots] = await Promise.all([
        deps.repository.getInputImages(suite.id),
        deps.planRepository?.getLatestSnapshot(suite.id) ?? Promise.resolve(null),
        deps.taskRepository.listTasks(suite.id),
        deps.taskRepository.listBatches(suite.id),
        deps.taskRepository.listSlots(suite.id),
      ]);
      const taskAggregates = await Promise.all(tasks.map(async (task) => {
        const history = await deps.taskRepository!.listTaskVersions(task.id);
        return { ...taskView(task), versions: history.versions.map(taskVersionView), attempts: history.attempts.map(taskAttemptView), slots: slots.filter((slot) => slot.taskId === task.id).map(taskSlotView) };
      }));
      const imageEditChildren = deps.imageEditorApi ? await (async () => {
        const response = await deps.imageEditorApi!.request("GET", "/api/image-editor/tasks");
        if (response.status !== 200 || !("data" in response.body) || !Array.isArray(response.body.data)) return [];
        const all = response.body.data as Array<{ task?: { id?: string; sourceCardId?: string } }>;
        const allowed = new Set(tasks.map((task) => task.id));
        let changed = true;
        while (changed) {
          changed = false;
          for (const child of all) {
            const task = child.task;
            if (task?.id && task.sourceCardId && allowed.has(task.sourceCardId) && !allowed.has(task.id)) {
              allowed.add(task.id);
              changed = true;
            }
          }
        }
        return all.filter((child) => child.task?.id && allowed.has(child.task.id));
      })() : [];
      const layout = await deps.taskRepository.getLayout(suite.id);
      return ok({ suite, inputImages, planSnapshot: snapshot ? planSnapshotView(snapshot) : null, tasks: taskAggregates, batches: batches.map(taskBatchView), imageEditChildren, layout });
    }

    const createTasksMatch = path.match(/^\/api\/suites\/([^/]+)\/tasks$/);
    if (method === "POST" && createTasksMatch) {
      if (!deps.taskRepository || !deps.planRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const suite = await deps.repository.getSuite(createTasksMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const snapshotId = typeof body.planSnapshotId === "string" ? body.planSnapshotId : undefined;
      let snapshot = snapshotId ? await deps.planRepository.getSnapshot(snapshotId) : await deps.planRepository.getLatestSnapshot(suite.id);
      if (!snapshot || snapshot.suiteId !== suite.id) return fail("INVALID_PLAN_SNAPSHOT", 409);
       if (snapshot.phase === "structure_plan" && snapshot.confirmationStatus === "confirmed") {
         const requests = await listCategoryRequestsForSnapshot(snapshot);
         const items = materializeCategoryPlanItems(snapshot, requests);
         if (!items) return fail("CATEGORY_PROMPTS_NOT_READY", 409);
         if (!samePlanItems(snapshot.items, items)) {
           const sourceSnapshot = await resolveCategorySourceSnapshot(snapshot);
           const next: PlanSnapshot = { ...snapshot, id: randomUUID(), revisionNumber: snapshot.revisionNumber + 1, revisionKind: "human", parentSnapshotId: snapshot.id, items, categoryOutputs: Object.fromEntries(requests.map((request) => [request.categoryCode, { status: request.status, requestedCount: request.requestedCount, items: request.items as unknown as Record<string, unknown>[], errorCode: request.errorCode, errorMessage: request.errorMessage }])), requestSummary: { ...snapshot.requestSummary, phase: "task_materialization", sourceSnapshotId: sourceSnapshot.id }, createdAt: new Date().toISOString() };
            snapshot = await appendMaterializedSnapshot(next, items);
         }
       }
      if (!snapshot.items.length) return fail("INVALID_PLAN_SNAPSHOT", 409);
      const result = await deps.taskRepository.createTasksFromSnapshot(suite.id, snapshot, await deps.repository.getInputImages(suite.id));
      return ok({ planSnapshotId: snapshot.id, tasks: result.tasks, createdTaskIds: result.created.map((task) => task.id) }, result.created.length ? 201 : 200);
    }

    const updateTaskMatch = path.match(/^\/api\/suite-tasks\/([^/]+)$/);
    if (method === "PATCH" && updateTaskMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const patch: Record<string, unknown> = {};
      for (const key of ["title", "purpose", "promptDraft", "sourceInputImageId", "status"] as const) if (typeof body[key] === "string") patch[key] = body[key];
      if (body.generationParams && typeof body.generationParams === "object" && !Array.isArray(body.generationParams)) patch.generationParams = body.generationParams;
      const task = await deps.taskRepository.updateTask(updateTaskMatch[1], patch as never);
      return task ? ok(task) : fail("INVALID_SUITE_TASK", 404);
    }

    const whiteResourceMatch = path.match(/^\/api\/suite-tasks\/([^/]+)\/white-resource$/);
    if (method === "POST" && whiteResourceMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.taskRepository || !deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
      const task = await deps.taskRepository.getTask(whiteResourceMatch[1]); if (!task) return fail("INVALID_SUITE_TASK", 404);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const resourceIds = Array.isArray(body.resourceIds) ? body.resourceIds.filter((item): item is string => typeof item === "string") : typeof body.resourceId === "string" ? [body.resourceId] : [];
      if (!resourceIds.length) return fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
      if (resourceIds.length > 3) return fail("REVERSE_WHITE_RESOURCE_LIMIT", 409);
      const resources = await Promise.all(resourceIds.map((id) => deps.libraryRepository!.getResource(id)));
      if (resources.some((resource) => !resource)) return fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
      if (resources.some((resource) => resource!.resourceType !== "base_image" || resource!.status !== "published")) return fail("LIBRARY_RESOURCE_FORBIDDEN", 403);
      try {
        const existing = await deps.libraryRepository.listReferences(task.suiteId, "task", task.id);
        const references = [];
        for (const [index, resource] of resources.entries()) {
          const result = await deps.libraryRepository.createReference({ suiteId: task.suiteId, resourceId: resource!.id, targetType: "task", targetId: task.id, idempotencyKey: `${idempotencyKey}:${resource!.id}` });
          references.push(result.reference);
          const source = result.reference.snapshot.source as Record<string, unknown> | undefined;
          if (typeof source?.objectKey !== "string") throw new Error("LIBRARY_RESOURCE_NOT_FOUND");
          (result.reference as typeof result.reference & { order?: number }).order = index + 1;
        }
        for (const stale of existing.filter((reference) => reference.resourceType === "base_image" && !resourceIds.includes(reference.resourceId))) await deps.libraryRepository.archiveReference(task.suiteId, stale.id);
        const productMaterialRefs = references.map((reference, index) => ({ libraryReferenceId: reference.id, resourceId: reference.resourceId, resourceVersionId: reference.resourceVersionId, order: index + 1, title: String((reference.snapshot as Record<string, unknown>).title ?? "产品白底图"), previewUrl: typeof (reference.snapshot as Record<string, unknown>).previewUrl === "string" ? (reference.snapshot as Record<string, unknown>).previewUrl : `/api/library/resources/${encodeURIComponent(reference.resourceId)}/preview` }));
        const first = references[0];
        const updated = await deps.taskRepository.updateTask(task.id, { sourceLibraryReferenceId: first.id, sourceResourceVersionId: first.resourceVersionId, sourceRevision: (task.sourceRevision ?? 0) + 1, generationParams: { ...task.generationParams, productMaterialRefs } as Record<string, unknown>, status: "pending" });
        const duplicate = references.every((reference) => existing.some((item) => item.id === reference.id));
        return ok({ task: updated, references, reference: first, duplicate }, duplicate ? 200 : 201);
      } catch (error) { const code = error instanceof Error ? error.message : "LIBRARY_RESOURCE_FORBIDDEN"; return fail(code, code === "LIBRARY_RESOURCE_NOT_FOUND" ? 404 : 403); }
    }

    const layoutMatch = path.match(/^\/api\/suites\/([^/]+)\/workbench\/layout$/);
    if (method === "GET" && layoutMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      return ok(await deps.taskRepository.getLayout(layoutMatch[1]));
    }
    if (method === "PATCH" && layoutMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const expectedVersion = Number(body.layoutVersion ?? 0);
      const viewport = body.viewport && typeof body.viewport === "object" ? body.viewport as { x: number; y: number; zoom: number } : { x: 0, y: 0, zoom: 1 };
      const nodes = Array.isArray(body.nodes) ? body.nodes : [];
      const groups = Array.isArray(body.groups) ? body.groups : [];
      try { return ok(await deps.taskRepository.saveLayout(layoutMatch[1], expectedVersion, { viewport, nodes: nodes as never, groups: groups as never })); }
      catch (error) { return fail(error instanceof Error && error.message === "LAYOUT_VERSION_CONFLICT" ? "LAYOUT_VERSION_CONFLICT" : "GENERATION_PERSIST_FAILED", error instanceof Error && error.message === "LAYOUT_VERSION_CONFLICT" ? 409 : 500); }
    }

    const suiteGenerationMatch = path.match(/^\/api\/suites\/([^/]+)\/generation$/);
    if (method === "POST" && suiteGenerationMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const allTasks = await deps.taskRepository.listTasks(suiteGenerationMatch[1]);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const requested = Array.isArray(body.taskIds) ? body.taskIds.filter((id): id is string => typeof id === "string") : allTasks.filter((task) => task.status !== "archived").map((task) => task.id);
      const tasks = allTasks.filter((task) => requested.includes(task.id) && task.status !== "archived");
      if (!tasks.length) return fail("NO_TASKS_TO_GENERATE", 409);
      try { const result = await createTaskBatch(suiteGenerationMatch[1], tasks, "batch", idempotencyKey); return ok({ batchId: result.batch.id, status: result.batch.status, requestedCount: result.batch.requestedCount }, result.duplicate ? 200 : 202); }
      catch (error) { return fail(error instanceof Error ? error.message : "TASK_INVALID_SOURCE", 409); }
    }

    const taskGenerationMatch = path.match(/^\/api\/suite-tasks\/([^/]+)\/generation$/);
    if (method === "POST" && taskGenerationMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const task = await deps.taskRepository.getTask(taskGenerationMatch[1]);
      if (!task || task.status === "archived") return fail("INVALID_SUITE_TASK", 404);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      if (typeof body.promptDraft === "string") await deps.taskRepository.updateTask(task.id, { promptDraft: body.promptDraft });
      const current = await deps.taskRepository.getTask(task.id);
      try {
        const history = await deps.taskRepository.listTaskVersions(task.id);
        const currentVersion = history.versions.find((version) => version.isCurrent);
        const result = await createTaskBatch(task.suiteId, [current!], "single", idempotencyKey, undefined, currentVersion ? { [task.id]: currentVersion.id } : {});
        return ok({ batchId: result.batch.id, status: result.batch.status }, result.duplicate ? 200 : 202);
      }
      catch (error) { return fail(error instanceof Error ? error.message : "TASK_INVALID_SOURCE", 409); }
    }

    const retryMatch = path.match(/^\/api\/generation-attempts\/([^/]+)\/retry$/);
    if (method === "POST" && retryMatch) {
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const failed = await deps.taskRepository.getAttempt(retryMatch[1]);
      if (!failed || failed.status !== "failed") return fail("INVALID_TASK_ATTEMPT", 409);
      const slot = await deps.taskRepository.getSlot(failed.slotId); if (!slot) return fail("INVALID_TASK_BATCH", 404);
      const task = await deps.taskRepository.getTask(slot.taskId); if (!task) return fail("INVALID_SUITE_TASK", 404);
      try { const result = await createTaskBatch(task.suiteId, [task], "retry", idempotencyKey, slot.id); return ok({ batchId: result.batch.id, status: result.batch.status }, result.duplicate ? 200 : 202); }
      catch (error) { return fail(error instanceof Error ? error.message : "TASK_INVALID_SOURCE", 409); }
    }

    const batchStatusMatch = path.match(/^\/api\/generation-batches\/([^/]+)$/);
    if (method === "GET" && batchStatusMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const batch = await deps.taskRepository.getBatch(batchStatusMatch[1]);
      if (!batch) return fail("INVALID_TASK_BATCH", 404);
      const slots = (await deps.taskRepository.listSlots(batch.suiteId)).filter((slot) => slot.batchId === batch.id);
      const attempts = await Promise.all(slots.map(async (slot) => deps.taskRepository!.getAttempt((await deps.taskRepository!.listTaskVersions(slot.taskId)).attempts.find((attempt) => attempt.slotId === slot.id)?.id ?? ""))).then((items) => items.filter(Boolean));
      return ok({ batch, slots, attempts });
    }

    const taskVersionsMatch = path.match(/^\/api\/suite-tasks\/([^/]+)\/versions$/);
    if (method === "GET" && taskVersionsMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const task = await deps.taskRepository.getTask(taskVersionsMatch[1]); if (!task) return fail("INVALID_SUITE_TASK", 404);
      return ok(await deps.taskRepository.listTaskVersions(task.id));
    }
    const selectTaskVersionMatch = path.match(/^\/api\/suite-tasks\/([^/]+)\/versions\/([^/]+)\/select$/);
    if (method === "POST" && selectTaskVersionMatch) {
      if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
      const selection = options.body && typeof options.body === "object" && (options.body as Record<string, unknown>).selection === "final" ? "final" : "current";
      const version = await deps.taskRepository.selectVersion(selectTaskVersionMatch[1], selectTaskVersionMatch[2], selection); return version ? ok(version) : fail("INVALID_TASK_VERSION", 404);
    }
    const taskPreviewMatch = path.match(/^\/api\/suite-tasks\/([^/]+)\/versions\/([^/]+)\/preview$/);
    if (method === "GET" && taskPreviewMatch) return await previewTaskVersion(taskPreviewMatch[1], taskPreviewMatch[2]);

    const removeImageMatch = path.match(/^\/api\/suites\/([^/]+)\/input-images\/([^/]+)$/);
    if (method === "DELETE" && removeImageMatch) {
      const [suiteId, inputImageId] = removeImageMatch.slice(1);
      const image = await deps.repository.getInputImage(suiteId, inputImageId);
      if (!image) return fail("INVALID_INPUT_IMAGE", 404);
      try {
        const removed = await deps.repository.removeInputImage(suiteId, inputImageId);
        if (!removed) return fail("INVALID_INPUT_IMAGE", 404);
        await deps.storage.delete(removed.originalObjectKey).catch(() => undefined);
        await deps.storage.delete(removed.thumbnailObjectKey).catch(() => undefined);
        await deps.storage.delete(`suites/${suiteId}/inputs/${inputImageId}/generation-input.jpg`).catch(() => undefined);
        return ok({ id: inputImageId });
      } catch (error) {
        const code = error instanceof Error ? error.message : "INPUT_IMAGE_HAS_HISTORY";
        return fail(code, code === "INPUT_IMAGE_HAS_HISTORY" ? 409 : 500);
      }
    }

    const generationMatch = path.match(/^\/api\/suites\/([^/]+)\/input-images\/([^/]+)\/base-generation$/);
    if (method === "POST" && generationMatch) {
      const [suiteId, inputImageId] = generationMatch.slice(1);
      if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
      if (!deps.promptRepository) return fail("PROMPT_REPOSITORY_NOT_CONFIGURED", 503);
      const body = options.body && typeof options.body === "object" && !Array.isArray(options.body) ? options.body as Record<string, unknown> : {};
      const templateVersionId = typeof body.templateVersionId === "string" ? body.templateVersionId : "";
      if (!templateVersionId) return fail("PROMPT_TEMPLATE_REQUIRED");
      const template = await observedPromptLoad(deps.promptRepository, templateVersionId, "base_refine");
      if (!template) return fail("PROMPT_TEMPLATE_NOT_FOUND", 404);
      const validatedInput = validateDynamicInput(template.inputSchema, body.dynamicInput);
      if (!validatedInput.ok) return fail("PROMPT_INPUT_INVALID", 400, validatedInput.message);
      const prompt = renderPromptTemplate(template, validatedInput.value);
      const image = await deps.repository.getInputImage(suiteId, inputImageId);
      if (!image) return fail("INVALID_INPUT_IMAGE", 404);
      const createdAt = new Date().toISOString();
      const reservation = await deps.repository.beginBaseGeneration({
        id: randomUUID(),
        suiteId,
        inputImageId,
        baseVersionId: randomUUID(),
        idempotencyKey,
        model: "gpt-image-2",
        endpoint: "/v1/images/edits",
        prompt,
        promptTemplateVersionId: templateVersionId,
        dynamicInput: validatedInput.value,
        size: "1K",
        quality: "medium",
        n: 1,
        responseFormat: "b64_json",
        createdAt,
      });
      if (reservation.duplicate) {
        return ok({ attempt: attemptView(reservation.attempt), version: reservation.existingVersion ? versionView(reservation.existingVersion) : null }, reservation.attempt.status === "running" ? 202 : 200);
      }
      const provider = deps.provider;
      if (!provider) {
        await deps.repository.failBaseGeneration(reservation.attempt.id, "IMAGE_PROVIDER_NOT_CONFIGURED", errorMessages.IMAGE_PROVIDER_NOT_CONFIGURED, new Date().toISOString());
        return fail("IMAGE_PROVIDER_NOT_CONFIGURED", 503);
      }
      const executeGeneration = async () => {
        let source;
        try {
          const generationInputKey = `suites/${suiteId}/inputs/${inputImageId}/generation-input.jpg`;
          source = await withTimeout(deps.storage.get(generationInputKey), 60_000, "OBJECT_READ_TIMEOUT");
          if (!source) source = await withTimeout(deps.storage.get(image.originalObjectKey), 60_000, "OBJECT_READ_TIMEOUT");
        } catch (error) {
          if (error instanceof Error && error.message === "OBJECT_NOT_FOUND") {
            try { source = await withTimeout(deps.storage.get(image.originalObjectKey), 60_000, "OBJECT_READ_TIMEOUT"); }
            catch (fallbackError) {
              const code = fallbackError instanceof Error && fallbackError.message === "OBJECT_NOT_FOUND" ? "INPUT_OBJECT_NOT_FOUND" : "INPUT_OBJECT_READ_FAILED";
              await deps.repository.failBaseGeneration(reservation.attempt.id, code, errorMessages[code], new Date().toISOString());
              return;
            }
          } else {
            const code = "INPUT_OBJECT_READ_FAILED";
            await deps.repository.failBaseGeneration(reservation.attempt.id, code, errorMessages[code], new Date().toISOString());
            return;
          }
        }
        if (!source) {
          await deps.repository.failBaseGeneration(reservation.attempt.id, "INPUT_OBJECT_NOT_FOUND", errorMessages.INPUT_OBJECT_NOT_FOUND, new Date().toISOString());
          return;
        }
        let generated;
        try {
          generated = await provider.edit({
            requestId: reservation.attempt.id,
            flow: "base-image-refinement",
            endpoint: "/v1/images/edits",
            image: source.bytes,
            imageMimeType: source.contentType,
            imageFilename: source.key.endsWith("generation-input.jpg") ? "generation-input.jpg" : image.originalFilename,
            model: "gpt-image-2",
            prompt,
            size: "1K",
            quality: "medium",
            n: 1,
            responseFormat: "b64_json",
          });
        } catch (error) {
          const code = error instanceof Error && error.message === "IMAGE_PROVIDER_TIMEOUT" ? "IMAGE_PROVIDER_TIMEOUT" : "IMAGE_PROVIDER_FAILED";
          await deps.repository.failBaseGeneration(reservation.attempt.id, code, errorMessages[code], new Date().toISOString());
          return;
        }
        let processed;
        try {
          processed = await processGeneratedImage(generated.bytes);
        } catch {
          await deps.repository.failBaseGeneration(reservation.attempt.id, "INVALID_GENERATED_IMAGE", errorMessages.INVALID_GENERATED_IMAGE, new Date().toISOString());
          return;
        }
        const objectKey = `suites/${suiteId}/inputs/${inputImageId}/base/${reservation.attempt.baseVersionId}/final.png`;
        try {
          await deps.storage.put({ key: objectKey, bytes: processed.bytes, contentType: processed.mimeType });
        } catch {
          await deps.repository.failBaseGeneration(reservation.attempt.id, "STORAGE_WRITE_FAILED", errorMessages.STORAGE_WRITE_FAILED, new Date().toISOString());
          return;
        }
        try {
          await deps.repository.completeBaseGeneration({
            attemptId: reservation.attempt.id,
            objectKey,
            sha256: processed.sha256,
            width: processed.width,
            height: processed.height,
            mimeType: processed.mimeType,
            completedAt: new Date().toISOString(),
          });
        } catch {
          await deps.storage.delete(objectKey).catch(() => undefined);
          await deps.repository.failBaseGeneration(reservation.attempt.id, "GENERATION_PERSIST_FAILED", errorMessages.GENERATION_PERSIST_FAILED, new Date().toISOString()).catch(() => undefined);
        }
      };
      void executeGeneration().catch(async () => {
        await deps.repository.failBaseGeneration(reservation.attempt.id, "GENERATION_PERSIST_FAILED", errorMessages.GENERATION_PERSIST_FAILED, new Date().toISOString()).catch(() => undefined);
      });
      return ok({ attempt: attemptView(reservation.attempt), version: null }, 202);
    }

    const versionsMatch = path.match(/^\/api\/suites\/([^/]+)\/input-images\/([^/]+)\/base-versions$/);
    if (method === "GET" && versionsMatch) {
      const [suiteId, inputImageId] = versionsMatch.slice(1);
      const image = await deps.repository.getInputImage(suiteId, inputImageId);
      if (!image) return fail("INVALID_INPUT_IMAGE", 404);
      const [versions, attempts] = await Promise.all([
        deps.repository.listBaseImageVersions(suiteId, inputImageId),
        deps.repository.listGenerationAttempts(suiteId, inputImageId),
      ]);
      return ok({ currentVersionId: image.currentBaseVersionId, versions: versions.map(versionView), attempts: attempts.map(attemptView) });
    }

    const selectMatch = path.match(/^\/api\/suites\/([^/]+)\/input-images\/([^/]+)\/base-versions\/([^/]+)\/select$/);
    if (method === "POST" && selectMatch) {
      const selected = await deps.repository.selectBaseImageVersion(selectMatch[1], selectMatch[2], selectMatch[3]);
      return selected ? ok(versionView(selected)) : fail("INVALID_BASE_VERSION", 404);
    }

    const suiteMatch = path.match(/^\/api\/suites\/([^/]+)$/);
    if (method === "GET" && suiteMatch) {
      const suite = await deps.repository.getSuite(suiteMatch[1]);
      if (!suite) return fail("INVALID_SUITE_ID", 404);
      const inputImages = await deps.repository.getInputImages(suite.id);
      return ok({ ...suite, inputImages } satisfies SuiteAggregate);
    }
    return fail("NOT_FOUND", 404);
  };

  const upload = async (suiteId: string, file: UploadFile): Promise<AppResponse> => {
    const suite = await deps.repository.getSuite(suiteId);
    if (!suite) return fail("INVALID_SUITE_ID", 404);
    if (file.idempotencyKey && uploadIdempotency.has(`${suiteId}:${file.idempotencyKey}`)) return ok(uploadIdempotency.get(`${suiteId}:${file.idempotencyKey}`)!, 201);
    const images = await deps.repository.getInputImages(suiteId);
    if (images.length >= 6 && !file.idempotencyKey) return fail("TOO_MANY_IMAGES", 400);
    const ordinal = file.ordinal ?? (images.length ? Math.max(...images.map((image) => image.ordinal)) + 1 : 1);
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 6) return fail("INVALID_ORDINAL");
    let processed;
    try { processed = await processImage(file.bytes, file.mimeType); } catch (error) { return fail(error instanceof Error ? error.message : "INVALID_IMAGE"); }
    if (await deps.repository.hasInputImageHash(suiteId, processed.sha256)) return fail("DUPLICATE_IMAGE", 409);
    const inputId = randomUUID();
    const originalObjectKey = `suites/${suiteId}/inputs/${inputId}/original`;
    const thumbnailObjectKey = `suites/${suiteId}/inputs/${inputId}/thumbnail`;
    const generationInputObjectKey = `suites/${suiteId}/inputs/${inputId}/generation-input.jpg`;
    try {
      await deps.storage.put({ key: originalObjectKey, bytes: file.bytes, contentType: processed.mimeType });
      await deps.storage.put({ key: thumbnailObjectKey, bytes: processed.thumbnail, contentType: "image/jpeg" });
      await deps.storage.put({ key: generationInputObjectKey, bytes: processed.generationInput, contentType: "image/jpeg" });
      const createdAt = new Date().toISOString();
      const image = await deps.repository.createInputImage({ id: inputId, suiteId, ordinal, originalObjectKey, thumbnailObjectKey, sha256: processed.sha256, width: processed.width, height: processed.height, mimeType: processed.mimeType, originalFilename: file.filename, currentBaseVersionId: null, createdAt }, file.idempotencyKey);
      if (file.idempotencyKey) uploadIdempotency.set(`${suiteId}:${file.idempotencyKey}`, image);
      return ok(image, 201);
    } catch (error) {
      await deps.storage.delete(originalObjectKey).catch(() => undefined);
      await deps.storage.delete(thumbnailObjectKey).catch(() => undefined);
      await deps.storage.delete(generationInputObjectKey).catch(() => undefined);
      const code = error instanceof Error ? error.message : "UPLOAD_FAILED";
      return fail(code, code === "DUPLICATE_ORDINAL" || code === "DUPLICATE_IMAGE" ? 409 : 500);
    }
  };

  const preview = async (suiteId: string, imageId: string, kind: "original" | "thumbnail") => {
    const image = await deps.repository.getInputImage(suiteId, imageId);
    if (!image) return fail("INVALID_INPUT_IMAGE", 404);
    return previewObject(kind === "original" ? image.originalObjectKey : image.thumbnailObjectKey, deps.storage);
  };

  const previewBaseVersion = async (suiteId: string, imageId: string, versionId: string) => {
    const version = await deps.repository.getBaseImageVersion(suiteId, imageId, versionId);
    if (!version) return fail("INVALID_BASE_VERSION", 404);
    return previewObject(version.objectKey, deps.storage);
  };

  const previewTaskVersion = async (taskId: string, versionId: string) => {
    if (!deps.taskRepository) return fail("TASK_REPOSITORY_NOT_CONFIGURED", 503);
    const history = await deps.taskRepository.listTaskVersions(taskId);
    const version = history.versions.find((item) => item.id === versionId);
    return version ? previewObject(version.objectKey, deps.storage) : fail("INVALID_TASK_VERSION", 404);
  };

  const previewLibraryResource = async (resourceId: string) => {
    if (!deps.libraryRepository) return fail("LIBRARY_REPOSITORY_NOT_CONFIGURED", 503);
    const resource = await deps.libraryRepository.getResource(resourceId);
    if (!resource) return fail("LIBRARY_RESOURCE_NOT_FOUND", 404);
    const target = await deps.libraryRepository.getPreviewObject(resource.id);
    return target ? previewObject(target.objectKey, deps.storage) : fail("OBJECT_NOT_FOUND", 404);
  };

  const previewReverseReference = async (planId: string, referenceId: string, kind: "original" | "thumbnail" = "thumbnail"): Promise<AppResponse> => { const plan = await reverseRepository.getPlan(planId); const ref = plan?.references.find((item) => item.id === referenceId); if (!ref) return fail("REVERSE_REFERENCE_NOT_FOUND", 404); const object = await deps.storage.get(kind === "original" ? ref.objectKey : ref.thumbnailObjectKey); return object ? { status: 200, body: { data: { contentType: object.contentType }, requestId: randomUUID() }, headers: { "content-type": object.contentType }, raw: object.bytes } : fail("OBJECT_NOT_FOUND", 404); };
  return { request, upload, preview, previewBaseVersion, previewTaskVersion, previewLibraryResource, previewReverseReference };
}

async function previewObject(key: string, storage: StorageAdapter): Promise<AppResponse> {
  try {
    const object = await storage.get(key);
    if (!object) return fail("OBJECT_NOT_FOUND", 404);
    return { status: 200, body: { data: { contentType: object.contentType }, requestId: randomUUID() }, headers: { "content-type": object.contentType, "cache-control": "private, max-age=60" }, raw: object.bytes };
  } catch (error) {
    return fail(error instanceof Error && error.message === "OBJECT_NOT_FOUND" ? "OBJECT_NOT_FOUND" : "OBJECT_READ_FAILED", error instanceof Error && error.message === "OBJECT_NOT_FOUND" ? 404 : 502);
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
