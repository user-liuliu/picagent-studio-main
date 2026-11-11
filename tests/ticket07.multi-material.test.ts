import assert from "node:assert/strict";
import test from "node:test";
import { createTicket02App } from "../server/app.js";
import { MemoryLibraryRepository } from "../server/repositories/memory-library-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryTaskRepository } from "../server/repositories/memory-task-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import type { ImageProvider, LibraryResource, LlmClient, PromptRepository, PromptTemplateRuntime } from "../server/types.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const template: PromptTemplateRuntime = { templateId: "reverse", templateVersionId: "reverse-v1", versionNo: 1, code: "reverse.main", name: "主图反推", kind: "planner", stage: "reverse_prompt", executionTarget: "llm", inputSchema: [], outputSchema: {}, applicability: { targetType: "main" }, body: "body", userPromptTemplate: "json", status: "published", sourceFile: "test", sourceHeading: "test", sourceSha256: "a".repeat(64) };
const prompts: PromptRepository = { importRecords: async () => [], publishVersion: async () => template, listPublished: async () => [template], getPublishedVersion: async () => template, listVersions: async () => [template], getVersion: async () => template, updateDraft: async () => null, copyVersion: async () => null, retireVersion: async () => null };

test("reverse task binds up to three white resources and freezes ordered multi-image attempt input", async () => {
  const storage = new MemoryStorage(); const suites = new MemorySuiteRepository(); const tasks = new MemoryTaskRepository(); const library = new MemoryLibraryRepository();
  let receivedImages = 0;
  const provider: ImageProvider = { supportsMultipleImages: true, edit: async (request) => { receivedImages = request.images?.length ?? 0; return { bytes: png, mimeType: "image/png" }; } };
  const llm: LlmClient = { provider: "qwen", model: "qwen-vl-max", isFake: true, generatePlan: async () => ({}), generateReversePrompt: async ({ referenceImageId }) => ({ schemaVersion: "reverse-prompt-v1", referenceImageId, prompt: "使用产品白底图作为唯一外观来源。" }) };
  const api = createTicket02App({ repository: suites, storage, taskRepository: tasks, libraryRepository: library, promptRepository: prompts, llmClient: llm, provider });
  const plan = await api.request("POST", "/api/reverse-plans", { body: { mode: "main" } }); const planId = (plan.body as any).data.id;
  const uploaded = await api.request("POST", `/api/reverse-plans/${planId}/references`, { body: { filename: "爆品.png", mimeType: "image/png", bytesBase64: png.toString("base64") } }); const refId = (uploaded.body as any).data.id;
  await api.request("PATCH", `/api/reverse-plans/${planId}/references/${refId}`, { body: { templateVersionId: template.templateVersionId } }); await api.request("POST", `/api/reverse-plans/${planId}/references/${refId}/run`); await new Promise((resolve) => setTimeout(resolve, 10));
  const imported = await api.request("POST", `/api/reverse-plans/${planId}/canvas-imports`, { headers: { "idempotency-key": "import" }, body: {} }); assert.equal(imported.status, 201); const suiteId = (imported.body as any).data.suiteId; const taskId = (imported.body as any).data.taskIds[0];
  const resources: LibraryResource[] = [1, 2, 3].map((n) => ({ id: `base:${n}`, resourceType: "base_image", title: `白底图${n}`, summary: "", mimeType: "image/png", previewUrl: `/api/library/resources/base:${n}/preview`, suiteId: null, taskId: null, imageVersionId: null, baseVersionId: `v${n}`, templateVersionId: null, resourceVersionId: `rv${n}`, stage: null, source: { objectKey: `base/${n}.png` }, status: "published", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  for (const resource of resources) { library.addResource(resource); await storage.put({ key: String(resource.source.objectKey), bytes: png, contentType: "image/png" }); }
  const bound = await api.request("POST", `/api/suite-tasks/${taskId}/white-resource`, { headers: { "idempotency-key": "bind" }, body: { resourceIds: resources.map((resource) => resource.id) } });
  assert.equal(bound.status, 201); assert.equal((bound.body as any).data.task.generationParams.productMaterialRefs.length, 3);
  const generated = await api.request("POST", `/api/suite-tasks/${taskId}/generation`, { headers: { "idempotency-key": "generate" } }); assert.equal(generated.status, 202); await new Promise((resolve) => setTimeout(resolve, 20));
  const workbench = await api.request("GET", `/api/suites/${suiteId}/workbench`); const task = (workbench.body as any).data.tasks.find((item: any) => item.id === taskId); const attempt = task.attempts[0];
  assert.equal(attempt.requestSummary.imageCount, 4); assert.deepEqual(attempt.requestSummary.inputRoles, ["product_primary", "product_detail", "product_detail", "explosive_reference"]);
  assert.equal(receivedImages, 4);
});
