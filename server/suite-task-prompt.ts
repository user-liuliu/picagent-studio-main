import { createHash } from "node:crypto";
import type { CategoryPromptItem, CategoryPromptRequest, PlanItem, PlanSnapshot } from "./types.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function promptSha256(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function styleText(styleCard: Record<string, unknown>): string {
  if (typeof styleCard.promptPrefix === "string" && styleCard.promptPrefix.trim()) return styleCard.promptPrefix.trim();
  return Object.entries(styleCard).length ? stableJson(styleCard) : "未提供额外风格卡";
}

/** The order here is part of the image-generation contract. */
export function composeSuiteTaskPrompt(input: {
  globalStyleCard?: Record<string, unknown>;
  categoryPrompt: string;
  platformConstraints?: string;
  factConstraints?: string;
  manualAddition?: string;
}): string {
  const platform = input.platformConstraints?.trim() || "遵守目标平台的图片、文字和商品展示规则。";
  const facts = input.factConstraints?.trim() || "只呈现已确认的商品事实；不得编造尺寸、材质、配件、兼容关系、功效或卖点。";
  const manual = input.manualAddition?.trim() || "无";
  return [
    "系统安全约束：不得生成违法、危险或误导性内容。",
    `平台约束：${platform}`,
    `商品事实约束：${facts}`,
    `全局风格卡：${styleText(input.globalStyleCard ?? {})}`,
    `当前类别提示词：${input.categoryPrompt.trim()}`,
    `单卡人工补充：${manual}`,
  ].join("\n");
}

function expectedCategories(snapshot: PlanSnapshot): Array<{ code: string; count: number }> {
  if (!snapshot.structure) return [];
  const result: Array<{ code: string; count: number }> = [];
  const mainCount = "mainAllocation" in snapshot.structure ? snapshot.structure.mainAllocation.count : snapshot.structure.mainImageCount;
  if (mainCount > 0) result.push({ code: "main", count: mainCount });
  for (const raw of snapshot.structure.categoryAllocations) {
    const row = raw as Record<string, unknown>;
    const count = Number(row.count);
    if (typeof row.category === "string" && Number.isInteger(count) && count > 0) result.push({ code: row.category, count });
  }
  return result;
}

function requestItems(request: CategoryPromptRequest): CategoryPromptItem[] {
  return request.status === "succeeded" && request.items.length === request.requestedCount ? request.items : [];
}

function stablePlanItemId(planSnapshotId: string, categoryCode: string, stableId: string): string {
  const hex = createHash("sha256").update(`${planSnapshotId}:${categoryCode}:${stableId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function itemKey(item: PlanItem): string {
  return item.id || `${item.categoryCode ?? item.imageType}:${item.title}:${item.purpose}`;
}

/** Converts every currently successful category output into immutable plan items. */
export function materializeCategoryPlanItems(snapshot: PlanSnapshot, requests: CategoryPromptRequest[]): PlanItem[] | null {
  if (snapshot.phase !== "structure_plan" || snapshot.confirmationStatus !== "confirmed" || !snapshot.structure) return null;
  if ("status" in snapshot.structure ? snapshot.structure.status !== "READY_FOR_REVIEW" : !snapshot.structure.canProceed) return null;
  const byCategory = new Map<string, CategoryPromptRequest>();
  for (const request of requests) if (requestItems(request).length) byCategory.set(request.categoryCode, request);
  const expected = expectedCategories(snapshot);
  if (!expected.length) return null;

  const style = snapshot.structure.globalStyleCard;
  const platform = typeof snapshot.dynamicInput.platform_text_rule === "string"
    ? snapshot.dynamicInput.platform_text_rule
    : typeof snapshot.dynamicInput.text_strategy === "string" ? snapshot.dynamicInput.text_strategy : undefined;
  const factsById = new Map(snapshot.chunks.map((chunk) => [chunk.sourceChunkId, chunk]));
  const humanSupplement = [snapshot.dynamicInput.human_supplement, snapshot.dynamicInput.emphasis_requirements]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n");
  const items: PlanItem[] = [...snapshot.items];
  const existingKeys = new Set(items.map(itemKey));
  for (const { code } of expected) {
    const request = byCategory.get(code);
    if (!request || request.requestedCount !== expected.find((entry) => entry.code === code)?.count) continue;
    for (const output of requestItems(request)) {
      const id = stablePlanItemId(request.planSnapshotId, code, output.stableId);
      const key = id;
      if (existingKeys.has(key)) continue;
      const factText = output.factRefs.map((ref) => ref === "human_supplement" ? humanSupplement : factsById.get(ref)?.content ?? "").filter(Boolean).join("\n");
      const prompt = composeSuiteTaskPrompt({ globalStyleCard: style, categoryPrompt: output.prompt, platformConstraints: platform, factConstraints: factText || undefined });
      items.push({
        id, ordinal: items.length + 1, imageType: code === "main" ? "main" : "detail", title: output.title, purpose: output.purpose,
        prompt, categoryCode: code, referenceImageIds: output.referenceImageIds, factRefs: output.factRefs, allowsTextOverlay: output.allowsTextOverlay,
        textContent: output.textContent, aspectRatio: output.aspectRatio, suggestedParams: output.suggestedParams, globalStyleCard: style,
        promptSha256: promptSha256(prompt),
      });
    }
  }
  return items.length ? items : null;
}
