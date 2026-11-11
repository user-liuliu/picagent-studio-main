import assert from "node:assert/strict";
import test from "node:test";
import { createTicket02App } from "../server/app.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryTaskRepository } from "../server/repositories/memory-task-repository.js";
import { MemoryLibraryRepository } from "../server/repositories/memory-library-repository.js";
import type { LlmClient, PromptRepository, PromptTemplateRuntime } from "../server/types.js";

const template: PromptTemplateRuntime = { templateId: "t-main", templateVersionId: "tv-main", versionNo: 1, code: "reverse.main", name: "主图反推", kind: "planner", stage: "reverse_prompt", executionTarget: "llm", inputSchema: [], outputSchema: {}, applicability: { targetType: "main" }, body: "reverse-prompt-v1", userPromptTemplate: "请输出 JSON", status: "published", sourceFile: "test", sourceHeading: "主图", sourceSha256: "a".repeat(64) };
const detailTemplate: PromptTemplateRuntime = { ...template, templateId: "t-detail", templateVersionId: "tv-detail", code: "reverse.detail", name: "详情图反推", applicability: { targetType: "detail" }, sourceHeading: "详情图", sourceSha256: "b".repeat(64) };
const prompts: PromptRepository = { importRecords: async () => [], publishVersion: async () => template, listPublished: async () => [template, detailTemplate], getPublishedVersion: async (id) => id === template.templateVersionId ? template : id === detailTemplate.templateVersionId ? detailTemplate : null, listVersions: async () => [template], getVersion: async () => template, updateDraft: async () => null, copyVersion: async () => null, retireVersion: async () => null };
const llm: LlmClient = { provider: "qwen", model: "qwen-vl-max", isFake: true, generatePlan: async () => ({}), generateReversePrompt: async ({ referenceImageId }) => ({ schemaVersion: "reverse-prompt-v1", referenceImageId, prompt: "以上传的产品白底图为唯一外观来源，提炼参考图的构图与光影。" }) };
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("reverse plan persists validated image, template, model output and user prompt version", async () => {
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), promptRepository: prompts, llmClient: llm });
  const created = await api.request("POST", "/api/reverse-plans", { headers: { "idempotency-key": "plan-1" }, body: { mode: "main" } });
  assert.equal(created.status, 201); const planId = (created.body as any).data.id;
  const uploaded = await api.request("POST", `/api/reverse-plans/${planId}/references`, { headers: { "idempotency-key": "ref-1" }, body: { filename: "a.png", mimeType: "image/png", bytesBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } });
  assert.equal(uploaded.status, 201); const refId = (uploaded.body as any).data.id;
  assert.equal((await api.request("PATCH", `/api/reverse-plans/${planId}/references/${refId}`, { headers: { "idempotency-key": "tpl-1" }, body: { templateVersionId: template.templateVersionId } })).status, 200);
  const run = await api.request("POST", `/api/reverse-plans/${planId}/references/${refId}/run`, { headers: { "idempotency-key": "run-1" } }); assert.equal(run.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 10)); const state = await api.request("GET", `/api/reverse-plans/${planId}`); const ref = (state.body as any).data.references[0]; assert.equal(ref.attempts[0].status, "succeeded");
  const saved = await api.request("PATCH", `/api/reverse-plans/${planId}/references/${refId}/prompt`, { headers: { "idempotency-key": "save-1" }, body: { prompt: "用户编辑后的有效提示词" } }); assert.equal(saved.status, 201); assert.equal((saved.body as any).data.kind, "user");
});

test("a completed reverse attempt does not remove a reference uploaded while it was running", async () => {
  let finishReverse: (() => void) | undefined;
  const delayedLlm: LlmClient = {
    ...llm,
    generateReversePrompt: ({ referenceImageId }) => new Promise((resolve) => {
      finishReverse = () => resolve({ schemaVersion: "reverse-prompt-v1", referenceImageId, prompt: "保留最新方案中的全部参考图。" });
    }),
  };
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), promptRepository: prompts, llmClient: delayedLlm });
  const created = await api.request("POST", "/api/reverse-plans", { body: { mode: "main" } });
  const planId = (created.body as any).data.id;
  const first = await api.request("POST", `/api/reverse-plans/${planId}/references`, { body: { filename: "first.png", mimeType: "image/png", bytesBase64: pngBase64 } });
  const firstId = (first.body as any).data.id;
  await api.request("PATCH", `/api/reverse-plans/${planId}/references/${firstId}`, { body: { templateVersionId: template.templateVersionId } });
  await api.request("POST", `/api/reverse-plans/${planId}/references/${firstId}/run`);

  const secondBytes = Buffer.concat([Buffer.from(pngBase64, "base64"), Buffer.from([0])]).toString("base64");
  const second = await api.request("POST", `/api/reverse-plans/${planId}/references`, { body: { filename: "second.png", mimeType: "image/png", bytesBase64: secondBytes } });
  const secondId = (second.body as any).data.id;
  finishReverse?.();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const state = await api.request("GET", `/api/reverse-plans/${planId}`);
  assert.equal((state.body as any).data.references.length, 2);
  assert.equal((await api.request("PATCH", `/api/reverse-plans/${planId}/references/${secondId}`, { body: { templateVersionId: template.templateVersionId } })).status, 200);
});

test("concurrent reverse reference uploads preserve every image", async () => {
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), promptRepository: prompts, llmClient: llm });
  const created = await api.request("POST", "/api/reverse-plans", { body: { mode: "main" } });
  const planId = (created.body as any).data.id;
  const firstBytes = Buffer.concat([Buffer.from(pngBase64, "base64"), Buffer.from([1])]).toString("base64");
  const secondBytes = Buffer.concat([Buffer.from(pngBase64, "base64"), Buffer.from([2])]).toString("base64");

  const responses = await Promise.all([
    api.request("POST", `/api/reverse-plans/${planId}/references`, { body: { filename: "one.png", mimeType: "image/png", bytesBase64: firstBytes } }),
    api.request("POST", `/api/reverse-plans/${planId}/references`, { body: { filename: "two.png", mimeType: "image/png", bytesBase64: secondBytes } }),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  const state = await api.request("GET", `/api/reverse-plans/${planId}`);
  assert.equal((state.body as any).data.references.length, 2);
});

test("successful reverse results import as an idempotent task group and preserve source snapshots", async () => {
  const storage = new MemoryStorage(); const reverse = new MemorySuiteRepository(); const tasks = new MemoryTaskRepository(); const library = new MemoryLibraryRepository();
  const api = createTicket02App({ repository: reverse, storage, taskRepository: tasks, libraryRepository: library, promptRepository: prompts, llmClient: llm });
  const created = await api.request("POST", "/api/reverse-plans", { headers: { "idempotency-key": "canvas-plan" }, body: { mode: "detail" } }); const planId = (created.body as any).data.id;
  const uploaded = await api.request("POST", `/api/reverse-plans/${planId}/references`, { headers: { "idempotency-key": "canvas-ref" }, body: { filename: "detail.png", mimeType: "image/png", bytesBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } }); const refId = (uploaded.body as any).data.id;
  await api.request("PATCH", `/api/reverse-plans/${planId}/references/${refId}`, { body: { templateVersionId: detailTemplate.templateVersionId } }); await api.request("POST", `/api/reverse-plans/${planId}/references/${refId}/run`); await new Promise((resolve) => setTimeout(resolve, 10));
  const imported = await api.request("POST", `/api/reverse-plans/${planId}/canvas-imports`, { headers: { "idempotency-key": "canvas-import" }, body: { name: "反推套图" } }); assert.equal(imported.status, 201); const suiteId = (imported.body as any).data.suiteId; assert.equal((imported.body as any).data.taskIds.length, 1);
  const duplicate = await api.request("POST", `/api/reverse-plans/${planId}/canvas-imports`, { headers: { "idempotency-key": "canvas-import" }, body: { name: "反推套图" } }); assert.equal(duplicate.status, 200); assert.equal((duplicate.body as any).data.duplicate, true);
  const workbench = await api.request("GET", `/api/suites/${suiteId}/workbench`); const task = (workbench.body as any).data.tasks.find((item: any) => item.originKind === "reverse_import"); assert.ok(task); assert.equal(task.planSnapshotId, null); assert.equal(task.reversePlanId, planId); assert.equal(task.reverseReferenceId, refId);
});
