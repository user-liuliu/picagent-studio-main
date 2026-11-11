import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTicket02App } from "../server/app.js";
import { MemoryLibraryRepository } from "../server/repositories/memory-library-repository.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { parsePromptMarkdown } from "../server/prompt-library.js";
import type { LibraryResource } from "../server/types.js";

const now = "2026-08-24T00:00:00.000Z";
function resource(overrides: Partial<LibraryResource> = {}): LibraryResource {
  return { id: "prompt:plan-v1", resourceType: "prompt_template", title: "计划模板", summary: "保留商品事实", mimeType: null, previewUrl: null, suiteId: null, taskId: null, imageVersionId: null, baseVersionId: null, templateVersionId: "plan-v1", resourceVersionId: "plan-v1", stage: "plan", source: { code: "test.plan", versionNo: 1, body: "冻结正文" }, createdAt: now, updatedAt: now, ...overrides };
}

async function fixture() {
  const suites = new MemorySuiteRepository(); const library = new MemoryLibraryRepository(); const storage = new MemoryStorage();
  const suite = await suites.createSuite("资源库契约");
  library.addResource(resource());
  library.addResource(resource({ id: "prompt:task-v1", title: "单卡模板", templateVersionId: "task-v1", resourceVersionId: "task-v1", stage: "task_image" }));
  library.addResource(resource({ id: "input:image-1", resourceType: "input_image", title: "鼠标原图", summary: "商品实拍", suiteId: suite.id, templateVersionId: null, resourceVersionId: "image-1", stage: null, source: { objectKey: "input/image-1" }, previewUrl: "/api/library/resources/input:image-1/preview" }));
  await storage.put({ key: "input/image-1", bytes: Buffer.from("preview"), contentType: "image/png" });
  const api = createTicket02App({ repository: suites, storage, libraryRepository: library });
  return { api, suite, library };
}

test("resource listing filters published stage resources and never uses fixture data", async () => {
  const { api } = await fixture();
  const plan = await api.request("GET", "/api/library/resources?resourceType=prompt_template&stage=plan");
  assert.equal(plan.status, 200); assert.equal((plan.body as any).data.items.length, 1); assert.equal((plan.body as any).data.items[0].templateVersionId, "plan-v1");
  const task = await api.request("GET", "/api/library/resources?stage=task_image");
  assert.equal((task.body as any).data.items[0].resourceType, "prompt_template");
  const invalid = await api.request("GET", "/api/library/resources?stage=unknown");
  assert.equal(invalid.status, 400); assert.equal((invalid.body as any).error.code, "INVALID_PROMPT_STAGE");
});

test("resource detail and preview stay behind the API proxy", async () => {
  const { api } = await fixture();
  const detail = await api.request("GET", "/api/library/resources/input:image-1");
  assert.equal(detail.status, 200); assert.equal((detail.body as any).data.source.objectKey, "input/image-1");
  const preview = await api.previewLibraryResource("input:image-1");
  assert.equal(preview.status, 200); assert.equal(preview.headers?.["content-type"], "image/png"); assert.deepEqual(preview.raw, Buffer.from("preview"));
});

test("plan and task references enforce stage, freeze a version snapshot, and are idempotent", async () => {
  const { api, suite } = await fixture();
  const missing = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "missing" }, body: { resourceId: "prompt:task-v1", targetType: "plan", targetId: "draft" } });
  assert.equal(missing.status, 409); assert.equal((missing.body as any).error.code, "LIBRARY_STAGE_MISMATCH");

  const first = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "ref-plan" }, body: { resourceId: "prompt:plan-v1", targetType: "plan", targetId: "draft" } });
  assert.equal(first.status, 201);

  const input = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "ref-input" }, body: { resourceId: "input:image-1", targetType: "task", targetId: "task-1" } });
  assert.equal(input.status, 201); assert.equal((input.body as any).data.resourceVersionId, "image-1");
  const duplicate = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "ref-input" }, body: { resourceId: "input:image-1", targetType: "task", targetId: "task-1" } });
  assert.equal(duplicate.status, 200); assert.equal((duplicate.body as any).data.id, (input.body as any).data.id);
  const restored = await api.request("GET", `/api/suites/${suite.id}/library/references?targetType=task&targetId=task-1`);
  assert.equal((restored.body as any).data.length, 1); assert.equal((restored.body as any).data[0].snapshot.resourceVersionId, "image-1");
});

test("archiving a reference keeps the immutable audit row but removes it from active restore", async () => {
  const { api, suite } = await fixture();
  const created = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "ref-archive" }, body: { resourceId: "input:image-1", targetType: "task", targetId: "task-1" } });
  const archived = await api.request("DELETE", `/api/suites/${suite.id}/library/references/${created.body.data.id}`);
  assert.equal(archived.status, 200); assert.ok((archived.body as any).data.archivedAt);
  const active = await api.request("GET", `/api/suites/${suite.id}/library/references?targetType=task&targetId=task-1`);
  assert.deepEqual((active.body as any).data, []);
});

test("template copy endpoint returns only a published template from the requested stage", async () => {
  const prompts = new MemoryPromptRepository();
  const [draft] = await prompts.importRecords(parsePromptMarkdown("### 计划模板\n\n```plain\n保持商品事实。\n```", "copy.md"));
  await prompts.publishVersion(draft.templateVersionId);
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), promptRepository: prompts });
  const copied = await api.request("GET", `/api/prompt-templates/${draft.templateVersionId}/copy?stage=plan`);
  assert.equal(copied.status, 200); assert.equal((copied.body as any).data.body, "保持商品事实。");
  const mismatch = await api.request("GET", `/api/prompt-templates/${draft.templateVersionId}/copy?stage=task_image`);
  assert.equal(mismatch.status, 404); assert.equal((mismatch.body as any).error.code, "PROMPT_TEMPLATE_NOT_FOUND");
});

test("workbench exposes the unified library with image assets and prompt templates", async () => {
  const source = await readFile(new URL("../src/pages/BoardPage.tsx", import.meta.url), "utf8");
  assert.match(source, />风格库<\/button>/);
  assert.match(source, /图片资产/);
  assert.match(source, /提示词模板/);
  assert.match(source, /listLibraryResources/);
  assert.match(source, /createLibraryReference/);
  assert.match(source, /process_image/);
  assert.match(source, /value="base_refine"/);
  assert.match(source, /value="plan"/);
  assert.match(source, /value="task_image"/);
  assert.match(source, /选择资源/);
  assert.match(source, /实拍原图不适用生成提示词/);
});
