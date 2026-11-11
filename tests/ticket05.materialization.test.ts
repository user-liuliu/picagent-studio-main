import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createTicket02App } from "../server/app.js";
import { MemoryCategoryPromptRepository } from "../server/repositories/memory-category-prompt-repository.js";
import { MemoryPlanRepository } from "../server/repositories/memory-plan-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryTaskRepository } from "../server/repositories/memory-task-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { materializeCategoryPlanItems } from "../server/suite-task-prompt.js";
import type { CategoryPromptRequest, PlanSnapshot } from "../server/types.js";

class ConflictingPlanRepository extends MemoryPlanRepository {
  private injected = false;

  override async appendRevision(snapshot: PlanSnapshot) {
    if (!this.injected && snapshot.requestSummary.phase === "task_materialization") {
      this.injected = true;
      await super.appendRevision(snapshot);
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint: "plan_snapshots_suite_id_revision_number_key" });
    }
    return super.appendRevision(snapshot);
  }
}

function categoryRequest(snapshot: PlanSnapshot, categoryCode: string, status: CategoryPromptRequest["status"], prompt: string): CategoryPromptRequest {
  return { id: randomUUID(), suiteId: snapshot.suiteId, planSnapshotId: snapshot.id, categoryCode, requestedCount: 1, status, idempotencyKey: `${categoryCode}-${status}`, retryOfRequestId: null, templateVersionId: snapshot.templateVersionId, dynamicInput: {}, humanInput: {}, approvedFactRefs: [], inputImageIds: snapshot.inputImageIds, baseVersionIds: [], provider: snapshot.provider, requestSummary: {}, responseSummary: null, items: [{ stableId: `${categoryCode}-1`, category: categoryCode, title: categoryCode, purpose: "独立职责", referenceImageIds: snapshot.inputImageIds, factRefs: [], prompt, allowsTextOverlay: "no", textContent: [], aspectRatio: "1:1", suggestedParams: {} }], errorCode: status === "failed" ? "CATEGORY_PROMPT_FAILED" : null, errorMessage: null, createdAt: new Date().toISOString(), completedAt: status === "running" ? null : new Date().toISOString() };
}

test("confirmed category outputs materialize independent cards with frozen style prompt", async () => {
  const repository = new MemorySuiteRepository();
  const storage = new MemoryStorage();
  const plans = new MemoryPlanRepository();
  const categoryPrompts = new MemoryCategoryPromptRepository();
  const tasks = new MemoryTaskRepository();
  const suite = await repository.createSuite("materialization");
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  await storage.put({ key: "source.png", bytes, contentType: "image/png" });
  const input = await repository.createInputImage({ id: randomUUID(), suiteId: suite.id, ordinal: 1, originalObjectKey: "source.png", thumbnailObjectKey: "source.png", sha256: "c".repeat(64), width: 32, height: 32, mimeType: "image/png", originalFilename: "source.png", currentBaseVersionId: null, createdAt: new Date().toISOString() });
  const snapshot: PlanSnapshot = {
    id: randomUUID(), suiteId: suite.id, revisionNumber: 1, revisionKind: "human", parentSnapshotId: null, templateVersionId: randomUUID(), dynamicInput: { platform_text_rule: "Amazon image rules", human_supplement: "", emphasis_requirements: "容量 10000mAh；尺寸 50*40*15mm。" }, humanInput: {}, chunks: [], inputImageIds: [input.id], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, rawOutputSummary: {}, schemaVersion: "suite-structure-plan-v2", items: [], phase: "structure_plan", confirmationStatus: "confirmed", confirmedAt: new Date().toISOString(), structure: { status: "READY_FOR_REVIEW", mainAllocation: { category: "main", count: 1, reason: "主图组", sourceImageIds: [input.id], factRefs: ["human_supplement"], missingFacts: [] }, detailImageCount: 1, categoryAllocations: [{ category: "lifestyle_use", requirement: "required", count: 1, reason: "场景", sourceImageIds: [input.id], factRefs: ["human_supplement"], missingFacts: [] }], globalStyleCard: { promptPrefix: "干净中性的统一电商摄影风格" } }, createdAt: new Date().toISOString(),
  };
  await plans.appendRevision(snapshot);
  const makeRequest = (categoryCode: string, title: string): CategoryPromptRequest => ({ id: randomUUID(), suiteId: suite.id, planSnapshotId: snapshot.id, categoryCode, requestedCount: 1, status: "running", idempotencyKey: `${categoryCode}-key`, retryOfRequestId: null, templateVersionId: snapshot.templateVersionId, dynamicInput: {}, humanInput: {}, approvedFactRefs: [], inputImageIds: [input.id], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, responseSummary: null, items: [], errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), completedAt: null });
  for (const [code, title] of [["main", "白底主图"], ["lifestyle_use", "生活场景"]] as const) {
    const request = makeRequest(code, title);
    await categoryPrompts.beginRequest(request);
    await categoryPrompts.completeRequest(request.id, [{ stableId: `${code}-1`, category: code, title, purpose: "独立职责", referenceImageIds: [input.id], factRefs: ["human_supplement"], prompt: `${code} prompt`, allowsTextOverlay: "no", textContent: [], aspectRatio: "1:1", suggestedParams: {} }], { itemCount: 1 });
  }
  const api = createTicket02App({ repository, storage, planRepository: plans, categoryPromptRepository: categoryPrompts, taskRepository: tasks, provider: { edit: async ({ n }) => { assert.equal(n, 1); return { bytes, mimeType: "image/png" }; } } });
  const created = await api.request("POST", `/api/suites/${suite.id}/tasks`, { body: { planSnapshotId: snapshot.id } });
  assert.equal(created.status, 201);
  const cards = (created.body as any).data.tasks;
  assert.equal(cards.length, 2);
  assert.match(cards[0].promptDraft, /全局风格卡/);
  assert.match(cards[0].promptDraft, /干净中性的统一电商摄影风格/);
  assert.match(cards[0].promptDraft, /容量 10000mAh/);
  assert.match(cards[0].promptDraft, /尺寸 50\*40\*15mm/);
  assert.match(cards[1].promptDraft, /lifestyle_use prompt/);
  const generated = await api.request("POST", `/api/suites/${suite.id}/generation`, { headers: { "idempotency-key": "materialize-generation" }, body: {} });
  assert.equal(generated.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const workbench = await api.request("GET", `/api/suites/${suite.id}/workbench`);
  const task = (workbench.body as any).data.tasks.find((item: any) => item.categoryCode === "lifestyle_use");
  assert.equal(task.versions.length, 1);
  assert.equal(task.attempts[0].requestSummary.n, 1);
  assert.equal(task.attempts[0].promptSnapshot.globalStyleCard.promptPrefix, "干净中性的统一电商摄影风格");
  assert.match(task.attempts[0].promptSha256, /^[a-f0-9]{64}$/);
});

test("partial category success materializes successful cards and later appends recovered categories idempotently", () => {
  const snapshot: PlanSnapshot = { id: randomUUID(), suiteId: randomUUID(), revisionNumber: 1, revisionKind: "human", parentSnapshotId: null, templateVersionId: randomUUID(), dynamicInput: {}, humanInput: {}, chunks: [], inputImageIds: [randomUUID()], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, rawOutputSummary: {}, schemaVersion: "suite-structure-plan-v1", items: [], phase: "structure_plan", confirmationStatus: "confirmed", confirmedAt: new Date().toISOString(), structure: { mainImageCount: 1, detailImageCount: 1, categoryAllocations: [{ category: "lifestyle_use", requirement: "required", count: 1, reason: "场景", sourceImageIds: [], factRefs: [], missingFacts: [] }], globalStyleCard: { tone: "clean" }, canProceed: true }, createdAt: new Date().toISOString() };
  const main = categoryRequest(snapshot, "main", "succeeded", "main prompt");
  const running = categoryRequest(snapshot, "lifestyle_use", "running", "lifestyle prompt");
  const partial = materializeCategoryPlanItems(snapshot, [main, running]);
  assert.equal(partial?.length, 1);
  assert.equal(partial?.[0].categoryCode, "main");
  assert.match(partial?.[0].prompt ?? "", /全局风格卡/);

  const recovered = materializeCategoryPlanItems({ ...snapshot, items: partial! }, [main, running, categoryRequest(snapshot, "lifestyle_use", "succeeded", "lifestyle prompt")]);
  assert.equal(recovered?.length, 2);
  assert.equal(recovered?.[0].id, partial?.[0].id);
  assert.equal(recovered?.filter((item) => item.categoryCode === "main").length, 1);
});

test("the same model stable id stays unique across structure plans", () => {
  const first: PlanSnapshot = { id: randomUUID(), suiteId: randomUUID(), revisionNumber: 1, revisionKind: "human", parentSnapshotId: null, templateVersionId: randomUUID(), dynamicInput: {}, humanInput: {}, chunks: [], inputImageIds: [randomUUID()], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, rawOutputSummary: {}, schemaVersion: "suite-structure-plan-v2", items: [], phase: "structure_plan", confirmationStatus: "confirmed", confirmedAt: new Date().toISOString(), structure: { status: "READY_FOR_REVIEW", mainAllocation: { category: "main", count: 1, reason: "主图", sourceImageIds: [], factRefs: [], missingFacts: [] }, detailImageCount: 0, categoryAllocations: [], globalStyleCard: { promptPrefix: "统一风格" } }, createdAt: new Date().toISOString() };
  const second: PlanSnapshot = { ...first, id: randomUUID(), suiteId: randomUUID() };
  const firstItem = materializeCategoryPlanItems(first, [categoryRequest(first, "main", "succeeded", "main prompt")])?.[0];
  const secondItem = materializeCategoryPlanItems(second, [categoryRequest(second, "main", "succeeded", "main prompt")])?.[0];
  assert.notEqual(firstItem?.id, secondItem?.id);
});

test("a recovered category appends a card without archiving the already materialized card", async () => {
  const repository = new MemorySuiteRepository(); const storage = new MemoryStorage(); const plans = new ConflictingPlanRepository(); const categoryPrompts = new MemoryCategoryPromptRepository(); const tasks = new MemoryTaskRepository();
  const suite = await repository.createSuite("partial materialization"); const inputId = randomUUID();
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer();
  await storage.put({ key: "partial-source.png", bytes, contentType: "image/png" });
  await repository.createInputImage({ id: inputId, suiteId: suite.id, ordinal: 1, originalObjectKey: "partial-source.png", thumbnailObjectKey: "partial-source.png", sha256: "d".repeat(64), width: 32, height: 32, mimeType: "image/png", originalFilename: "partial-source.png", currentBaseVersionId: null, createdAt: new Date().toISOString() });
  const source: PlanSnapshot = { id: randomUUID(), suiteId: suite.id, revisionNumber: 1, revisionKind: "human", parentSnapshotId: null, templateVersionId: randomUUID(), dynamicInput: {}, humanInput: {}, chunks: [], inputImageIds: [inputId], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, rawOutputSummary: {}, schemaVersion: "suite-structure-plan-v2", items: [], phase: "structure_plan", confirmationStatus: "confirmed", confirmedAt: new Date().toISOString(), structure: { status: "READY_FOR_REVIEW", mainAllocation: { category: "main", count: 1, reason: "主图组", sourceImageIds: [inputId], factRefs: [], missingFacts: [] }, detailImageCount: 1, categoryAllocations: [{ category: "lifestyle_use", requirement: "required", count: 1, reason: "场景", sourceImageIds: [inputId], factRefs: [], missingFacts: [] }], globalStyleCard: { promptPrefix: "干净中性" } }, createdAt: new Date().toISOString() };
  await plans.appendRevision(source);
  const main = categoryRequest(source, "main", "succeeded", "main prompt"); const pending = categoryRequest(source, "lifestyle_use", "running", "lifestyle prompt");
  await categoryPrompts.beginRequest(main); await categoryPrompts.completeRequest(main.id, main.items, {});
  await categoryPrompts.beginRequest(pending);
  const api = createTicket02App({ repository, storage, planRepository: plans, categoryPromptRepository: categoryPrompts, taskRepository: tasks });
  const first = await api.request("POST", `/api/suites/${suite.id}/tasks`, { body: { planSnapshotId: source.id } });
  assert.equal(first.status, 201); assert.equal((first.body as any).data.tasks.length, 1);
  await categoryPrompts.completeRequest(pending.id, pending.items, {});
  const second = await api.request("POST", `/api/suites/${suite.id}/tasks`, { body: {} });
  assert.equal(second.status, 201);
  const active = (second.body as any).data.tasks.filter((task: any) => task.status !== "archived");
  assert.equal(active.length, 2);
  assert.equal(active.filter((task: any) => task.categoryCode === "main").length, 1);
  assert.equal(active.find((task: any) => task.categoryCode === "main").status, "pending");
});
