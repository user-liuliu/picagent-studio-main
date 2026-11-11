import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createTicket02App } from "../server/app.js";
import { MemoryCategoryPromptRepository } from "../server/repositories/memory-category-prompt-repository.js";
import { MemoryPlanRepository } from "../server/repositories/memory-plan-repository.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { parseNormalizedPromptMarkdown } from "../server/prompt-library.js";
import type { PlanSnapshot } from "../server/types.js";

const image = Buffer.from("fake-image");

async function fixture(outputFor: (category: string, count: number) => unknown, options: { confirmed?: boolean; emphasisRequirements?: string } = {}) {
  const repository = new MemorySuiteRepository();
  const storage = new MemoryStorage();
  const prompts = new MemoryPromptRepository();
  const markdown = await (await import("node:fs/promises")).readFile("prompt/normalized/general-category-prompt.md", "utf8");
  const template = parseNormalizedPromptMarkdown(markdown, "general-category-prompt.md");
  const [published] = await prompts.importRecords([template]);
  await prompts.publishVersion(published.templateVersionId);
  const suite = await repository.createSuite("类别提示词");
  await repository.createInputImage({ id: "img-1", suiteId: suite.id, ordinal: 1, originalObjectKey: `input/${suite.id}/img-1`, thumbnailObjectKey: `input/${suite.id}/img-1-thumb`, sha256: "a".repeat(64), width: 1, height: 1, mimeType: "image/png", originalFilename: "product.png", currentBaseVersionId: null, createdAt: new Date().toISOString() });
  await storage.put({ key: `input/${suite.id}/img-1`, bytes: image, contentType: "image/png" });
  const plans = new MemoryPlanRepository();
  const snapshot: PlanSnapshot = {
    id: randomUUID(), suiteId: suite.id, revisionNumber: 1, revisionKind: "human", parentSnapshotId: null,
    templateVersionId: published.templateVersionId, dynamicInput: { platform: "Amazon", output_language: "中文", human_supplement: "人工确认：包装内含一条充电线。", ...(options.emphasisRequirements ? { emphasis_requirements: options.emphasisRequirements } : {}) }, humanInput: {}, chunks: [], inputImageIds: ["img-1"], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, rawOutputSummary: {}, schemaVersion: "suite-structure-plan-v2", items: [], phase: "structure_plan", confirmationStatus: options.confirmed === false ? "draft" : "confirmed", confirmedAt: new Date().toISOString(), structure: { status: "READY_FOR_REVIEW", mainAllocation: { category: "main", count: 1, reason: "主图组", sourceImageIds: ["img-1"], factRefs: ["human_supplement"], missingFacts: [] }, detailImageCount: 2, categoryAllocations: [{ category: "lifestyle_use", requirement: "required", count: 1, reason: "使用场景", sourceImageIds: ["img-1"], factRefs: ["human_supplement"], missingFacts: [] }, { category: "material_detail", requirement: "optional", count: 1, reason: "材质", sourceImageIds: ["img-1"], factRefs: [], missingFacts: [] }], globalStyleCard: { promptPrefix: "干净中性的统一电商摄影风格" } }, createdAt: new Date().toISOString(),
  };
  await plans.appendRevision(snapshot);
  const categoryRequests = new MemoryCategoryPromptRepository();
  let calls = 0;
  const inputs: Array<Parameters<NonNullable<import("../server/types.js").LlmClient["generateCategoryPrompt"]>>[0]> = [];
  const app = createTicket02App({ repository, storage, promptRepository: prompts, planRepository: plans, categoryPromptRepository: categoryRequests, llmClient: { provider: "fake", model: "qwen-test", isFake: true, async generatePlan() { return {}; }, async generateCategoryPrompt(input) { calls += 1; inputs.push(input); return outputFor(input.categoryCode, input.requestedCount); } } });
  return { app, suite, snapshot, template: published, categoryRequests, inputs, get calls() { return calls; } };
}

function output(category: string, count: number, override: Partial<Record<string, unknown>> = {}) {
  return { schemaVersion: "suite-category-prompt-v1", category, items: Array.from({ length: count }, (_, index) => ({ stableId: `${category}-${index + 1}`, category, title: `${category}-${index + 1}`, purpose: "独立职责", referenceImageIds: ["img-1"], factRefs: [], prompt: `完整提示词 ${index + 1}`, allowsTextOverlay: "platform_default", textContent: [], aspectRatio: "1:1", suggestedParams: {} })), ...override };
}

async function waitForStatus(app: Awaited<ReturnType<typeof fixture>>["app"], suiteId: string, expected: string, timeout = 200) {
  for (let i = 0; i < timeout; i += 1) {
    const response = await app.request("GET", `/api/suites/${suiteId}/category-prompts`);
    const data = (response.body as any).data;
    if (data.status === expected || data.requests.some((item: any) => item.status === expected)) return data;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("category prompt timeout");
}

test("requires a confirmed structure plan and generates one request per category", async () => {
  const fixtureData = await fixture((category, count) => output(category, count));
  const blocked = await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "blocked" }, body: { planSnapshotId: randomUUID() } });
  assert.equal(blocked.status, 409);
  const started = await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "start-1" }, body: { planSnapshotId: fixtureData.snapshot.id, templateVersionId: fixtureData.template.templateVersionId } });
  assert.equal(started.status, 202);
  const terminal = await waitForStatus(fixtureData.app, fixtureData.suite.id, "succeeded");
  assert.equal(terminal.expectedRequestCount, 3);
  assert.equal(terminal.requests.length, 3);
  assert.deepEqual(terminal.requests.map((request: any) => request.categoryCode), ["main", "lifestyle_use", "material_detail"]);
  assert.equal(terminal.requests.reduce((sum: number, request: any) => sum + request.items.length, 0), 3);
  const mainInput = fixtureData.inputs.find((input) => input.categoryCode === "main");
  assert.deepEqual(mainInput?.approvedFactRefs, ["human_supplement"]);
  assert.equal(mainInput?.dynamicInput.human_supplement, "人工确认：包装内含一条充电线。");
  assert.deepEqual(mainInput?.dynamicInput.reference_image_ids, ["img-1"]);
  const materialInput = fixtureData.inputs.find((input) => input.categoryCode === "material_detail");
  assert.deepEqual(materialInput?.approvedFactRefs, []);
  assert.deepEqual(materialInput?.chunks, []);
});

test("category prompt input derives human_supplement from emphasis requirements without mutating snapshot", async () => {
  const emphasis = "容量 10000mAh；尺寸 50*40*15mm。";
  const fixtureData = await fixture((category, count) => output(category, count), { emphasisRequirements: emphasis });
  await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "emphasis-category" }, body: { planSnapshotId: fixtureData.snapshot.id, templateVersionId: fixtureData.template.templateVersionId } });
  await waitForStatus(fixtureData.app, fixtureData.suite.id, "succeeded");
  const mainInput = fixtureData.inputs.find((input) => input.categoryCode === "main");
  assert.equal(mainInput?.dynamicInput.human_supplement, `人工确认：包装内含一条充电线。\n${emphasis}`);
  assert.equal(fixtureData.snapshot.dynamicInput.human_supplement, "人工确认：包装内含一条充电线。");
  assert.equal(fixtureData.snapshot.dynamicInput.emphasis_requirements, emphasis);
});

test("wrong count fails only that category and retry does not rebuild successes", async () => {
  let attempts = 0;
  const fixtureData = await fixture((category, count) => {
    attempts += 1;
    return category === "material_detail" && attempts === 3 ? output(category, count - 1) : output(category, count);
  });
  await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "start-2" }, body: { planSnapshotId: fixtureData.snapshot.id, templateVersionId: fixtureData.template.templateVersionId } });
  const failed = await waitForStatus(fixtureData.app, fixtureData.suite.id, "failed");
  const successfulIds = failed.requests.filter((item: any) => item.status === "succeeded").map((item: any) => item.id);
  assert.equal(failed.requests.find((item: any) => item.categoryCode === "material_detail").status, "failed");
  const retry = await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts/material_detail/retry`, { headers: { "idempotency-key": "retry-1" }, body: { templateVersionId: fixtureData.template.templateVersionId } });
  assert.equal(retry.status, 202);
  let recovered: any;
  for (let i = 0; i < 200; i += 1) {
    const response = await fixtureData.app.request("GET", `/api/suites/${fixtureData.suite.id}/category-prompts`);
    recovered = (response.body as any).data;
    if (recovered.requests.filter((item: any) => item.categoryCode === "material_detail").at(-1)?.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.deepEqual(recovered.requests.filter((item: any) => successfulIds.includes(item.id)).map((item: any) => item.id), successfulIds);
  assert.equal(recovered.requests.filter((item: any) => item.categoryCode === "material_detail").at(-1).status, "succeeded");
});

test("same category batch idempotency key does not duplicate model calls", async () => {
  const fixtureData = await fixture((category, count) => output(category, count));
  const body = { planSnapshotId: fixtureData.snapshot.id, templateVersionId: fixtureData.template.templateVersionId };
  await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "same" }, body });
  await waitForStatus(fixtureData.app, fixtureData.suite.id, "succeeded");
  await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "same" }, body });
  assert.equal(fixtureData.calls, 3);
  assert.equal((await fixtureData.categoryRequests.listRequests(fixtureData.snapshot.id)).length, 3);
});

test("different client keys do not duplicate an active or successful category request", async () => {
  const fixtureData = await fixture((category, count) => output(category, count));
  const body = { planSnapshotId: fixtureData.snapshot.id, templateVersionId: fixtureData.template.templateVersionId };
  await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "client-a" }, body });
  await waitForStatus(fixtureData.app, fixtureData.suite.id, "succeeded");
  const second = await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "client-b" }, body });
  assert.equal(second.status, 202);
  assert.equal(fixtureData.calls, 3);
  assert.equal((await fixtureData.categoryRequests.listRequests(fixtureData.snapshot.id)).length, 3);
});

test("normalizes the observed QWEN array and snake_case category output without losing its composition constraints", async () => {
  const fixtureData = await fixture((category) => [{ version: "v1", category_code: category, category_name: "主图", requested_count: 1, items: [{ item_id: `${category}-observed-1`, image_role: "商品主图", composition: "居中完整展示", camera: "正面平视", subject: "黑色无线鼠标", style: "干净电商产品摄影", reference_image_ids: ["img-1"], text_content: [], negative_constraints: ["不得增加配件"] }] }]);
  await fixtureData.app.request("POST", `/api/suites/${fixtureData.suite.id}/category-prompts`, { headers: { "idempotency-key": "observed-shape" }, body: { planSnapshotId: fixtureData.snapshot.id, templateVersionId: fixtureData.template.templateVersionId } });
  const terminal = await waitForStatus(fixtureData.app, fixtureData.suite.id, "succeeded");
  const main = terminal.requests.find((request: any) => request.categoryCode === "main");
  assert.equal(main.items[0].stableId, "main-observed-1");
  assert.match(main.items[0].prompt, /构图：居中完整展示/);
  assert.match(main.items[0].prompt, /负面约束：不得增加配件/);
});
