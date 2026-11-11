import assert from "node:assert/strict";
import test from "node:test";
import { createTicket02App } from "../server/app.js";
import { MemoryLibraryRepository } from "../server/repositories/memory-library-repository.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { parsePromptMarkdown } from "../server/prompt-library.js";
import type { LibraryResource } from "../server/types.js";

const now = "2026-08-24T00:00:00.000Z";

test("template lifecycle supports copy, draft edit, publish and retire", async () => {
  const prompts = new MemoryPromptRepository();
  const [draft] = await prompts.importRecords(parsePromptMarkdown("### 计划模板\n\n```plain\n保持商品事实。\n```", "lifecycle.md"));
  await prompts.publishVersion(draft.templateVersionId);
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), promptRepository: prompts });
  const copied = await api.request("POST", `/api/prompt-templates/${draft.templateVersionId}/copy`, { headers: { "idempotency-key": "copy" } });
  assert.equal(copied.status, 201);
  const copiedId = (copied.body as any).data.templateVersionId;
  const updated = await api.request("PATCH", `/api/prompt-templates/${copiedId}`, { body: { body: "新的规则。" } });
  assert.equal(updated.status, 200);
  assert.equal((updated.body as any).data.body, "新的规则。");
  const published = await api.request("POST", `/api/prompt-templates/${copiedId}/publish`, { headers: { "idempotency-key": "publish" } });
  assert.equal(published.status, 200);
  const retired = await api.request("POST", `/api/prompt-templates/${copiedId}/retire`, { headers: { "idempotency-key": "retire" } });
  assert.equal(retired.status, 200);
  const runtime = await api.request("GET", `/api/prompt-templates?stage=plan`);
  assert.equal(runtime.status, 200);
  assert.equal((runtime.body as any).data.length, 0);
});

test("draft image resources cannot be referenced until published", async () => {
  const suites = new MemorySuiteRepository();
  const library = new MemoryLibraryRepository();
  const suite = await suites.createSuite("资产状态");
  const asset: LibraryResource = { id: "reverse:asset-1", resourceType: "reverse_reference_asset", title: "爆品结构", summary: "冷静科技感", mimeType: "image/png", previewUrl: null, suiteId: suite.id, taskId: null, imageVersionId: null, baseVersionId: null, templateVersionId: null, resourceVersionId: "asset-1", stage: "task_image", source: { objectKey: "reverse/asset-1.png" }, status: "draft", promptSnapshot: { prompt: "保留构图结构" }, createdAt: now, updatedAt: now };
  library.addResource(asset);
  const api = createTicket02App({ repository: suites, storage: new MemoryStorage(), libraryRepository: library });
  const blocked = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "draft" }, body: { resourceId: asset.id, targetType: "plan", targetId: "plan-1" } });
  assert.equal(blocked.status, 409);
  assert.equal((blocked.body as any).error.code, "LIBRARY_RESOURCE_NOT_PUBLISHED");
  await library.setResourceStatus(asset.id, "published");
  const allowed = await api.request("POST", `/api/suites/${suite.id}/library/references`, { headers: { "idempotency-key": "published" }, body: { resourceId: asset.id, targetType: "plan", targetId: "plan-1" } });
  assert.equal(allowed.status, 201);
});
